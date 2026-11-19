// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { live_value, persistent_value, retired_run } from '../src/store_projection.ts'
import { create_redis_store } from '../src/store.ts'

import { fixture_redis } from './helpers/redis_fixture.ts'

const lane = {
  actor_id: 'actor',
  fence: 1,
  lease_until: 100,
  paused: false,
  decision_revision: 2,
  active_command: 'command-id',
  pending: { bytes: 'signed-bytes', digest: 'digest' },
  observed_at: 20,
  needs_resync: false,
}
const behavior = {
  id: 'run',
  fingerprint: 'authored',
  revision: 1,
  status: 'waiting',
  script: { tree: { type: 'wait' } },
  memory: { completed: ['root/0'], selected: { root: 1 } } as { completed: string[]; selected: Record<string, number> },
  pending_node: 'root/1',
  actions_started: 4,
  execution_fence: 1,
  last_command_id: 'command-id',
  observation: { request: 5 },
}

test('durable allowlists exclude execution and legacy hydration starts at root', () => {
  const saved = persistent_value('behavior:run', behavior)
  expect(saved).toEqual({ id: 'run', fingerprint: 'authored', revision: 1, status: 'active', script: behavior.script })
  const restored = live_value('behavior:run', behavior) as typeof behavior
  expect(restored.memory).toEqual({ completed: [], selected: {} })
  expect(restored.actions_started).toBe(0)
  expect(restored.pending_node).toBeNull()
  expect(restored.execution_fence).toBeUndefined()
  expect(restored.observation).toBeUndefined()
  expect(live_value('behavior:run', saved, behavior)).toMatchObject(behavior)
  const stop = { ...behavior, status: 'stopped' }
  expect((live_value('behavior:run', stop, behavior) as typeof behavior).status).toBe('stopped')
  expect((live_value('behavior:run', { ...behavior, revision: 2 }, behavior) as typeof behavior).actions_started).toBe(
    0
  )
})

test('lane overlays are fence-bound while durable stop dominates local execution', () => {
  expect(persistent_value('lane:wallet', lane)).not.toHaveProperty('pending')
  expect(live_value('lane:wallet', { ...lane, paused: true }, lane)).toMatchObject({
    paused: true,
    pending: lane.pending,
  })
  expect(live_value('lane:wallet', { ...lane, fence: 2 }, lane)).toMatchObject({
    pending: null,
    active_command: null,
    needs_resync: true,
    observed_at: 0,
  })
})

test('stale actor execution cannot clear the next fence busy barrier', () => {
  const next = { ...lane, actor_id: 'next', fence: 2, active_command: null, pending: null, execution_busy: true }
  expect(persistent_value('lane:wallet', next, lane)).toMatchObject({ execution_busy: true })
})

test('a durable resume overrides stale cached lifecycle state of a hero run', () => {
  const definition = { id: 'hero', character_id: 'hero', fingerprint: 'same', status: 'active', revision: 1 }
  for (const status of ['paused', 'awaiting_ai', 'failed', 'stopped']) {
    expect(live_value('behavior:hero', definition, { ...definition, status })).toMatchObject({ status: 'active' })
  }
  expect(live_value('behavior:hero', definition, { ...definition, status: 'waiting' })).toMatchObject({
    status: 'waiting',
  })
})

