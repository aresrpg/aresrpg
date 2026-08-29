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

import { assert_deployment_package_size } from './deployment_package_size.ts'
import { full_republish_pin_patch } from './deployment_reset.ts'

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
export const package_version_from_source = (source: string): number => {
  const match = source.match(PACKAGE_VERSION_PATTERN)
  if (!match) throw new Error('packages/move/sources/version.move has no PACKAGE_VERSION constant')
  const version = Number(match[2])
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('packages/move/sources/version.move has an invalid PACKAGE_VERSION constant')
  return version
}

export const next_package_version_source = (
  source: string,
  published_version: number
): Readonly<{ source: string; version: number; changed: boolean }> => {
  const source_version = package_version_from_source(source)
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
  assert_deployment_package_size(package_name, parsed.modules)
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
  const control_dir = join(repo_dir, 'packages', 'control')
  const seed_dir = join(repo_dir, 'packages', 'seed')
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
  const compile_control = async (network: Network, control?: PackagePublication): Promise<ContractArtifact> =>
    compile_with_publications(
      network,
      control_dir,
      'aresrpg_control',
      control ? [{ path: control_dir, publication: control }] : []
    )
  const compile_seed = async (
    network: Network,
    math: PackagePublication,
    control: PackagePublication,
    seed?: PackagePublication
  ): Promise<ContractArtifact> =>
    compile_with_publications(network, seed_dir, 'aresrpg_seed', [
      { path: math_dir, publication: math },
      { path: control_dir, publication: control },
      ...(seed ? [{ path: seed_dir, publication: seed }] : []),
    ])
  const compile_game = async (
    network: Network,
    math: PackagePublication,
    control: PackagePublication,
    seed: PackagePublication,
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
      { path: control_dir, publication: control },
      { path: seed_dir, publication: seed },
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
  const game_version = async (): Promise<number> => package_version_from_source(await readFile(version_path, 'utf8'))
  return Object.freeze({ compile_math, compile_control, compile_seed, compile_game, prepare_upgrade, game_version })
}

type PinsFile = Readonly<Record<Network, Readonly<Record<string, unknown>>>>
type SeedLedger = Readonly<Record<string, unknown>>

const without_seed_ledgers = (pins: PinsFile): PinsFile =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(pins).map(([network, values]) => {
        const { seed_addresses: _seed_addresses, seed_ledgers: _seed_ledgers, ...deployment } = values
        return [network, deployment]
      })
    ) as Record<Network, Readonly<Record<string, unknown>>>
  )

/** Content-address writes must not invalidate a package-operation compare-and-swap. */
export const deployment_revision_of_pins = (pins: PinsFile): string =>
  revision_of(JSON.stringify(without_seed_ledgers(pins)))

export const seed_ledger_from_pins = (pins: PinsFile, network: Network, content_root: string): SeedLedger => {
  const ledgers = pins[network].seed_ledgers
  if (!ledgers || typeof ledgers !== 'object' || Array.isArray(ledgers)) return Object.freeze({})
  const ledger = Reflect.get(ledgers, content_root)
  return ledger && typeof ledger === 'object' && !Array.isArray(ledger)
    ? Object.freeze(ledger as Record<string, unknown>)
    : Object.freeze({})
}

export const merge_seed_ledger_pins = (
  pins: PinsFile,
  network: Network,
  content_root: string,
  ledger: SeedLedger,
  addresses: Readonly<Record<string, string>> = Object.freeze({})
): PinsFile => {
  const current = pins[network].seed_ledgers
  const ledgers = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  const current_books = pins[network].seed_addresses
  const books = current_books && typeof current_books === 'object' && !Array.isArray(current_books) ? current_books : {}
  const current_book = Reflect.get(books, content_root)
  return merge_deployment_pins(pins, network, {
    seed_ledgers: Object.freeze({ ...ledgers, [content_root]: Object.freeze({ ...ledger }) }),
    seed_addresses: Object.freeze({
      ...books,
      [content_root]: Object.freeze({
        ...(current_book && typeof current_book === 'object' && !Array.isArray(current_book) ? current_book : {}),
        ...addresses,
      }),
    }),
  })
}

export const merge_deployment_pins = (
  pins: PinsFile,
  network: Network,
  patch: Readonly<Record<string, unknown>>
): PinsFile => Object.freeze({ ...pins, [network]: Object.freeze({ ...pins[network], ...patch }) })

