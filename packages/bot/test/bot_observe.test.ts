// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the bot reads and tells: observation views, the pushed status, cross-process owner routing and one vertical run.
import { expect, test, describe } from 'bun:test'
import type { AgentStatus } from '@aresrpg/protocol'

import { actor_observation, owned_run_observation } from '../src/actor_observation.ts'
import { current_zones, inventory_view, without_nulls, zones_view } from '../src/actor_observation_views.ts'
import { behavior_condition } from '../src/behavior_facts.ts'
import { type BehaviorScript } from '../src/behavior_script.ts'
import { lane_key_for, type Command, type Lane, empty_lane } from '../src/control.ts'
import { create_status_sharer } from '../src/status_sharer.ts'
import { type ControlStore } from '../src/store.ts'
import { live_value, persistent_value } from '../src/store_projection.ts'

import { character, hero_runs, item, other_input, profession_context, resource } from './fixture_game.ts'
import { runtime_fixture, put, runtime_fixture as fixture, fixture_bot } from './fixture.ts'

describe('actor observation views', () => {
  /** A bag as the report had it: hundreds of stacks of one item. */
  const crowded = () => {
    const context = profession_context()
    const items = Array.from({ length: 300 }, (_, index) => item(other_input, index + 1, 1_000 + index))
    return { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items } }
  }

  test('the bag is one line per item and kiosk, however many stacks it holds', () => {
    const view = inventory_view(crowded(), {})
    expect(view.items).toEqual([
      {
        item_type: other_input,
        name: other_input,
        category: 'resource',
        level: 1,
        kiosk: character.kiosk,
        amount: (300 * 301) / 2,
        available: (300 * 301) / 2,
        stacks: 300,
      },
    ])
    expect(JSON.stringify(view).length).toBeLessThan(1_000)
    expect(inventory_view(crowded(), { category: 'hat' }).items).toEqual([])
  })

  test('a zone says what it holds in counts; its monsters and resources come only when asked', () => {
    const { snapshot } = profession_context()
    const key = 'fixture:97:97'
    expect(current_zones(snapshot.characters)).toEqual({ [character.id]: key })
    const [zone] = zones_view(snapshot, {}).zones
    expect(zone).toMatchObject({
      key,
      zone_x: 97,
      zone_z: 97,
      heroes: [character.id],
      mob_groups: 0,
      resource_packs: 1,
    })
    expect(zone).not.toHaveProperty('mobs')
    expect(zone).not.toHaveProperty('resources')
    const [detailed] = zones_view(snapshot, { resources: true, mobs: true }).zones
    expect(detailed).toMatchObject({ mobs: [], resources: [{ item_type: resource.item_type }] })
    // A hero the wallet does not hold stands nowhere.
    expect(zones_view(snapshot, { character_id: '0xother' }).zones).toEqual([])
  })

  test('the status stays small beside a crowded bag and writes no null', () => {
    const context = profession_context()
    const status = actor_observation({ ...context, snapshot: crowded() })
    expect(status).toMatchObject({ inventory: { loaded: true, stacks: 300, item_types: 1 } })
    expect(status).not.toHaveProperty('zones')
    const wire = JSON.stringify(status)
    expect(wire).not.toContain('null')
    expect(wire.length).toBeLessThan(20_000)
    expect(without_nulls({ a: null, b: [{ c: null, d: 0 }], e: false })).toEqual({ b: [{ d: 0 }], e: false })
  })
})

describe('character observability', () => {
  const hp_condition = { fact: { type: 'hp' as const, character_id: character.id }, op: 'gte' as const, value: 60 }
  test('HP condition follows whole recovery ticks and remains unknown without a fresh chain clock', () => {
    const context = profession_context()
    const current = {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: [{ ...character, hp: '59', hp_ms: context.snapshot.clock!.chain_ms }],
      },
    }
    expect(behavior_condition(hp_condition, current)).toBe(false)
    expect(behavior_condition(hp_condition, { ...current, now: current.now + 1000 })).toBe(true)
    expect(behavior_condition(hp_condition, { ...current, now: current.now + 60000 })).toBeNull()
    expect(behavior_condition(hp_condition, { ...current, snapshot: { ...current.snapshot, ready: false } })).toBeNull()
    expect(
      behavior_condition(hp_condition, {
        ...current,
        snapshot: { ...current.snapshot, characters: [{ ...character, hp: '59' }] },
      })
    ).toBeNull()
  })
  test('balance comparisons are exact MIST and reject stale, foreign, unavailable balances', () => {
    const context = profession_context()
    const condition = { type: 'sui_balance' as const, op: 'gte' as const, value: '9007199254740993' }
    const balance = {
      address: context.address,
      balance_mist: '9007199254740992',
      sampled_at: context.now,
      expires_at: context.now + 5000,
    }
    expect(behavior_condition(condition, { ...context, balance })).toBe(false)
    expect(behavior_condition(condition, { ...context, balance: { ...balance, balance_mist: condition.value } })).toBe(
      true
    )
    expect(behavior_condition(condition, { ...context, balance, now: balance.expires_at })).toBeNull()
    expect(behavior_condition(condition, { ...context, balance: { ...balance, address: 'foreign' } })).toBeNull()
    expect(behavior_condition(condition, context)).toBeNull()
  })

  test('actor observation reads only its multisig and returns explicit exact-MIST freshness', async () => {
    const f = await runtime_fixture()
    const owners: string[] = []
    f.options.sdk_options.client.core.getBalance = async (...args: unknown[]) => {
      owners.push((args[0] as { owner: string }).owner)
      return { balance: { balance: '10000000000', coinBalance: '0', addressBalance: '10000000000' } }
    }
    await f.observe()
    await f.admit()
    await f.runtime.settle()
    const observation = await f.observe()
    expect(observation).toMatchObject({
      balance: {
        address: f.bot.address,
        balance_mist: '10000000000',
        unit: 'MIST',
        mist_per_sui: '1000000000',
        clock: 'monotonic_ms',
      },
    })
    expect(f.errors).toEqual([])
    expect(owners).toEqual([f.bot.address])
    await f.runtime.stop()
  })
})

