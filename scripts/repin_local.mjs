// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local read-stack ceremonies from the selected pins.json deployment:
//   repin  — a fresh publication: replace the disposable graph and restart both readers;
//   reload — a same-lineage upgrade: preserve the graph/watermark, rebuild and restart readers.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import PINS from '../pins.json' with { type: 'json' }

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const COMPOSE = join(ROOT, 'compose.yaml')
const LOCAL_CONTAINERS = ['aresrpg-server', 'aresrpg-indexer', 'aresrpg-falkordb']
const LOCAL_NETWORK = 'aresrpg-local'
const PACKAGE_BINDING_KEY = 'idx:package_original'

export const REPIN_STACK_COMMAND = Object.freeze(['up', '-d', 'falkordb', 'indexer', 'server'])
export const RELOAD_COMPOSE_COMMANDS = Object.freeze({
  build_readers: Object.freeze(['build', 'indexer', 'server']),
  restart_indexer: Object.freeze(['up', '-d', '--no-deps', '--force-recreate', 'indexer']),
  restart_server: Object.freeze(['up', '-d', '--no-deps', '--force-recreate', 'server']),
})

const package_id = /^0x[0-9a-f]{64}$/

export const local_pin_env = (pins, network = 'testnet') => {
  const selected = pins[network]
  const values = {
    PACKAGE_ORIGINAL: selected?.package_original,
    PACKAGE_LATEST: selected?.package,
    SEED_PACKAGE_ORIGINAL: selected?.seed_package_original,
    SUI_NETWORK: network,
  }
  if (
    network !== 'testnet' ||
    Object.values(values)
      .slice(0, 3)
      .some((value) => !package_id.test(value ?? ''))
  )
    throw new Error(`${network} pins are incomplete; finish deployment and seed publication before loading locally`)
  return Object.freeze(values)
}

export const assert_reload_lineage = (bound_original, wanted_original) => {
  if (!bound_original)
    throw new Error('No local projection is running; use bun run repin:local after publishing packages')
  if (bound_original !== wanted_original)
    throw new Error(
      `Local projection belongs to ${bound_original}, not ${wanted_original}; use bun run repin:local for the new publication`
    )
}

const command = (args, env, capture = false) => {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`docker ${args.join(' ')} failed${capture && result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  return capture ? result.stdout.trim() : ''
}

const compose = (args, env, capture = false) => command(['compose', '-f', COMPOSE, ...args], env, capture)

const remove_legacy_container = (name, env) => {
  const found = spawnSync('docker', ['container', 'inspect', name], { cwd: ROOT, env, stdio: 'ignore' })
  if (found.status === 0) command(['rm', '-f', name], env)
}

const remove_legacy_network = (env) => {
  const found = spawnSync('docker', ['network', 'inspect', LOCAL_NETWORK], { cwd: ROOT, env, stdio: 'ignore' })
  if (found.status === 0) command(['network', 'rm', LOCAL_NETWORK], env)
}

const container_running = (name, env) => {
  const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return result.status === 0 && result.stdout.trim() === 'true'
}

const bound_package = (env) => {
  if (!container_running('aresrpg-falkordb', env)) return null
  return compose(['exec', '-T', 'falkordb', 'redis-cli', '--raw', 'GET', PACKAGE_BINDING_KEY], env, true) || null
}

export const repin_local = async (network = 'testnet') => {
  const pin_env = local_pin_env(PINS, network)
  const env = { ...process.env, ...pin_env }

  console.log(`Repinning local ${network} stack`)
  console.log(`Game · ${pin_env.PACKAGE_ORIGINAL} -> ${pin_env.PACKAGE_LATEST}`)
  console.log(`Seed · ${pin_env.SEED_PACKAGE_ORIGINAL}`)
  compose(['config', '--quiet'], env)
  compose(['build', 'indexer', 'server'], env)

  compose(['down', '--volumes', '--remove-orphans'], env)
  LOCAL_CONTAINERS.forEach((name) => remove_legacy_container(name, env))
  remove_legacy_network(env)
  compose(REPIN_STACK_COMMAND, env)
  compose(['ps'], env)
}

export const reload_local = async (network = 'testnet') => {
  const pin_env = local_pin_env(PINS, network)
  const env = { ...process.env, ...pin_env }

  console.log(`Reloading local ${network} stack`)
  console.log(`Game · ${pin_env.PACKAGE_ORIGINAL} -> ${pin_env.PACKAGE_LATEST}`)
  console.log(`Seed · ${pin_env.SEED_PACKAGE_ORIGINAL}`)
  compose(['config', '--quiet'], env)
  assert_reload_lineage(bound_package(env), pin_env.PACKAGE_ORIGINAL)

  compose(RELOAD_COMPOSE_COMMANDS.build_readers, env)
  compose(RELOAD_COMPOSE_COMMANDS.restart_indexer, env)
  compose(RELOAD_COMPOSE_COMMANDS.restart_server, env)
  compose(['ps'], env)
}

if (import.meta.main) await repin_local()
