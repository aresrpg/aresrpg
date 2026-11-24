// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The durable store on a real Redis: atomic commits, expiry, the pending index and what survives a restart.
import { expect, test } from 'bun:test'

import { empty_inventory } from '../src/actor_inventory.ts'
import { fold_actor_market } from '../src/actor_market.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import type { AuthorizationRequest, OwnerChallenge } from '../src/model.ts'
import { run_tick } from '../src/run_runtime.ts'
import { create_redis_store } from '../src/store.ts'
import { live_value, persistent_value, retired_run } from '../src/store_projection.ts'

import {
  REDIS_URL,
  fixture_bot,
  fixture_config,
  fixture_redis,
  grant_of,
  http_fixture,
  integration,
  redis_space,
} from './fixture.ts'
import { character, profession_context, resource } from './fixture_game.ts'

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

test('R3 a stored record keeps authority and authored scripts, never execution; a durable stop or resume wins over a stale cache', () => {
  const saved = persistent_value('behavior:run', behavior)
  expect(saved).toEqual({ id: 'run', fingerprint: 'authored', revision: 1, status: 'active', script: behavior.script })
  const restored = live_value('behavior:run', behavior) as typeof behavior
  expect([
    restored.memory,
    restored.actions_started,
    restored.pending_node,
    restored.execution_fence,
    restored.observation,
  ] as unknown[]).toEqual([{ completed: [], selected: {} }, 0, null, undefined, undefined])
  expect(live_value('behavior:run', saved, behavior)).toMatchObject(behavior)
  expect((live_value('behavior:run', { ...behavior, status: 'stopped' }, behavior) as typeof behavior).status).toBe(
    'stopped'
  )
  expect((live_value('behavior:run', { ...behavior, revision: 2 }, behavior) as typeof behavior).actions_started).toBe(
    0
  )
  const definition = { id: 'hero', character_id: 'hero', fingerprint: 'same', status: 'active', revision: 1 }
  for (const status of ['paused', 'awaiting_ai', 'failed', 'stopped'])
    expect(live_value('behavior:hero', definition, { ...definition, status })).toMatchObject({ status: 'active' })
  expect(live_value('behavior:hero', definition, { ...definition, status: 'waiting' })).toMatchObject({
    status: 'waiting',
  })
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
  const next = { ...lane, actor_id: 'next', fence: 2, active_command: null, pending: null, execution_busy: true }
  expect(persistent_value('lane:wallet', next, lane)).toMatchObject({ execution_busy: true })
  // A stored lane forgets its retired wallet-wide run, and retired run shapes are recognised, never hosted.
  const wallet = { network: 'mainnet', address: '0x1', actor_id: 'a', fence: 1, runs: { hero: 'run' } }
  const stored = live_value('lane:mainnet:0x1', {
    ...wallet,
    profession_run_id: 'old',
    combat_run_id: 'older',
    run_ref: { kind: 'behavior', id: 'x' },
  })
  expect(
    Object.keys(stored as object).filter((key) => ['profession_run_id', 'combat_run_id', 'run_ref'].includes(key))
  ).toEqual([])
  for (const status of ['active', 'waiting'])
    expect([
      retired_run('profession:old', { status, plan: {} }),
      retired_run('combat:old', { status, fight: '0x2' }),
      retired_run('behavior:old', { status, script: {} }),
      retired_run('behavior:hero', { status, character_id: 'hero' }),
    ]).toEqual([true, true, true, false])
  expect([
    retired_run('profession:old', { status: 'stopped' }),
    retired_run('command:old', { status: 'accepted' }),
    retired_run('profession:old', null),
  ]).toEqual([false, false, false])
})

