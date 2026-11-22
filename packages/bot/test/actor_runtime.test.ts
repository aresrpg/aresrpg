// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'

import { fixture_config, put } from './helpers/control_fixture.ts'
import { runtime_fixture as fixture } from './helpers/runtime_fixture.ts'

test('runtime publishes only fresh authenticated observations and renews same lease', async () => {
  const f = await fixture()
  const command = await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  expect(command).toEqual({ status: 'pending' })
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const result = await f.observe()
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
  expect(result).toMatchObject({ ready: true, frozen: false, state: 'awaiting_ai' })
  const before = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  f.clock.now += 5000
  await f.runtime.renew()
  const after = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  expect(after.fence).toBe(before.fence)
  expect(after.lease_until).toBeGreaterThan(before.lease_until)
  expect(f.errors).toHaveLength(0)
  await f.runtime.stop()
})
test('revoked queued grant never opens or authenticates a socket', async () => {
  const f = await fixture()
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await expect(f.observe()).rejects.toThrow('invalid_token')
  await f.runtime.tick()
  await f.runtime.settle()
  expect(f.sockets).toHaveLength(0)
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
  await f.runtime.stop()
})
test('restore-paused runtime neither provisions nor connects', async () => {
  const f = await fixture()
  const runtime = create_actor_runtime({ ...f.options, config: { ...fixture_config, recovery_mode: true } })
  await expect(runtime.observe(f.grant, {})).rejects.toThrow('observation_unavailable')
  await runtime.tick()
  expect(f.sockets).toHaveLength(0)
  expect(await f.store.read(lane_key_for(f.bot))).toBeNull()
  await runtime.stop()
})

test('unresolved original envelope cannot consume or fail another connector command', async () => {
  const f = await fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const lane_key = lane_key_for(f.bot)
  const lane = (await f.store.read<Lane>(lane_key))!
  const original: Command = {
    id: 'original',
    kind: 'fight_turn',
    status: 'uncertain',
    grant_id: f.grant.id,
    bot_id: f.bot.id,
    lane_key,
    fingerprint: 'original',
    payload: {},
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
  }
  await put(f.store, 'command:original', original)
  await put(f.store, lane_key, {
    ...lane,
    active_command: original.id,
    pending: {
      command_id: original.id,
      grant_id: f.grant.id,
      digest: 'fixture-unresolved',
      phase: 'submitting',
      bytes: Buffer.from([1, 2, 3]).toString('base64'),
      signatures: ['fixture-signature'],
      gas_budget_mist: '100',
    },
  })
  f.clock.now += 1
  const waiting = await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  expect(waiting).toMatchObject({ ready: true })
  expect(await f.store.scan_keys('command:', 100)).toEqual(['command:original'])
  expect((await f.store.read<Command>('command:original'))!.status).toBe('uncertain')
  expect((await f.store.read<Lane>(lane_key))!.pending!.command_id).toBe('original')
  expect(f.sockets).toHaveLength(1)
  await f.runtime.stop()
})

test('wall clock jumps do not advance the retained chain observation', async () => {
  const f = await fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const initial = (await f.observe()) as {
    clock: { observed_at: number; chain_ms: number }
  }
  expect(initial.clock.observed_at).toBe(100)
  for (const wall of [6000, 500]) {
    f.clock.now = wall
    f.clock.monotonic += 10
    const command = await f.observe()
    await f.runtime.tick()
    await f.runtime.settle()
    const result = command as typeof initial
    expect(result.clock).toEqual(initial.clock)
  }
  await f.runtime.stop()
})

test('a server takeover is a fact: renewal reconnects the same lease and observation recovers', async () => {
  const f = await fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const before = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  f.sockets[0]!.handlers.on_close(4000, 'REPLACED')
  await f.runtime.renew()
  expect(f.sockets).toHaveLength(2)
  await f.admit()
  await f.runtime.settle()
  f.clock.now += 1
  expect(await f.observe()).toMatchObject({ ready: true })
  const after = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  expect(after).toMatchObject({ fence: before.fence, decision_revision: before.decision_revision })
  expect(after.paused).toBeFalsy()
  expect(f.errors.map(String)).toEqual(['Error: connection_closed: REPLACED'])
  await f.runtime.stop()
})

test('idle transient disconnect reconnects through the existing lease heartbeat', async () => {
  const f = await fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  f.sockets[0]!.handlers.on_close(1006, 'NETWORK_ERROR')
  f.clock.now += 1000
  await f.runtime.renew()
  expect(f.sockets).toHaveLength(2)
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  expect((await f.store.read<Lane>(lane_key_for(f.bot)))!.needs_resync).toBe(false)
  await f.runtime.stop()
})

