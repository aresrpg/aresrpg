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
type MathPublication = Readonly<{ package: string; upgrade_cap: string }>
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
    throw new Error(command_failure_message(error))
  }
}
const revision_of = (source: string): string => createHash('sha256').update(source).digest('hex')

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
  const compile_math = async (network: Network): Promise<ContractArtifact> => {
    const { stdout } = await run('sui', dump_args(math_dir, network), repo_dir)
    return parse_contract_artifact('aresrpg_math', stdout)
  }
  const compile_game = async (network: Network, math: MathPublication): Promise<ContractArtifact> => {
    const { stdout: chain_output } = await run(
      'sui',
      ['client', '--client.env', network, 'chain-identifier', '--format', 'hex'],
      repo_dir
    )
    const chain_id = chain_output.trim()
    if (!/^[0-9a-fA-F]{8}$/.test(chain_id)) throw new Error(`Sui returned an invalid ${network} chain id`)
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
    const { stdout: object_output } = await run(
      'sui',
      ['client', '--client.env', network, 'object', kiosk_package, '--json'],
      repo_dir
    )
    const object_start = object_output.indexOf('{')
    const kiosk_object = JSON.parse(object_output.slice(object_start)) as Readonly<Record<string, unknown>>
    if (!Number.isInteger(kiosk_object.version) || Number(kiosk_object.version) < 1)
      throw new Error(`Sui returned an invalid Kiosk package version for ${network}`)
    const directory = await mkdtemp(join(tmpdir(), 'aresrpg-publish-'))
    const pubfile = join(directory, `Pub.${network}.toml`)
    const source = [
      '# generated local publication context; never committed',
      `build-env = "${network}"`,
      `chain-id = "${chain_id}"`,
      '',
      '[[published]]',
      `source = { local = "${math_dir.replaceAll('\\', '\\\\')}" }`,
      `published-at = "${math.package}"`,
      `original-id = "${math.package}"`,
      'version = 1',
      `upgrade-cap = "${math.upgrade_cap}"`,
      '',
      '[[published]]',
      `source = { local = "${kiosk_path.replaceAll('\\', '\\\\')}" }`,
      `published-at = "${kiosk_package}"`,
      `original-id = "${kiosk_original}"`,
      `version = ${String(kiosk_object.version)}`,
      '',
    ].join('\n')
    try {
      await writeFile(pubfile, source, { flag: 'wx' })
      const { stdout } = await run('sui', dump_args(game_dir, network, pubfile), repo_dir)
      return parse_contract_artifact('aresrpg', stdout)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return Object.freeze({ compile_math, compile_game })
}

type PinsFile = Readonly<Record<Network, Readonly<Record<string, unknown>>>>
export const merge_deployment_pins = (
  pins: PinsFile,
  network: Network,
  patch: Readonly<Record<string, unknown>>
): PinsFile => Object.freeze({ ...pins, [network]: Object.freeze({ ...pins[network], ...patch }) })

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

export const deployment_dev_plugin = ({ repo_dir }: Readonly<{ repo_dir: string }>): Plugin => {
  const pins_path = join(repo_dir, 'pins.json')
  const token = randomUUID()
  const builds = create_contract_build_service({ repo_dir })
  const read_pins = async () => {
    const source = await readFile(pins_path, 'utf8')
    return Object.freeze({ source, revision: revision_of(source), value: JSON.parse(source) as PinsFile })
  }
  return {
    name: 'aresrpg-deployment-admin',
    handleHotUpdate: ({ file }) => (file === pins_path ? [] : undefined),
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
            if (request.method === 'POST' && body.action === 'compile_game') {
              const math = body.math as Partial<MathPublication> | undefined
              // strict hex ids — these strings land verbatim in the generated Pub.toml
              const is_object_id = (value: unknown): value is string =>
                typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value)
              if (!is_object_id(math?.package) || !is_object_id(math.upgrade_cap))
                throw new TypeError('The published math package and UpgradeCap must be 0x object ids')
              return { artifact: await builds.compile_game(body.network, math as MathPublication) }
            }
            if (request.method !== 'PUT') throw new TypeError('Unknown deployment operation')
            if (typeof body.revision !== 'string' || !body.patch || typeof body.patch !== 'object')
              throw new TypeError('A pin revision and patch are required')
            const current = await read_pins()
            if (current.revision !== body.revision) throw new Error('pins.json changed; reload before publishing')
            const next_pins = merge_deployment_pins(current.value, body.network, body.patch as Record<string, unknown>)
            const source = `${JSON.stringify(next_pins, null, 2)}\n`
            const temporary = `${pins_path}.${randomUUID()}.tmp`
            try {
              await writeFile(temporary, source, { flag: 'wx' })
              await rename(temporary, pins_path)
            } finally {
              await unlink(temporary).catch(() => undefined)
            }
            return { pins: next_pins, revision: revision_of(source) }
          })
          .then(
            (body) => response_json(response, 200, body),
            (error) => response_json(response, 409, { error: error instanceof Error ? error.message : String(error) })
          )
      })
    },
  }
}
