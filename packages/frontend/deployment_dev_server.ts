// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local-only Move compiler and atomic deployment-pin writer. Transactions never cross this
// boundary: the browser hands artifacts to the SDK and the connected wallet signs them.

import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { ContractArtifact } from '@aresrpg/sdk/deployment-admin'
import type { Plugin } from 'vite'

type Network = 'testnet' | 'mainnet'
type PackagePublication = Readonly<{
  package: string
  original_package?: string
  upgrade_cap: string
}>
type CommandResult = Readonly<{ stdout: string; stderr: string }>
type Execute = (command: string, args: readonly string[], cwd: string) => Promise<CommandResult>

const exec_file = promisify(execFile)
export const command_failure_message = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  const output = error as Error & Readonly<{ stdout?: unknown; stderr?: unknown }>
  const details = [output.stdout, output.stderr]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')
  return details || error.message
}
const execute: Execute = async (command, args, cwd) => {
  try {
    const result = await exec_file(command, [...args], { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    return Object.freeze({ stdout: result.stdout, stderr: result.stderr })
  } catch (error) {
    throw new Error(command_failure_message(error), { cause: error })
  }
}
const revision_of = (source: string): string => createHash('sha256').update(source).digest('hex')

const PACKAGE_VERSION_PATTERN = /(const\s+PACKAGE_VERSION\s*:\s*u64\s*=\s*)(\d+)(\s*;)/
export const next_package_version_source = (
  source: string,
  published_version: number
): Readonly<{ source: string; version: number; changed: boolean }> => {
  const match = source.match(PACKAGE_VERSION_PATTERN)
  if (!match) throw new Error('packages/move/sources/version.move has no PACKAGE_VERSION constant')
  const source_version = Number(match[2])
  if (!Number.isSafeInteger(published_version) || published_version < 1)
    throw new Error('The published game version must be a positive integer')
  if (source_version < published_version)
    throw new Error(`PACKAGE_VERSION ${source_version} is behind the published game version ${published_version}`)
  if (source_version > published_version) return Object.freeze({ source, version: source_version, changed: false })
  const version = published_version + 1
  return Object.freeze({
    source: source.replace(PACKAGE_VERSION_PATTERN, `$1${String(version)}$3`),
    version,
    changed: true,
  })
}

export const parse_contract_artifact = (
  package_name: ContractArtifact['package_name'],
  output: string
): ContractArtifact => {
  const start = output.lastIndexOf('\n{')
  const source = output.slice(start < 0 ? output.indexOf('{') : start + 1).trim()
  const parsed = JSON.parse(source) as Readonly<{ modules?: unknown; dependencies?: unknown; digest?: unknown }>
  if (
    !Array.isArray(parsed.modules) ||
    !parsed.modules.every((value) => typeof value === 'string') ||
    !Array.isArray(parsed.dependencies) ||
    !parsed.dependencies.every((value) => typeof value === 'string') ||
    !Array.isArray(parsed.digest) ||
    !parsed.digest.every((value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)
  )
    throw new Error(`${package_name} compiler output is incomplete`)
  return Object.freeze({
    package_name,
    modules: Object.freeze(parsed.modules),
    dependencies: Object.freeze(parsed.dependencies),
    digest: Object.freeze(parsed.digest.map(Number)),
  })
}

const dump_args = (path: string, network: Network, pubfile?: string): readonly string[] =>
  Object.freeze([
    'move',
    'build',
    '--path',
    path,
    '--build-env',
    network,
    '--dump-bytecode-as-base64',
    '--warnings-are-errors',
    ...(pubfile ? ['--pubfile-path', pubfile] : []),
  ])

export const create_contract_build_service = ({
  repo_dir,
  run = execute,
}: Readonly<{ repo_dir: string; run?: Execute }>) => {
  const math_dir = join(repo_dir, 'packages', 'move-math')
  const game_dir = join(repo_dir, 'packages', 'move')
  const version_path = join(game_dir, 'sources', 'version.move')
  const chain_identifier = async (network: Network): Promise<string> => {
    const { stdout } = await run(
      'sui',
      ['client', '--client.env', network, 'chain-identifier', '--format', 'hex'],
      repo_dir
    )
    const chain_id = stdout.trim()
    if (!/^[0-9a-fA-F]{8}$/.test(chain_id)) throw new Error(`Sui returned an invalid ${network} chain id`)
    return chain_id
  }
  const package_version = async (network: Network, package_id: string): Promise<number> => {
    const { stdout } = await run('sui', ['client', '--client.env', network, 'object', package_id, '--json'], repo_dir)
    const start = stdout.indexOf('{')
    const object = JSON.parse(stdout.slice(start)) as Readonly<Record<string, unknown>>
    if (!Number.isInteger(object.version) || Number(object.version) < 1)
      throw new Error(`Sui returned an invalid package version for ${package_id}`)
    return Number(object.version)
  }
  const publication_rows = async (
    network: Network,
    rows: readonly Readonly<{ path: string; publication: PackagePublication; version?: number }>[]
  ): Promise<readonly string[]> =>
    Promise.all(
      rows.map(async ({ path, publication, version }) =>
        [
          '[[published]]',
          `source = { local = "${path.replaceAll('\\', '\\\\')}" }`,
          `published-at = "${publication.package}"`,
          `original-id = "${publication.original_package ?? publication.package}"`,
          `version = ${String(version ?? (await package_version(network, publication.package)))}`,
          ...(publication.upgrade_cap ? [`upgrade-cap = "${publication.upgrade_cap}"`] : []),
          '',
        ].join('\n')
      )
    )
  const compile_with_publications = async (
    network: Network,
    path: string,
    package_name: ContractArtifact['package_name'],
    publications: readonly Readonly<{ path: string; publication: PackagePublication; version?: number }>[]
  ): Promise<ContractArtifact> => {
    if (!publications.length) {
      const { stdout } = await run('sui', dump_args(path, network), repo_dir)
      return parse_contract_artifact(package_name, stdout)
    }
    const directory = await mkdtemp(join(tmpdir(), 'aresrpg-publish-'))
    const pubfile = join(directory, `Pub.${network}.toml`)
    const source = [
      '# generated local publication context; never committed',
      `build-env = "${network}"`,
      `chain-id = "${await chain_identifier(network)}"`,
      '',
      ...(await publication_rows(network, publications)),
    ].join('\n')
    try {
      await writeFile(pubfile, source, { flag: 'wx' })
      const { stdout } = await run('sui', dump_args(path, network, pubfile), repo_dir)
      return parse_contract_artifact(package_name, stdout)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  const compile_math = async (network: Network, math?: PackagePublication): Promise<ContractArtifact> => {
    return compile_with_publications(
      network,
      math_dir,
      'aresrpg_math',
      math ? [{ path: math_dir, publication: math }] : []
    )
  }
  const compile_game = async (
    network: Network,
    math: PackagePublication,
    game?: PackagePublication
  ): Promise<ContractArtifact> => {
    const chain_id = await chain_identifier(network)
    const manifest = await readFile(join(game_dir, 'Move.toml'), 'utf8')
    const kiosk_source = manifest.match(/^Kiosk\s*=\s*(\{[^\n]+\})$/m)?.[1]
    if (!kiosk_source) throw new Error('The Kiosk dependency is missing from the game Move.toml')
    const { stdout: cache_output } = await run(
      'sui',
      ['move', 'cache-package', network, chain_id, kiosk_source],
      game_dir
    )
    const cache_start = cache_output.indexOf('{')
    const cached = JSON.parse(cache_output.slice(cache_start)) as Readonly<Record<string, unknown>>
    const kiosk_path = cached.path
    const kiosk_package = cached['published-at']
    const kiosk_original = cached['original-id']
    const is_object_id = (value: unknown): value is string =>
      typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value)
    if (
      typeof kiosk_path !== 'string' ||
      !is_object_id(kiosk_package) ||
      !is_object_id(kiosk_original) ||
      cached.chain_id !== chain_id
    )
      throw new Error(`Sui returned incomplete Kiosk publication metadata for ${network}`)
    const kiosk_version = await package_version(network, kiosk_package)
    const kiosk = Object.freeze({ package: kiosk_package, original_package: kiosk_original, upgrade_cap: '' })
    return compile_with_publications(network, game_dir, 'aresrpg', [
      { path: math_dir, publication: math },
      { path: kiosk_path, publication: kiosk, version: kiosk_version },
      ...(game ? [{ path: game_dir, publication: game }] : []),
    ])
  }
  const prepare_upgrade = async (published_version: number): Promise<number> => {
    const source = await readFile(version_path, 'utf8')
    const next = next_package_version_source(source, published_version)
    if (next.changed) {
      const temporary = `${version_path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, next.source, { flag: 'wx' })
        await rename(temporary, version_path)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
    }
    return next.version
  }
  return Object.freeze({ compile_math, compile_game, prepare_upgrade })
}

type PinsFile = Readonly<Record<Network, Readonly<Record<string, unknown>>>>
export const merge_deployment_pins = (
  pins: PinsFile,
  network: Network,
  patch: Readonly<Record<string, unknown>>
): PinsFile => Object.freeze({ ...pins, [network]: Object.freeze({ ...pins[network], ...patch }) })

const empty_shared_pin = Object.freeze({ id: null, shared_version: null })
const empty_deployment = Object.freeze({
  package: null,
  package_original: null,
  kiosk_package: null,
  math_package: null,
  math_package_original: null,
  upgrade_cap: null,
  math_upgrade_cap: null,
  admin_cap: null,
  publisher: null,
  item_publisher: null,
  character_publisher: null,
  version: empty_shared_pin,
  template_registry: empty_shared_pin,
  loot_registry: empty_shared_pin,
  name_registry: empty_shared_pin,
  friend_registry: empty_shared_pin,
  item_policy: empty_shared_pin,
  character_policy: empty_shared_pin,
  item_protected_policy: empty_shared_pin,
  character_protected_policy: empty_shared_pin,
  worlds: Object.freeze({}),
})
export const reset_deployment_pins = (pins: PinsFile, network: Network): PinsFile =>
  Object.freeze({ ...pins, [network]: empty_deployment })

const response_json = (response: import('node:http').ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
const read_json = async (request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) throw new Error('Deployment request exceeds the 1 MB limit')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object body')
  return value as Record<string, unknown>
}
const is_network = (value: unknown): value is Network => value === 'testnet' || value === 'mainnet'
const is_object_id = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value)
const parse_publication = (value: unknown): PackagePublication => {
  const publication = value as Partial<PackagePublication> | undefined
  if (
    !is_object_id(publication?.package) ||
    !is_object_id(publication.upgrade_cap) ||
    (publication.original_package !== undefined && !is_object_id(publication.original_package))
  )
    throw new TypeError('Package publication IDs must be valid 0x object IDs')
  return Object.freeze({
    package: publication.package,
    original_package: publication.original_package ?? publication.package,
    upgrade_cap: publication.upgrade_cap,
  })
}

export const deployment_dev_plugin = ({ repo_dir }: Readonly<{ repo_dir: string }>): Plugin => {
  const pins_path = join(repo_dir, 'pins.json')
  const version_path = join(repo_dir, 'packages', 'move', 'sources', 'version.move')
  const token = randomUUID()
  const builds = create_contract_build_service({ repo_dir })
  const read_pins = async () => {
    const source = await readFile(pins_path, 'utf8')
    return Object.freeze({ source, revision: revision_of(source), value: JSON.parse(source) as PinsFile })
  }
  const write_pins = async (value: PinsFile) => {
    const source = `${JSON.stringify(value, null, 2)}\n`
    const temporary = `${pins_path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, source, { flag: 'wx' })
      await rename(temporary, pins_path)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    return { pins: value, revision: revision_of(source) }
  }
  return {
    name: 'aresrpg-deployment-admin',
    handleHotUpdate: ({ file }) => ([pins_path, version_path].includes(file) ? [] : undefined),
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        if (url.pathname !== '/__admin/deployment') return next()
        if (request.method === 'GET') {
          void read_pins().then(
            ({ revision, value }) => response_json(response, 200, { pins: value, revision, token }),
            (error) => response_json(response, 500, { error: error instanceof Error ? error.message : String(error) })
          )
          return
        }
        const same_origin = !request.headers.origin || new URL(request.headers.origin).host === request.headers.host
        if (!same_origin || request.headers['x-aresrpg-admin-token'] !== token) {
          response_json(response, 403, { error: 'The local deployment token or origin is invalid' })
          return
        }
        void read_json(request)
          .then(async (body) => {
            if (!is_network(body.network)) throw new TypeError('A valid deployment network is required')
            if (request.method === 'POST' && body.action === 'compile_math')
              return { artifact: await builds.compile_math(body.network) }
            if (request.method === 'POST' && body.action === 'compile_math_upgrade') {
              const math = parse_publication(body.math)
              return { artifact: await builds.compile_math(body.network, math) }
            }
            if (request.method === 'POST' && body.action === 'compile_game') {
              return { artifact: await builds.compile_game(body.network, parse_publication(body.math)) }
            }
            if (request.method === 'POST' && body.action === 'compile_game_upgrade') {
              if (!Number.isSafeInteger(body.current_version) || Number(body.current_version) < 1)
                throw new TypeError('A live positive game version is required')
              const version = await builds.prepare_upgrade(Number(body.current_version))
              return {
                artifact: await builds.compile_game(
                  body.network,
                  parse_publication(body.math),
                  parse_publication(body.game)
                ),
                version,
              }
            }
            if (request.method === 'POST' && body.action === 'reset') {
              if (typeof body.revision !== 'string') throw new TypeError('A pin revision is required')
              const current = await read_pins()
              if (current.revision !== body.revision) throw new Error('pins.json changed; reload before republishing')
              return write_pins(reset_deployment_pins(current.value, body.network))
            }
            if (request.method !== 'PUT') throw new TypeError('Unknown deployment operation')
            if (typeof body.revision !== 'string' || !body.patch || typeof body.patch !== 'object')
              throw new TypeError('A pin revision and patch are required')
            const current = await read_pins()
            if (current.revision !== body.revision) throw new Error('pins.json changed; reload before publishing')
            const next_pins = merge_deployment_pins(current.value, body.network, body.patch as Record<string, unknown>)
            return write_pins(next_pins)
          })
          .then(
            (body) => response_json(response, 200, body),
            (error) => response_json(response, 409, { error: error instanceof Error ? error.message : String(error) })
          )
      })
    },
  }
}