test('idle restart waits for a new read instead of scanning historical watches', async () => {
  const f = await fixture()
  const observation = { kind: 'overview', request: 1 }
  await f.observe({ market: observation })
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  const before = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  await f.runtime.stop()
  f.clock.now = before.lease_until + 1
  const restarted = create_actor_runtime({ ...f.options, actor_id: 'replacement' })
  try {
    await restarted.tick()
    await restarted.settle()
    expect(f.sockets).toHaveLength(1)
    await restarted.observe(f.grant, { market: observation })
    await f.admit()
    await restarted.observe(f.grant, { market: observation })
    await restarted.settle()
    expect(f.sockets[1]!.sent.map((raw) => JSON.parse(raw))).toContainEqual({
      type: 'packet/market_observe',
      observation,
    })
    expect((await f.store.read<Lane>(lane_key_for(f.bot)))!.fence).toBeGreaterThan(before.fence)
  } finally {
    await restarted.stop()
  }
})

test('revoking one watcher releases its slot without stopping another live connector', async () => {
  const f = await fixture()
  await f.observe({ market: { kind: 'overview', request: 1 } })
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.observe({ market: { kind: 'overview', request: 1 } })
  const other = { ...f.grant, id: 'other', client_id: 'other-client' }
  await put(f.store, 'grant:other', other)
  await f.runtime.observe(other, {})
  await f.runtime.tick()
  await f.runtime.settle()
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await f.runtime.renew()
  expect(f.sockets[0]!.closed).toBe(false)
  expect(f.sockets[0]!.sent.map((raw) => JSON.parse(raw))).toContainEqual({
    type: 'packet/market_observe',
    observation: null,
  })
  await f.runtime.stop()
})

test('a connector releasing the market view never takes it from the connector that holds it', async () => {
  const f = await fixture()
  await f.observe({})
  await f.admit()
  await f.observe({ market: { kind: 'overview', request: 1 } })
  const other = { ...f.grant, id: 'other', client_id: 'other-client' }
  await put(f.store, 'grant:other', other)
  const sent = () => f.sockets[0]!.sent.map((raw) => JSON.parse(raw) as { type: string; observation?: unknown })
  const before = sent().length
  // A release by another connector is no error and sends nothing; taking the held view still is refused.
  await f.runtime.observe(other, { market: null })
  expect(sent()).toHaveLength(before)
  await expect(f.runtime.observe(other, { market: { kind: 'overview', request: 2 } })).rejects.toThrow(
    'OBSERVATION_SLOT_BUSY'
  )
  await f.observe({ market: null })
  expect(sent().at(-1)).toEqual({ type: 'packet/market_observe', observation: null })
  await f.runtime.stop()
})

test('explicit newly authorized connector replaces an auth-expired actor', async () => {
  const f = await fixture()
  await f.observe()
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  await f.runtime.tick()
  await f.runtime.settle()
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await f.runtime.renew()
  expect(f.sockets[0]!.closed).toBe(true)
  const grant = { ...f.grant, id: 'new', client_id: 'new-client' }
  await put(f.store, 'grant:new', grant)
  await f.runtime.observe(grant, {})
  await f.runtime.tick()
  await f.runtime.settle()
  expect(f.sockets).toHaveLength(2)
  await f.runtime.stop()
})