integration(
  'R1 R2 Redis commits atomically: a race, a crash, an unlocked key, an ABA change or an invalid value commits nothing',
  async () => {
    const first = await redis_space()
    const second = fixture_redis(REDIS_URL!)
    await second.connect()
    const stores = [first.store, create_redis_store(second, first.namespace)]
    try {
      let entered = 0
      let release!: () => void
      const barrier = new Promise<void>((resolve) => (release = resolve))
      const results = await Promise.allSettled(
        stores.map((store) =>
          store.transaction(['authority', 'record'], async (tx) => {
            expect(await tx.get('authority')).toBeNull()
            entered += 1
            if (entered === 2) release()
            await barrier
            await tx.put('authority', { pending: null })
            await tx.put('record', { digest: 'synthetic' })
          })
        )
      )
      expect([entered, results.filter(({ status }) => status === 'fulfilled').length]).toEqual([2, 1])
      const crash = stores[0]!.transaction(['authority', 'record'], async (tx) => {
        await tx.put('authority', 99)
        await tx.put('record', 99)
        throw new Error('fixture crash')
      })
      await expect(crash).rejects.toThrow('fixture crash')
      expect([await stores[1]!.read('authority'), await stores[1]!.read('record')]).toEqual([
        { pending: null },
        { digest: 'synthetic' },
      ])
      await expect(stores[0]!.transaction(['authority'], (tx) => tx.put('unlocked', 1))).rejects.toThrow(
        'CONTROL_KEY_NOT_LOCKED'
      )
      await expect(stores[0]!.transaction(['authority'], (tx) => tx.get('unlocked'))).rejects.toThrow(
        'CONTROL_KEY_NOT_LOCKED'
      )
      await stores[0]!.transaction(['authority'], async (tx) => {
        await tx.put('authority', { fence: 2 })
        expect(await tx.get('authority')).toEqual({ fence: 2 })
      })
      expect(await stores[1]!.read('authority')).toEqual({ fence: 2 })
      expect([
        await stores[1]!.scan_keys('', 1),
        await stores[1]!.scan_keys('', 1, 'authority'),
        await stores[1]!.scan_keys('rec', 10),
      ]).toEqual([['authority'], ['record'], ['record']])
      await expect(stores[0]!.scan_keys('', 0)).rejects.toThrow('INVALID_SCAN_LIMIT')
      await expect(stores[0]!.transaction(['authority'], (tx) => tx.put('authority', undefined))).rejects.toThrow(
        'INVALID_CONTROL_VALUE'
      )
      await first.store.transaction(['grant'], (tx) => tx.put('grant', { revoked: false }))
      const aba = first.store.transaction(['grant'], async (tx) => {
        expect(await tx.get('grant')).toEqual({ revoked: false })
        await stores[1]!.transaction(['grant'], (other) => other.put('grant', { revoked: true }))
        await stores[1]!.transaction(['grant'], (other) => other.put('grant', { revoked: false }))
      })
      await expect(aba).rejects.toThrow('control_transaction_conflict')
      expect(await first.store.transaction([], async () => 'empty')).toBe('empty')
    } finally {
      second.close()
      await first.dispose()
    }
  }
)

