// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rebuild the local read stack from the selected pins.json deployment. The graph is a disposable
// projection: every repin removes it, catches the indexer up, then exposes the realtime server.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import PINS from '../pins.json' with { type: 'json' }

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const COMPOSE = join(ROOT, 'compose.yaml')
const INDEXED_CHECKPOINT_KEY = 'idx:checkpoint:latest'
const WAIT_TIMEOUT_MS = 15 * 60 * 1_000
const POLL_MS = 1_000
const LOCAL_CONTAINERS = ['aresrpg-server', 'aresrpg-indexer', 'aresrpg-falkordb']
const LOCAL_NETWORK = 'aresrpg-local'
const GRAPHQL_URL = 'https://graphql.testnet.sui.io/graphql'

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
    throw new Error(`${network} pins are incomplete; finish deployment and seed publication before repinning locally`)
  return Object.freeze(values)
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

const chain_checkpoint = async () => {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query { checkpoint { sequenceNumber } }' }),
  })
  const payload = await response.json()
  const checkpoint = payload.data?.checkpoint?.sequenceNumber
  if (!response.ok || !Number.isSafeInteger(checkpoint))
    throw new Error('The Sui GraphQL service returned no safe checkpoint height')
  return checkpoint
}

const indexed_checkpoint = (env) => {
  const raw = compose(['exec', '-T', 'falkordb', 'redis-cli', '--raw', 'GET', INDEXED_CHECKPOINT_KEY], env, true)
  if (!raw) return null
  const value = JSON.parse(raw)
  return Number.isSafeInteger(value.sequence_number) ? value.sequence_number : null
}

const wait_for_indexer = async (target, env) => {
  const started_at = Date.now()
  let last_reported = 0
  while (Date.now() - started_at < WAIT_TIMEOUT_MS) {
    const running = command(['inspect', '-f', '{{.State.Running}}', 'aresrpg-indexer'], env, true)
    if (running !== 'true') {
      compose(['logs', '--tail', '100', 'indexer'], env)
      throw new Error('The local indexer exited before reaching the target checkpoint')
    }
    const indexed = indexed_checkpoint(env)
    if (indexed !== null && indexed >= target) return indexed
    if (Date.now() - last_reported >= 10_000) {
      console.log(`Indexer catch-up · ${indexed ?? 'booting'} / ${target}`)
      last_reported = Date.now()
    }
    await Bun.sleep(POLL_MS)
  }
  compose(['logs', '--tail', '100', 'indexer'], env)
  throw new Error(`The local indexer did not reach checkpoint ${target} within 15 minutes`)
}

export const repin_local = async (network = 'testnet') => {
  const pin_env = local_pin_env(PINS, network)
  const env = { ...process.env, ...pin_env }
  const target = await chain_checkpoint()

  console.log(`Repinning local ${network} stack at checkpoint ${target}`)
  console.log(`Game · ${pin_env.PACKAGE_ORIGINAL} -> ${pin_env.PACKAGE_LATEST}`)
  console.log(`Seed · ${pin_env.SEED_PACKAGE_ORIGINAL}`)
  compose(['config', '--quiet'], env)
  compose(['build', 'indexer', 'server'], env)

  compose(['down', '--volumes', '--remove-orphans'], env)
  LOCAL_CONTAINERS.forEach((name) => remove_legacy_container(name, env))
  remove_legacy_network(env)
  compose(['up', '-d', 'falkordb', 'indexer'], env)
  const indexed = await wait_for_indexer(target, env)
  console.log(`Indexer caught up · ${indexed}`)
  compose(['up', '-d', 'server'], env)
  compose(['ps'], env)
}

if (import.meta.main) await repin_local()