describe('actor runtime', () => {
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

  test('revoking one watcher releases its slot without stopping another live connector', async () => {
    const f = await fixture()
    await f.observe({ view: 'market', heroes: true })
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.runtime.tick()
    await f.runtime.settle()
    await f.observe({ view: 'market', heroes: true })
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

  test('a market read is pending page by page, holds the one view against another connector, then gives it back', async () => {
    const f = await fixture()
    try {
      await f.observe()
      await f.admit()
      const ask = { view: 'market', item_type: other_input, category: 'resource' }
      const watched = () =>
        f.sockets[0]!.sent.map((raw) => JSON.parse(raw)).filter(({ type }) => type === 'packet/market_observe')
      const slice = (cursor: string | undefined, next_cursor: string | null, listings: readonly unknown[]) =>
        f.send({
          type: 'packet/market_slice',
          observation: { kind: 'offers', category: 'resource', item_type: other_input, cursor, request: 0 },
          listings,
          next_cursor,
          kiosk_versions: { [character.kiosk]: '1' },
        })
      const lot = (n: number, price_mist: string) => ({
        ...item(other_input, 1, n),
        kind: 'item',
        version: '1',
        price_mist,
        seller: '0xseller',
        at_ms: 1,
      })
      expect(await f.observe(ask)).toMatchObject({ view: 'market', status: 'pending' })
      await slice(undefined, 'next', [lot(1, '30')])
      expect(await f.observe(ask)).toMatchObject({ status: 'pending' })
      expect(watched().map(({ observation }) => observation.cursor)).toEqual([undefined, 'next'])
      await slice('next', null, [lot(2, '20')])
      expect(await f.observe(ask)).toMatchObject({ view: 'market', total_offers: 2, offers: [{ price_mist: '20' }] })
      // Asking again sends nothing: the view already shows this question.
      expect(watched()).toHaveLength(2)
      const other = { ...f.grant, id: 'other', client_id: 'other-client' }
      await put(f.store, 'grant:other', other)
      expect(await f.runtime.observe(other, { view: 'market', heroes: true })).toMatchObject({
        view: 'market',
        status: 'busy',
      })
      expect(await f.observe({ view: 'market', release: true })).toMatchObject({ view: 'market', released: true })
      expect(watched().at(-1)).toEqual({ type: 'packet/market_observe', observation: null })
      expect(await f.runtime.observe(other, { view: 'market', heroes: true })).toMatchObject({ status: 'pending' })
      expect(await f.observe(ask)).toMatchObject({ view: 'market', status: 'busy' })
      expect(f.errors).toEqual([])
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
})

describe('status sharer', () => {
  const fixture = hero_runs
  const lane_key = `lane:mainnet:${fixture_bot.address}`
  const lane = { ...empty_lane(fixture_bot), lease_until: 60_000 }
  const objective = { title: 'Herbalist level 30', description: 'Gather, then craft.', steps: ['Gather plants'] }
  const run = {
    id: 'current',
    bot_id: fixture_bot.id,
    lane_key,
    character_id: 'hero',
    status: 'active',
    script: { version: '1', objective, tree: { type: 'wait' } },
  }

  /** A wallet's records as the sharer reads them; each share reports the status it sent, or none. */
  const wallet = (records: Readonly<Record<string, unknown>>) => {
    const rows = new Map<string, unknown>(Object.entries({ [`bot:${fixture_bot.id}`]: fixture_bot, ...records }))
    const sent: AgentStatus[] = []
    let connected = true
    let ready = true
    const sharer = create_status_sharer(
      { read: async (key: string) => rows.get(key) ?? null } as unknown as ControlStore,
      fixture_bot,
      7,
      () => ready,
      () => 1_000,
      () => 10,
      async (packet) => {
        if (!connected) return false
        if (packet.type === 'packet/agent_status') sent.push(packet.status)
        return true
      }
    )
    return {
      connect: (next: boolean) => {
        connected = next
        ready = next
      },
      put: (key: string, value: unknown) => rows.set(key, value),
      share: async (always = false) => {
        const before = sent.length
        await sharer.share(always)
        return sent.length > before ? sent.at(-1)! : null
      },
      observed: sharer.observed,
      sent,
    }
  }

  test('a hero run is told with its authored objective and issue; an ended run leaves the wallet idle', async () => {
    const w = wallet({ [lane_key]: { ...lane, runs: { hero: 'current' } }, 'behavior:current': run })
    expect(await w.share()).toMatchObject({
      state: 'active',
      runs: [{ id: 'current', character_id: 'hero', status: 'active', objective }],
    })
    w.put('behavior:current', { ...run, status: 'awaiting_ai', issue: 'Supplies unavailable' })
    expect(await w.share()).toMatchObject({
      state: 'awaiting_ai',
      runs: [{ status: 'awaiting_ai', issue: 'Supplies unavailable', objective }],
    })
    w.put('behavior:current', { ...run, status: 'completed' })
    expect(await w.share()).toMatchObject({ state: 'idle', runs: [{ status: 'completed' }] })
    w.put(lane_key, { ...lane, runs: { hero: 'current' }, paused: true })
    expect(await w.share()).toMatchObject({ state: 'paused' })
  })

  test('an unchanged status is not sent again, except to an owner who just started watching', async () => {
    const w = wallet({ [lane_key]: lane })
    // The baseline became ready: that is told once.
    await w.observed({ type: 'packet/pong' })
    expect(w.sent).toMatchObject([{ ready: true, state: 'idle', sampled_at: 10 }])
    expect(await w.share()).toBeNull()
    await w.observed({ type: 'packet/pong' })
    expect(w.sent).toHaveLength(1)
    await w.observed({ type: 'packet/agent_status_wanted' })
    expect(w.sent).toHaveLength(2)
  })

  /** A tree that harvests until its hero holds the level it was sent for. The fixture hero already does,
   * so its first tick ends it. `reason` is what its author wrote on the end. */
  const until_level = (reason?: string): BehaviorScript => ({
    version: '1',
    objective: { title: 'Reach level 1' },
    tree: {
      type: 'loop',
      child: {
        type: 'selector',
        children: [
          {
            type: 'sequence',
            children: [
              {
                type: 'condition',
                condition: { fact: { type: 'level', character_id: character.id }, op: 'gte', value: 1 },
              },
              { type: 'complete', ...(reason ? { reason } : {}) },
            ],
          },
          {
            type: 'action',
            action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
          },
        ],
      },
    },
  })
  /** The real control, run tick and store of one wallet, and the owner who watches its pushed status. */
  const watched = async () => {
    const f = await fixture()
    const sent: AgentStatus[] = []
    const sharer = create_status_sharer(
      f.store,
      f.bot,
      f.first_fence,
      () => true,
      () => f.clock.now,
      () => 10,
      async (packet) => {
        if (packet.type === 'packet/agent_status') sent.push(packet.status)
        return true
      }
    )
    let started = 0
    return {
      ...f,
      begin: (script: BehaviorScript) => {
        started += 1
        const idempotency_key = `start-${started}`
        return f.control.start_behavior(f.grant, {
          idempotency_key,
          script,
          decision_revision: 0,
          observation_revision: 1,
        })
      },
      /** The status this share sent to the owner, or null when it sent none. */
      share: async (always = false) => {
        const before = sent.length
        await sharer.share(always)
        return sent.length > before ? sent.at(-1)! : null
      },
    }
  }

  test('a run that ends because its target is reached is told with its reason until its hero starts again', async () => {
    const w = await watched()
    const run = await w.begin(until_level('objective_reached'))
    expect((await w.share())?.runs).toMatchObject([{ id: run.id, status: 'active' }])
    expect(await w.tick(run.id)).toBe('completed')
    // The ended run gave its slot back, and the owner is told why it ended.
    expect((await w.lane()).runs).toEqual({})
    const told = await w.share()
    expect(told).toMatchObject({
      state: 'idle',
      runs: [
        {
          id: run.id,
          character_id: character.id,
          status: 'completed',
          ended: 'objective_reached',
          objective: { title: 'Reach level 1' },
          fees_mist: '0',
        },
      ],
    })
    // Nothing moved: it is not sent twice. An owner who starts watching later is still told.
    expect(await w.share()).toBeNull()
    expect((await w.share(true))?.runs).toEqual(told!.runs)
    // A read of the bot says the same, and a restart of the bot keeps it.
    const read = await owned_run_observation(w.store, await w.lane(), { bot_id: w.bot.id })
    expect(read.runs).toMatchObject([{ id: run.id, status: 'completed', ended: 'objective_reached' }])
    const stored = persistent_value(w.key, await w.lane())
    expect(live_value(w.key, stored)).toMatchObject({ ended: { [run.id]: 'objective_reached' } })
    // The hero starts again: its last ending is no longer told.
    const again = await w.begin(until_level('objective_reached'))
    expect((await w.lane()).ended).toEqual({})
    const restarted = (await w.share())!.runs
    expect(restarted).toMatchObject([{ id: again.id, status: 'active' }])
    expect(restarted[0]).not.toHaveProperty('ended')
    await w.runtime.stop()
  })
})