integration(
  'R4 Redis expires temporary records itself, a proof with its request; rewrites keep the deadline; invalid or passed deadlines commit nothing',
  async () => {
    const f = await redis_space()
    try {
      const expires_at = Date.now() + 150
      const temporary = ['request:idle', 'challenge:idle', 'client:idle', 'grant:code']
      const durable = ['client:approved', 'grant:active', 'grant:revoked']
      await f.store.transaction([...temporary, ...durable, 'command:receipt', 'request:pairing'], async (tx) => {
        for (const key of temporary.slice(0, 3)) await tx.put(key, { expires_at })
        await tx.put('grant:code', { code: { expires_at, used: false }, family: null, access: null })
        await tx.put('client:approved', { id: 'approved' })
        await tx.put('grant:active', { code: { expires_at, used: true }, family: { used_hashes: ['replay'] } })
        await tx.put('grant:revoked', { code: { expires_at, used: false }, revoked: true })
        await tx.put('command:receipt', { status: 'completed', digest: 'synthetic' })
        await tx.put('request:pairing', { expires_at })
      })
      await f.store.transaction(['proof:pairing:nonce'], (tx) =>
        tx.put('proof:pairing:nonce', { status: 'pending', bot_id: 'bot' })
      )
      expect(await f.redis.send('PEXPIRETIME', [f.key('proof:pairing:nonce')])).toBe(expires_at)
      for (const key of temporary) expect(await f.redis.send('PTTL', [f.key(key)])).toBeGreaterThan(0)
      await Bun.sleep(200)
      // Direct Redis commands prove this is native expiry, not application reads or cleanup.
      for (const key of [...temporary, 'command:receipt', 'proof:pairing:nonce'])
        expect(await f.redis.send('EXISTS', [f.key(key)])).toBe(0)
      for (const key of durable) expect(await f.redis.send('PTTL', [f.key(key)])).toBe(-1)
      expect(await f.store.scan_keys('request:', 10)).toEqual([])
      await expect(
        f.store.transaction(['proof:orphan:nonce'], (tx) => tx.put('proof:orphan:nonce', { status: 'pending' }))
      ).rejects.toThrow('INVALID_CONTROL_EXPIRY')
      const later = Date.now() + 10000
      await f.store.transaction(['request:fixed'], (tx) => tx.put('request:fixed', { expires_at: later }))
      const deadline = await f.redis.send('PEXPIRETIME', [f.key('request:fixed')])
      await f.store.transaction(['request:fixed'], async (tx) =>
        tx.put('request:fixed', { ...(await tx.get<AuthorizationRequest>('request:fixed')), consumed: true })
      )
      expect(await f.redis.send('PEXPIRETIME', [f.key('request:fixed')])).toBe(deadline)
      for (const invalid of [NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1, Date.now() - 1]) {
        const write = f.store.transaction(['challenge:invalid', 'grant:partial'], async (tx) => {
          await tx.put('grant:partial', { revoked: true })
          await tx.put('challenge:invalid', { expires_at: invalid })
        })
        await expect(write).rejects.toThrow(
          invalid > 1 && invalid < Number.MAX_SAFE_INTEGER && Number.isInteger(invalid)
            ? 'control_transaction_conflict'
            : 'INVALID_CONTROL_EXPIRY'
        )
        expect(await f.store.read('grant:partial')).toBeNull()
      }
      await f.store.transaction(['challenge:race'], (tx) =>
        tx.put('challenge:race', { expires_at: later, consumed: false })
      )
      let calls = 0
      const race = f.store.transaction(['challenge:race', 'grant:new'], async (tx) => {
        calls += 1
        await tx.put('challenge:race', { ...(await tx.get<OwnerChallenge>('challenge:race')), consumed: true })
        await tx.put('grant:new', { code: { expires_at: later, used: false } })
        await f.redis.send('PEXPIREAT', [f.key('challenge:race'), String(Date.now() - 1)])
      })
      await expect(race).rejects.toThrow('control_transaction_conflict')
      expect([calls, await f.store.read('grant:new'), await f.store.read('challenge:race')]).toEqual([1, null, null])
    } finally {
      await f.dispose()
    }
  }
)

integration(
  'R3 the pending index survives a restart with every definition and forgets commands; an old snapshot or wrong schema is refused',
  async () => {
    const f = await redis_space()
    const recorded: string[][] = []
    const unsubscribe = f.store.subscribe_pending!((keys) => recorded.push([...keys]))
    try {
      const history = Array.from({ length: 1000 }, (_, index) => `command:history-${index}`)
      const rollback = f.store.transaction(['command:rollback'], async (tx) => {
        await tx.put('command:rollback', { status: 'accepted' })
        throw new Error('rollback')
      })
      await expect(rollback).rejects.toThrow('rollback')
      expect(recorded).toEqual([])
      await f.store.transaction([...history, 'command:pending', 'behavior:hero'], async (tx) => {
        for (const key of history) await tx.put(key, { status: 'completed' })
        await tx.put('command:pending', { status: 'uncertain' })
        await tx.put('behavior:hero', { id: 'hero', character_id: 'hero', status: 'waiting' })
      })
      expect(recorded).toEqual([['command:pending', 'behavior:hero']])
      unsubscribe()
      const restarted = create_redis_store(f.redis, f.namespace)
      // A restarted process finds the hero run and none of the commands, wherever its cursor starts.
      expect([
        await restarted.scan_pending(1),
        await restarted.scan_pending(1, 'behavior:'),
        await restarted.scan_pending(1, 'behavior:hero'),
      ]).toEqual([['behavior:hero'], ['behavior:hero'], []])
      expect(await f.store.scan_pending(10)).toEqual(['behavior:hero', 'command:pending'])
      await f.store.transaction(['command:pending', 'behavior:hero'], async (tx) => {
        await tx.put('command:pending', { status: 'completed' })
        await tx.put('behavior:hero', { id: 'hero', character_id: 'hero', status: 'awaiting_ai' })
      })
      expect([
        await restarted.scan_pending(10),
        await restarted.read('command:pending'),
        await f.store.read('command:pending'),
      ]).toEqual([[], null, { status: 'completed' }])
      expect(recorded).toHaveLength(1)
      // A durable resume written by the current owner is never hidden by a former owner's cache.
      await restarted.transaction(['behavior:run'], (tx) =>
        tx.put('behavior:run', { id: 'run', character_id: 'hero', fingerprint: 'same', revision: 1, status: 'paused' })
      )
      await f.store.transaction(['behavior:run'], async (tx) =>
        tx.put('behavior:run', { ...(await tx.get<object>('behavior:run')), status: 'active' })
      )
      expect([await restarted.read('behavior:run'), await restarted.scan_pending(10)]).toEqual([
        expect.objectContaining({ status: 'active' }),
        ['behavior:run'],
      ])
      const old = await redis_space()
      try {
        await old.redis.send('HSET', [
          old.namespace,
          'command:unresolved',
          JSON.stringify({ revision: 'legacy', value: { status: 'uncertain' } }),
        ])
        await expect(old.store.scan_pending(10)).rejects.toThrow('UNSUPPORTED_CONTROL_SCHEMA')
        await expect(old.store.transaction(['new'], (tx) => tx.put('new', {}))).rejects.toThrow(
          'UNSUPPORTED_CONTROL_SCHEMA'
        )
        await expect(old.store.read('command:unresolved')).rejects.toThrow('UNSUPPORTED_CONTROL_SCHEMA')
        expect([
          await old.redis.send('HGET', [old.namespace, 'command:unresolved']),
          await old.redis.send('GET', [old.key('new')]),
        ]).toEqual([expect.stringContaining('uncertain'), null])
      } finally {
        await old.dispose()
      }
    } finally {
      unsubscribe()
      await f.dispose()
    }
  }
)