test('simultaneous reads share one authenticated connection and create no work records', async () => {
  const f = await fixture()
  try {
    await Promise.all([f.observe(), f.observe(), f.observe()])
    expect(f.sockets).toHaveLength(1)
    await f.admit()
    for (const value of await Promise.all([f.observe(), f.observe()])) expect(value).toMatchObject({ ready: true })
    expect(await f.store.scan_pending(100)).toEqual([])
    expect(await f.store.scan_keys('command:', 100)).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('observation readiness follows shared chain expiry even with a longer bot freshness window', async () => {
  const f = await fixture()
  try {
    await f.observe()
    await f.admit()
    await f.runtime.settle()
    expect(await f.observe()).toMatchObject({ ready: true })
    f.clock.monotonic += 19900
    expect(await f.observe()).toEqual({ status: 'pending' })
  } finally {
    await f.runtime.stop()
  }
})

test('unsigned validation failure allows corrected intent after an unchanged fresh observation', async () => {
  const f = await fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  try {
    await f.observe()
    await f.admit()
    await f.runtime.settle()
    const before = (await f.store.read<Lane>(key))!
    const input = {
      idempotency_key: 'invalid-tool',
      kind: 'equip_tool' as const,
      payload: { character_id: `0x${'1'.repeat(64)}`, item_id: `0x${'2'.repeat(64)}` },
      decision_revision: before.decision_revision,
      observation_revision: before.observation_revision,
    }
    const rejected = await control.accept(f.grant, input)
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Command>(`command:${rejected.id}`))?.status).toBe('failed')
    expect((await f.store.read<Lane>(key))?.pending).toBeNull()
    await f.send({ type: 'packet/characters', characters: [] })
    await f.runtime.settle()
    const fresh = (await f.store.read<Lane>(key))!
    expect(fresh.observation_revision).toBe(before.observation_revision)
    expect(fresh.needs_resync).toBe(false)
    expect(
      await control.accept(f.grant, {
        ...input,
        idempotency_key: 'corrected',
        decision_revision: fresh.decision_revision,
        payload: { ...input.payload, item_id: `0x${'3'.repeat(64)}` },
      })
    ).toMatchObject({ status: 'accepted' })
  } finally {
    await f.runtime.stop()
  }
})

test('observation lists the wallet runs for every grant of its owner and hides another bot run', async () => {
  const f = await fixture()
  try {
    await f.observe()
    await f.admit()
    const key = lane_key_for(f.bot)
    const lane = (await f.store.read<Lane>(key))!
    const run = { id: 'hero-run', character_id: 'hero', status: 'awaiting_ai', issue: 'no_behavior_matched' }
    await put(f.store, key, { ...lane, runs: { hero: 'hero-run' } })
    await put(f.store, 'behavior:hero-run', { ...run, grant_id: 'other-grant', bot_id: f.bot.id })
    expect(await f.observe()).toMatchObject({ runs: [run], state: 'awaiting_ai' })
    await put(f.store, 'behavior:hero-run', { ...run, grant_id: f.grant.id, bot_id: 'other-bot' })
    expect(await f.observe()).toMatchObject({ runs: [] })
  } finally {
    await f.runtime.stop()
  }
})

// Owner ruling 2026-11-22: an observation is a status. It returned 700 KB for one hero: every packet,
// the whole bag three times and every zone three times.
test('the status carries no packet, bag or zone, and a detail view answers only its question', async () => {
  const f = await fixture()
  try {
    await f.observe()
    await f.admit()
    const status = (await f.observe()) as Record<string, unknown>
    expect(status).toMatchObject({ characters: [], runs: [], inventory: { stacks: 0, item_types: 0 } })
    for (const key of ['events', 'cursor', 'zones', 'inventory_bonuses']) expect(status).not.toHaveProperty(key)
    expect(status.inventory).not.toHaveProperty('items')
    expect(JSON.stringify(status)).not.toContain('null')
    expect({ ...((await f.observe({ view: 'full' })) as object), balance: null }).toEqual({ ...status, balance: null })
    const zones = (await f.observe({ view: 'zones', nearby: true })) as Record<string, unknown>
    expect(zones).toMatchObject({ view: 'zones', zones: [] })
    for (const key of ['runs', 'characters', 'planning_context', 'decision_revision'])
      expect(zones).not.toHaveProperty(key)
  } finally {
    await f.runtime.stop()
  }
})

test('spell discovery works before a fight and exposes authored unlock levels and casting ranks', async () => {
  const f = await fixture()
  try {
    await f.observe()
    await f.admit()
    expect(await f.observe()).not.toHaveProperty('planning_context.spells')
    const catalog = await f.observe({ spells: [] })
    expect(catalog).toHaveProperty('planning_context.spells.catalog')
    expect(catalog).toMatchObject({
      planning_context: {
        spells: {
          catalog: expect.arrayContaining([
            { name: 'Topkaj', classe: 'asobi', unlock_level: 26 },
            { name: 'Tricky Trap', classe: 'yajin', unlock_level: 1 },
          ]),
        },
      },
    })
    expect(await f.observe({ spells: ['Topkaj'] })).toMatchObject({
      planning_context: {
        spells: {
          definitions: [
            {
              name: 'Topkaj',
              unlock_level: 26,
              levels: expect.arrayContaining([
                expect.objectContaining({ ap_cost: 5, range_min: 1, range_max: 5, effects: expect.any(Array) }),
              ]),
              characters: [],
            },
          ],
        },
      },
    })
  } finally {
    await f.runtime.stop()
  }
})

test('the wallet status goes out on its own socket when it changes, never again while it is the same', async () => {
  const f = await fixture()
  await f.observe()
  await f.admit()
  const flush = () => new Promise((resolve) => setTimeout(resolve, 5))
  const statuses = () =>
    f.sockets
      .at(-1)!
      .sent.map((raw) => JSON.parse(raw) as { type: string; status?: unknown })
      .filter(({ type }) => type === 'packet/agent_status')
  await flush()
  const lane = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  // The authenticated baseline became ready: that is a change, and the owner's clients are told once.
  expect(statuses()).toEqual([
    {
      type: 'packet/agent_status',
      status: {
        ready: true,
        event_fence: lane.fence,
        sampled_at: f.clock.monotonic,
        state: 'idle',
        runs: [],
        direct: null,
        fees_mist: '0',
      },
    },
  ])
  await f.runtime.tick()
  await f.runtime.settle()
  await f.observe()
  await flush()
  expect(statuses()).toHaveLength(1)
  // Another process pauses the wallet: no queue pass runs here, so the lease heartbeat tells the owner.
  await put(f.store, lane_key_for(f.bot), { ...(await f.store.read<Lane>(lane_key_for(f.bot)))!, paused: true })
  await f.runtime.renew()
  await flush()
  expect(statuses().at(-1)).toMatchObject({ status: { state: 'paused' } })
  expect(statuses()).toHaveLength(2)
  expect(f.errors).toHaveLength(0)
  await f.runtime.stop()
})