test('a stored lane forgets its retired wallet-wide run and retired run shapes are recognised, never hosted', () => {
  const lane = { network: 'mainnet', address: '0x1', actor_id: 'a', fence: 1, runs: { hero: 'run' } }
  const stored = { ...lane, profession_run_id: 'old', combat_run_id: 'older', run_ref: { kind: 'behavior', id: 'x' } }
  expect(live_value('lane:mainnet:0x1', stored)).not.toHaveProperty('profession_run_id')
  expect(live_value('lane:mainnet:0x1', stored)).not.toHaveProperty('combat_run_id')
  expect(live_value('lane:mainnet:0x1', stored)).not.toHaveProperty('run_ref')
  expect(live_value('lane:mainnet:0x1', stored)).toMatchObject({ runs: { hero: 'run' } })
  for (const status of ['active', 'waiting']) {
    expect(retired_run('profession:old', { status, plan: {} })).toBe(true)
    expect(retired_run('combat:old', { status, fight: '0x2' })).toBe(true)
    expect(retired_run('behavior:old', { status, script: {} })).toBe(true)
    expect(retired_run('behavior:hero', { status, character_id: 'hero' })).toBe(false)
  }
  expect(retired_run('profession:old', { status: 'stopped' })).toBe(false)
  expect(retired_run('command:old', { status: 'accepted' })).toBe(false)
  expect(retired_run('profession:old', null)).toBe(false)
})

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
integration('Redis retains authority and scripts, never volatile execution, across store lifetimes', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:volatile-fixture:${crypto.randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const replacement = create_redis_store(redis, namespace)
  const keys = ['lane:wallet', 'behavior:run', 'command:c', 'grant:g']
  try {
    await store.transaction(keys, async (tx) => {
      await tx.put(keys[0]!, lane)
      await tx.put(keys[1]!, behavior)
      await tx.put(keys[2]!, { status: 'accepted', payload: 'ephemeral', receipt: 'ephemeral' })
      await tx.put(keys[3]!, { revoked: false })
    })
    expect(await store.read('command:c')).toEqual({ status: 'accepted', payload: 'ephemeral', receipt: 'ephemeral' })
    expect(await replacement.read('command:c')).toBeNull()
    expect(await replacement.read('grant:g')).toEqual({ revoked: false })
    expect(await replacement.read('behavior:run')).toMatchObject({ script: behavior.script, actions_started: 0 })
    expect(await replacement.scan_pending(1)).toEqual(['behavior:run'])
    expect(await store.scan_pending(10)).toEqual(['behavior:run', 'command:c'])
    expect(await redis.send('GET', [`${namespace}:record:command:c`])).toBeNull()
    const saved = await redis.send('GET', [`${namespace}:record:lane:wallet`])
    expect(saved).not.toContain('signed-bytes')
    expect(saved).not.toContain('command-id')
    expect(saved).not.toContain('digest')
    await replacement.transaction(['lane:wallet'], async (tx) => {
      const current = await tx.get<typeof lane>('lane:wallet')
      await tx.put('lane:wallet', { ...current, paused: true })
    })
    expect(await store.read('lane:wallet')).toMatchObject({ paused: true, pending: lane.pending })
    expect(await replacement.read('lane:wallet')).toMatchObject({ execution_busy: true, pending: null })
    await store.transaction(['lane:wallet'], async (tx) => {
      const current = await tx.get<typeof lane>('lane:wallet')
      await tx.put('lane:wallet', { ...current, active_command: null, pending: null })
    })
    expect(await replacement.read('lane:wallet')).toMatchObject({ execution_busy: false })
    await store.transaction(['lane:wallet'], async (tx) => {
      const current = await tx.get<typeof lane>('lane:wallet')
      await tx.put('lane:wallet', { ...current, lease_until: 101 })
    })
    expect(await replacement.read('lane:wallet')).toMatchObject({ execution_busy: false })
    await store.transaction(['lane:wallet'], (tx) => tx.put('lane:wallet', lane))
    await replacement.transaction(['lane:wallet'], (tx) =>
      tx.put('lane:wallet', { ...lane, actor_id: 'next', fence: 2 })
    )
    await store.transaction(['lane:wallet'], async (tx) => {
      const current = await tx.get<typeof lane>('lane:wallet')
      await tx.put('lane:wallet', { ...current, paused: true })
    })
    expect(await replacement.read('lane:wallet')).toMatchObject({
      execution_busy: true,
      pending: lane.pending,
      paused: true,
    })
    await replacement.transaction(['lane:wallet'], (tx) => tx.put('lane:wallet', { ...lane, fence: 2 }))
    expect(await store.read('lane:wallet')).toMatchObject({ pending: null, needs_resync: true })
    await expect(
      store.transaction(['grant:g', 'command:rollback'], async (tx) => {
        await tx.put('command:rollback', { status: 'accepted' })
        await replacement.transaction(['grant:g'], (other) => other.put('grant:g', { revoked: true }))
      })
    ).rejects.toThrow('control_transaction_conflict')
    expect(await store.read('command:rollback')).toBeNull()
  } finally {
    await redis.send('DEL', [namespace, `${namespace}:pending`, ...keys.map((key) => `${namespace}:record:${key}`)])
    redis.close()
  }
})

integration(
  'legacy execution records are ignored without deletion or starving durable pending definitions',
  async () => {
    const redis = fixture_redis(url!)
    await redis.connect()
    const namespace = `bot:legacy-fixture:${crypto.randomUUID()}`
    const store = create_redis_store(redis, namespace)
    // Legacy receipt rows have no reader at all; legacy commands are never restored.
    const keys = ['command:a', 'command:b', 'behavior:run', 'profession:old']
    try {
      await redis.send('SET', [namespace, 'records-v2'])
      for (const key of keys) {
        await redis.send('SET', [
          `${namespace}:record:${key}`,
          JSON.stringify({
            revision: 'legacy',
            value: {
              status: 'active',
              pending: 'legacy-envelope',
              ...(key === 'behavior:run' ? { character_id: 'hero' } : {}),
            },
          }),
        ])
        await redis.send('ZADD', [`${namespace}:pending`, '0', `${namespace}:record:${key}`])
      }
      // Old commands never starve the index. A hero run is found, and so is a stored run of a retired
      // shape: discovery is what lets the actor stop it instead of leaving it indexed forever.
      expect(await store.scan_pending(1)).toEqual(['behavior:run'])
      expect(await store.scan_pending(10)).toEqual(['behavior:run', 'profession:old'])
      expect(await store.scan_pending(1, 'profession:old')).toEqual([])
      expect(retired_run('behavior:run', await store.read('behavior:run'))).toBe(false)
      expect(retired_run('profession:old', await store.read('profession:old'))).toBe(true)
      await store.transaction(['profession:old'], async (tx) => {
        await tx.put('profession:old', { ...(await tx.get<object>('profession:old')), status: 'stopped' })
      })
      expect(await store.scan_pending(10)).toEqual(['behavior:run'])
      expect(await store.read('command:a')).toBeNull()
      expect(await redis.send('GET', [`${namespace}:record:command:a`])).toContain('legacy-envelope')
    } finally {
      await redis.send('DEL', [namespace, `${namespace}:pending`, ...keys.map((key) => `${namespace}:record:${key}`)])
      redis.close()
    }
  }
)

integration('cross-process resume cannot be hidden by a former owner lifecycle cache', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:resume-fixture:${crypto.randomUUID()}`
  const former = create_redis_store(redis, namespace)
  const current = create_redis_store(redis, namespace)
  const key = 'behavior:run'
  try {
    await former.transaction([key], (tx) =>
      tx.put(key, { id: 'run', character_id: 'hero', fingerprint: 'unchanged', revision: 1, status: 'paused' })
    )
    await current.transaction([key], async (tx) => {
      const run = await tx.get<Record<string, unknown>>(key)
      await tx.put(key, { ...run, status: 'active' })
    })
    expect(await former.read(key)).toMatchObject({ status: 'active' })
    expect(await former.scan_pending(10)).toEqual([key])
  } finally {
    await redis.send('DEL', [namespace, `${namespace}:pending`, `${namespace}:record:${key}`])
    redis.close()
  }
})