integration(
  'R3 a stored lane keeps authority and the busy barrier across stores, never signed bytes; a cross-store write conflicts',
  async () => {
    const f = await redis_space()
    const replacement = create_redis_store(f.redis, f.namespace)
    const keys = ['lane:wallet', 'behavior:run', 'command:c', 'grant:g']
    try {
      await f.store.transaction(keys, async (tx) => {
        await tx.put(keys[0]!, lane)
        await tx.put(keys[1]!, behavior)
        await tx.put(keys[2]!, { status: 'accepted', payload: 'ephemeral', receipt: 'ephemeral' })
        await tx.put(keys[3]!, { revoked: false })
      })
      expect([
        await f.store.read('command:c'),
        await replacement.read('command:c'),
        await replacement.read('grant:g'),
      ]).toEqual([{ status: 'accepted', payload: 'ephemeral', receipt: 'ephemeral' }, null, { revoked: false }])
      expect(await replacement.read('behavior:run')).toMatchObject({ script: behavior.script, actions_started: 0 })
      expect([await replacement.scan_pending(1), await f.store.scan_pending(10)]).toEqual([
        ['behavior:run'],
        ['behavior:run', 'command:c'],
      ])
      const saved = await f.redis.send('GET', [f.key('lane:wallet')])
      for (const secret of ['signed-bytes', 'command-id', 'digest']) expect(saved).not.toContain(secret)
      const write = (store: typeof f.store, patch: object) =>
        store.transaction(['lane:wallet'], async (tx) =>
          tx.put('lane:wallet', { ...(await tx.get<object>('lane:wallet')), ...patch })
        )
      await write(replacement, { paused: true })
      expect([await f.store.read('lane:wallet'), await replacement.read('lane:wallet')]).toEqual([
        expect.objectContaining({ paused: true, pending: lane.pending }),
        expect.objectContaining({ execution_busy: true, pending: null }),
      ])
      await write(f.store, { active_command: null, pending: null })
      expect(await replacement.read('lane:wallet')).toMatchObject({ execution_busy: false })
      await f.store.transaction(['lane:wallet'], (tx) => tx.put('lane:wallet', lane))
      await replacement.transaction(['lane:wallet'], (tx) =>
        tx.put('lane:wallet', { ...lane, actor_id: 'next', fence: 2 })
      )
      await write(f.store, { paused: true })
      expect(await replacement.read('lane:wallet')).toMatchObject({
        execution_busy: true,
        pending: lane.pending,
        paused: true,
      })
      await replacement.transaction(['lane:wallet'], (tx) => tx.put('lane:wallet', { ...lane, fence: 2 }))
      expect(await f.store.read('lane:wallet')).toMatchObject({ pending: null, needs_resync: true })
      const conflict = f.store.transaction(['grant:g', 'command:rollback'], async (tx) => {
        await tx.put('command:rollback', { status: 'accepted' })
        await replacement.transaction(['grant:g'], (other) => other.put('grant:g', { revoked: true }))
      })
      await expect(conflict).rejects.toThrow('control_transaction_conflict')
      expect(await f.store.read('command:rollback')).toBeNull()
    } finally {
      await f.dispose()
    }
  }
)

