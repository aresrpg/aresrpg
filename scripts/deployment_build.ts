// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Node-only Move package compiler shared by trusted release tooling. It emits unsigned artifacts;
// signing and chain submission remain outside this module.

import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import move_packages from '../move-packages.json' with { type: 'json' }
import type { ContractArtifact } from '../packages/sdk/src/deployment_admin.ts'

type Network = 'testnet' | 'mainnet'
type PackagePublication = Readonly<{
  package: string
  original_package?: string
  upgrade_cap: string
}>
type CommandResult = Readonly<{ stdout: string; stderr: string }>
type Execute = (command: string, args: readonly string[], cwd: string) => Promise<CommandResult>

const exec_file = promisify(execFile)
const MAX_COMPILER_OUTPUT_BYTES = 64 * 1024 * 1024
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
export const run_build_command: Execute = async (command, args, cwd) => {
  try {
    const result = await exec_file(command, [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_COMPILER_OUTPUT_BYTES,
    })
    return Object.freeze({ stdout: result.stdout, stderr: result.stderr })
  } catch (error) {
    throw new Error(`${command} failed: ${command_failure_message(error)}`, { cause: error })
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
  const bytecode_bytes = parsed.modules.reduce((total, module) => total + Buffer.byteLength(module, 'base64'), 0)
  if (bytecode_bytes > move_packages.max_bytecode_bytes)
    throw new Error(
      `${package_name} bytecode is ${String(bytecode_bytes)}B; ${String(move_packages.max_bytecode_bytes)}B max preserves Sui metadata headroom`
    )
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
  run = run_build_command,
}: Readonly<{ repo_dir: string; run?: Execute }>) => {
  const math_dir = join(repo_dir, 'packages', 'move-math')
  const control_dir = join(repo_dir, 'packages', 'control')
  const combat_dir = join(repo_dir, 'packages', 'move-combat')
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
  const compile_combat = async (
    network: Network,
    math: PackagePublication,
    combat?: PackagePublication
  ): Promise<ContractArtifact> =>
    compile_with_publications(network, combat_dir, 'aresrpg_combat', [
      { path: math_dir, publication: math },
      ...(combat ? [{ path: combat_dir, publication: combat }] : []),
    ])
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
    combat: PackagePublication,
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
      { path: combat_dir, publication: combat },
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
        await unlink(temporary).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
      }
    }
    return next.version
  }
  const game_version = async (): Promise<number> => package_version_from_source(await readFile(version_path, 'utf8'))
  return Object.freeze({
    compile_math,
    compile_control,
    compile_combat,
    compile_seed,
    compile_game,
    prepare_upgrade,
    game_version,
  })
}