export const reset_deployment_pins = (pins: PinsFile, network: Network): PinsFile => {
  const { worlds: _obsolete_world_pins, ...retained } = pins[network]
  return Object.freeze({
    ...pins,
    [network]: Object.freeze({
      ...retained,
      ...full_republish_pin_patch,
    }),
  })
}

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
    const value = JSON.parse(source) as PinsFile
    return Object.freeze({ revision: deployment_revision_of_pins(value), value })
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
    return { pins: value, revision: deployment_revision_of_pins(value) }
  }
  let pin_writes: Promise<unknown> = Promise.resolve()
  const update_pins = (
    expected_revision: string | null,
    update: (current: PinsFile) => PinsFile
  ): Promise<Readonly<{ pins: PinsFile; revision: string }>> => {
    const operation = pin_writes.then(async () => {
      const current = await read_pins()
      if (expected_revision !== null && current.revision !== expected_revision)
        throw new Error('pins.json changed; reload before publishing')
      return write_pins(update(current.value))
    })
    pin_writes = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }
  return {
    name: 'aresrpg-deployment-admin',
    hotUpdate({ file }) {
      return [pins_path, version_path].includes(file) ? [] : undefined
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        // Every published content address and its last authored fingerprint live in pins.json,
        // namespaced by Registry root. This is durable deployment state, not a disposable cache.
        if (url.pathname === '/__admin/seed-ledger') {
          if (request.method === 'GET') {
            const network = url.searchParams.get('network')
            const content_root = String(url.searchParams.get('content_root'))
            if (!is_network(network) || !is_object_id(content_root)) {
              response_json(response, 400, { error: 'A valid network and content root are required' })
              return
            }
            void read_pins().then(
              ({ value }) =>
                response_json(response, 200, { ledger: seed_ledger_from_pins(value, network, content_root) }),
              (error) => response_json(response, 500, { error: error instanceof Error ? error.message : String(error) })
            )
            return
          }
          const ledger_origin = !request.headers.origin || new URL(request.headers.origin).host === request.headers.host
          if (request.method !== 'PUT' || !ledger_origin || request.headers['x-aresrpg-admin-token'] !== token) {
            response_json(response, 403, { error: 'The local deployment token or origin is invalid' })
            return
          }
          void read_json(request)
            .then(async (body: Record<string, unknown>) => {
              if (
                !is_network(body.network) ||
                !is_object_id(body.content_root) ||
                !body.ledger ||
                typeof body.ledger !== 'object' ||
                Array.isArray(body.ledger) ||
                !body.addresses ||
                typeof body.addresses !== 'object' ||
                Array.isArray(body.addresses) ||
                !Object.entries(body.addresses).every(
                  ([address, label]) => is_object_id(address) && typeof label === 'string'
                )
              )
                throw new TypeError('A valid network, content root, ledger, and address book are required')
              const { network, content_root, ledger, addresses } = body as Readonly<{
                network: Network
                content_root: string
                ledger: SeedLedger
                addresses: Record<string, string>
              }>
              const saved = await update_pins(null, (current) =>
                merge_seed_ledger_pins(current, network, content_root, ledger, addresses)
              )
              return { ledger, revision: saved.revision }
            })
            .then(
              (body: unknown) => response_json(response, 200, body),
              (error: unknown) =>
                response_json(response, 409, { error: error instanceof Error ? error.message : String(error) })
            )
          return
        }
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
            const { network } = body as Readonly<{ network: Network }>
            if (request.method === 'POST' && body.action === 'compile_math')
              return { artifact: await builds.compile_math(body.network) }
            if (request.method === 'POST' && body.action === 'compile_math_upgrade') {
              const math = parse_publication(body.math)
              return { artifact: await builds.compile_math(body.network, math) }
            }
            if (request.method === 'POST' && body.action === 'compile_control')
              return { artifact: await builds.compile_control(body.network) }
            if (request.method === 'POST' && body.action === 'compile_control_upgrade')
              return {
                artifact: await builds.compile_control(body.network, parse_publication(body.control)),
              }
            if (request.method === 'POST' && body.action === 'compile_seed') {
              return {
                artifact: await builds.compile_seed(
                  body.network,
                  parse_publication(body.math),
                  parse_publication(body.control)
                ),
              }
            }
            if (request.method === 'POST' && body.action === 'compile_seed_upgrade') {
              return {
                artifact: await builds.compile_seed(
                  body.network,
                  parse_publication(body.math),
                  parse_publication(body.control),
                  parse_publication(body.seed)
                ),
              }
            }
            if (request.method === 'POST' && body.action === 'compile_game') {
              return {
                artifact: await builds.compile_game(
                  body.network,
                  parse_publication(body.math),
                  parse_publication(body.control),
                  parse_publication(body.seed)
                ),
              }
            }
            if (request.method === 'POST' && body.action === 'compile_game_upgrade') {
              if (!Number.isSafeInteger(body.current_version) || Number(body.current_version) < 1)
                throw new TypeError('A live positive game version is required')
              const version = await builds.prepare_upgrade(Number(body.current_version))
              return {
                artifact: await builds.compile_game(
                  body.network,
                  parse_publication(body.math),
                  parse_publication(body.control),
                  parse_publication(body.seed),
                  parse_publication(body.game)
                ),
                version,
              }
            }
            if (request.method === 'POST' && body.action === 'compile_game_probe') {
              const artifact = await builds.compile_game(
                body.network,
                parse_publication(body.math),
                parse_publication(body.control),
                parse_publication(body.seed),
                parse_publication(body.game)
              )
              return {
                artifact,
                version: await builds.game_version(),
              }
            }
            if (request.method === 'POST' && body.action === 'reset') {
              if (typeof body.revision !== 'string') throw new TypeError('A pin revision is required')
              return update_pins(body.revision, (current) => reset_deployment_pins(current, network))
            }
            if (request.method !== 'PUT') throw new TypeError('Unknown deployment operation')
            if (typeof body.revision !== 'string' || !body.patch || typeof body.patch !== 'object')
              throw new TypeError('A pin revision and patch are required')
            return update_pins(body.revision, (current) =>
              merge_deployment_pins(current, network, body.patch as Record<string, unknown>)
            )
          })
          .then(
            (body) => response_json(response, 200, body),
            (error) => response_json(response, 409, { error: error instanceof Error ? error.message : String(error) })
          )
      })
    },
  }
}