integration(
  'R3 R8 after a Redis restart a hero run reloads its tree from the root, never its execution history; health follows the connection',
  async () => {
    const f = await redis_space()
    const second = fixture_redis(REDIS_URL!)
    const restored = create_redis_store(second, f.namespace)
    const now = 63_000
    const grant = grant_of(fixture_bot)
    try {
      expect((await http_fixture(f.store).request('/health')).status).toBe(200)
      await f.store.transaction([`bot:${fixture_bot.id}`, 'grant:grant'], async (tx) => {
        await tx.put(`bot:${fixture_bot.id}`, fixture_bot)
        await tx.put('grant:grant', grant)
      })
      const control = create_control_service(f.store, fixture_config, 60000, () => now)
      const lease = await control.acquire(fixture_bot, 'actor', 10000)
      const lane_key = lane_key_for(fixture_bot)
      await control.observed(lane_key, 'actor', lease.fence, true)
      const observation = { kind: 'offers', category: 'resource', item_type: resource.item_type, request: 1 } as const
      const gather = { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' }
      const run = await control.start_behavior(grant, {
        idempotency_key: 'persistent',
        decision_revision: 0,
        observation_revision: 1,
        script: {
          version: '1',
          objective: { title: 'Observe then gather' },
          tree: {
            type: 'sequence',
            children: [
              { type: 'action', action: { type: 'observe_market', observation } },
              { type: 'action', action: gather },
              { type: 'complete' },
            ],
          },
        },
      })
      const base = profession_context()
      const market = fold_actor_market(empty_inventory(), {
        type: 'packet/market_slice',
        observation,
        listings: [],
        next_cursor: null,
        kiosk_versions: {},
      })
      const context = { ...base, snapshot: { ...base.snapshot, inventory: market } }
      await run_tick({
        config: fixture_config,
        actor_id: 'actor',
        fence: lease.fence,
        context,
        now,
        store: f.store,
        run,
      })
      const key = `behavior:${run.id}`
      const accepted = (await f.store.read<BehaviorRun>(key))!
      expect([accepted.memory.completed, accepted.pending_node, accepted.actions_started]).toEqual([
        ['root/0'],
        'root/1',
        1,
      ])
      const command = (await f.store.read<Command>(`command:${accepted.last_command_id}`))!
      f.redis.close()
      expect((await http_fixture(f.store).request('/health')).status).toBe(503)
      await second.connect()
      expect((await http_fixture(restored).request('/health')).status).toBe(200)
      const restarted = (await restored.read<BehaviorRun>(key))!
      expect(restarted.script).toEqual(accepted.script)
      expect(restarted).toMatchObject({
        actions_started: 0,
        last_command_id: null,
        pending_node: null,
        memory: { completed: [], selected: {} },
        activation: null,
        consumed_command_id: null,
      })
      expect([
        (await restored.scan_pending(10)).includes(key),
        (await restored.scan_pending(10)).includes(`command:${command.id}`),
        await restored.read(`command:${command.id}`),
      ]).toEqual([true, false, null])
      const later = now + 10001
      const next_control = create_control_service(restored, fixture_config, 60000, () => later)
      const next_lease = await next_control.acquire(fixture_bot, 'replacement', 10000)
      const next = {
        config: fixture_config,
        store: restored,
        actor_id: 'replacement',
        fence: next_lease.fence,
        now: later,
      }
      expect(await run_tick({ ...next, run: restarted, context })).toBe('waiting')
      await next_control.observed(lane_key, 'replacement', next_lease.fence, true)
      const revision = (await restored.read<Lane>(lane_key))!.observation_revision
      const fresh = {
        ...context,
        command: { ...context.command, observation_revision: revision },
        snapshot: { ...context.snapshot, observation_revision: revision },
      }
      await run_tick({ ...next, run: (await restored.read<BehaviorRun>(key))!, context: fresh })
      const resumed = (await restored.read<BehaviorRun>(key))!
      expect([resumed.actions_started, resumed.pending_node, resumed.last_command_id === command.id]).toEqual([
        1,
        'root/1',
        false,
      ])
      expect(await second.send('PTTL', [f.key(key)])).toBe(-1)
    } finally {
      const keys: string[] = await second.send('KEYS', [`${f.namespace}*`])
      if (keys.length) await second.send('DEL', keys)
      second.close()
      f.redis.close()
    }
  }
)
