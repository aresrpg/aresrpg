// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { zone_of } from '@aresrpg/protocol'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import type { AuthSession } from '../../src/auth.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { create_app, type AppInput, type AppState, type AppContext } from '../../src/store.ts'
import { observe_automation, reduce_automation } from '../../src/modules/automation.ts'

import { automation_fixture, character, key, resource, tick } from './automation_fixture.ts'

const initialize_automation_app = (app: ReturnType<typeof create_app>, wallet: AuthSession): void => {
  const base = automation_fixture()
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character()] } })
  app.dispatch({ type: 'character/select', character_id: 'alice' })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/game_state', frozen: false } })
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/server_info',
      online: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: Date.now(),
      chain_sample_age_ms: 0,
    },
  })
  // The checkpoint-head heartbeat can trail live action time; it must not add another root.
  app.dispatch({
    type: 'clock/observed',
    chain_ms: Date.now() - 5_000,
    received_ms: performance.now(),
    sample_age_ms: 5_000,
  })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/tracked_zones', character_id: 'alice', world: 'nauvis', zones: [{ zx: 97, zz: 97 }] },
  })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/zones', zones: [base.world.zones[key]!] } })
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/zone_spawns',
      world: 'nauvis',
      zx: 97,
      zz: 97,
      mobs: [...base.world.spawns[key]!.mobs],
      resources: [...base.world.spawns[key]!.resources],
    },
  })
}

test('the world observer confirms sequential harvests and reports the exact protector attempt to automation', async () => {
  const app = create_app()
  const base = automation_fixture()
  let gathers = 0
  let ambushes = 0
  let finish_gather: () => void = () => {
    throw new Error('No pending harvest')
  }
  const forfeits: unknown[] = []
  const checkpoint = {
    contract: {
      id: 'protector',
      ended: false,
      dungeon: null,
      wagered: false,
      round: 0n,
      turn_ptr: 0n,
      turn_started_ms: 0n,
      started_ms: null,
      fighters: [
        { kind: { type: 'player', character: 'alice', owner: 'owner' }, dead: false, forfeited: false, settled: false },
      ],
    },
  } as HydratedFightCheckpoint
  const wallet = {
    address: 'owner',
    fight: {
      forfeit: async (input: unknown) => {
        forfeits.push(input)
        return {}
      },
    },
    character: {
      gather: () => {
        gathers += 1
        // Model the certified checkpoint root and consumption arriving before the promise reply.
        app.dispatch({
          type: 'server/packet',
          packet: { type: 'packet/characters', characters: [{ ...character(), at_ms: Date.now() + 2 }] },
        })
        app.dispatch({
          type: 'server/packet',
          packet: { type: 'packet/zones', zones: [{ ...base.world.zones[key]!, res_taken: [gathers] }] },
        })
        return new Promise((resolve) => {
          const ambushed = gathers === 2
          finish_gather = () => resolve({ quantity: 2, ambushed })
        })
      },
      resolve_ambush: async () => {
        ambushes += 1
        // The fight is known before its roster/mount activates the remote command path.
        app.dispatch({ type: 'fight/cached', checkpoint })
        return { fight: 'protector' }
      },
    },
  } as unknown as AuthSession
  initialize_automation_app(app, wallet)
  publish_pose({ ...tick().pose!, x: -100 })
  const close = app.observe(['world', 'automation', 'fight_chain'])
  try {
    app.dispatch({ type: 'automation/unlocked' })
    app.dispatch({ type: 'automation/resource', item_type: resource.item_type })
    app.dispatch({ type: 'automation/start', id: 'integration' })
    expect(gathers).toBe(0)
    expect(app.store.getState().run_to.run?.source).toBe('automation')
    await Bun.sleep(55)
    publish_pose({ ...tick().pose!, x: -10 })
    // Pose arrival inside the manual interaction radius stops travel and gathers immediately.
    expect(gathers).toBe(1)
    expect(app.store.getState().run_to.run).toBeNull()
    // The first root expires while its receipt is still pending. Receipt completion must
    // release the old pack lock and submit the next gather in the same microtask, not a poll.
    await Bun.sleep(10)
    finish_gather()
    await Promise.resolve()
    expect(gathers).toBe(2)
    finish_gather()
    await Promise.resolve()
    await Promise.resolve()
    const { step } = app.store.getState().automation.run!
    expect(gathers).toBe(2)
    expect(ambushes).toBe(1)
    expect(app.store.getState().automation.quantity).toBe(4)
    expect(step.type).toBe('gathering')
    if (step.type !== 'gathering') throw new Error('Expected the retained protector step')
    expect(step.fight).toBe('protector')
    expect(step.attempt_id).not.toBeNull()
    expect(step.forfeit).toBe('idle')
    expect(forfeits).toHaveLength(0)
    const mounted_roster: AppInput = {
      type: 'server/packet',
      packet: {
        type: 'packet/characters',
        characters: [{ ...character(), custody: 'fight', active_fight: { id: 'protector', seat: 0 } }],
      },
    }
    app.dispatch({ type: 'fight/transaction_pending', fight: 'protector', pending: true })
    app.dispatch(mounted_roster)
    expect(forfeits).toHaveLength(0)
    app.dispatch({ type: 'fight/transaction_pending', fight: 'protector', pending: false })
    // The readiness delta submits now, without waiting for the 250ms movement timer.
    expect(forfeits).toEqual([
      { fight: 'protector', fighter_idx: 0n, custody: { kiosk: 'kiosk', kiosk_cap: undefined } },
    ])
    app.dispatch(mounted_roster)
    await Promise.resolve()
    expect(forfeits).toHaveLength(1)
    app.dispatch({ type: 'automation/stop', reason: 'stopped' })
    await Bun.sleep(300)
    expect(gathers).toBe(2)
  } finally {
    close()
    publish_pose(null)
  }
})

test('browser wall time cannot open a gather before the sampled chain travel deadline', () => {
  const base = automation_fixture()
  let state = {
    ...base,
    chain_clock: { chain_ms: 102_000, received_ms: performance.now() },
    session: { ...base.session, characters: [{ ...character(), at_ms: 103_000 }] },
    automation: {
      ...base.automation,
      run: {
        ...base.automation.run!,
        step: {
          type: 'inspecting' as const,
          target: { key, x: 50_000, z: 50_000, node: `${key}:s1:r0:n0` },
        },
      },
    },
  } as AppState
  const controller = new AbortController()
  let notify!: (current: AppState, previous: AppState) => void
  observe_automation({
    events: {
      on: (_event: string, listener: typeof notify) => {
        notify = listener
      },
    } as AppContext['events'],
    get_state: () => state,
    dispatch: (input) => {
      state = reduce_automation(state, input)
    },
    signal: controller.signal,
  })
  try {
    expect(Date.now()).toBeGreaterThan(103_000)
    notify(state, state)
    expect(state.automation.run?.step.type).toBe('inspecting')
  } finally {
    controller.abort()
  }
})

test('gathering exhausts a zone, discovers the next eligible zone, and continues from another page', async () => {
  const app = create_app()
  const base = automation_fixture()
  const gathers: Readonly<{ zone_x: number; zone_z: number }>[] = []
  const searches: unknown[] = []
  let next_zone_gathered!: () => void
  const finished = new Promise<void>((resolve) => {
    next_zone_gathered = resolve
  })
  const wallet = {
    address: 'owner',
    character: {
      gather: async (input: Readonly<{ zone_x: number; zone_z: number }>) => {
        gathers.push(input)
        if (gathers.length > 2) {
          next_zone_gathered()
          return new Promise(() => {})
        }
        app.dispatch({
          type: 'server/packet',
          packet: { type: 'packet/characters', characters: [{ ...character(), at_ms: Date.now() + 2 }] },
        })
        app.dispatch({
          type: 'server/packet',
          packet: {
            type: 'packet/zones',
            zones: [{ ...base.world.zones[key]!, searched_at_ms: Date.now(), res_taken: [gathers.length] }],
          },
        })
        return { quantity: 1, ambushed: false }
      },
      search_zone: async (input: Readonly<{ world: string; x: number; z: number; refresh: boolean }>) => {
        searches.push(input)
        const { zx, zz } = zone_of(input.x, input.z)
        app.dispatch({
          type: 'server/packet',
          packet: {
            type: 'packet/zones',
            zones: [
              { world: input.world, zx, zz, seed: '2', searched_at_ms: Date.now(), mob_taken: '0', res_taken: [] },
            ],
          },
        })
        app.dispatch({
          type: 'server/packet',
          packet: {
            type: 'packet/zone_spawns',
            world: input.world,
            zx,
            zz,
            mobs: [],
            resources: [{ index: 0, x: input.x, z: input.z, item_type: resource.item_type, nodes: 2 }],
          },
        })
        return { digest: 'searched' }
      },
    },
  } as unknown as AuthSession
  initialize_automation_app(app, wallet)
  publish_pose(tick().pose)
  let moved!: () => void
  const movement = new Promise<void>((resolve) => {
    moved = resolve
  })
  const unsubscribe = app.store.subscribe((state) => {
    if (state.run_to.run?.status === 'running') moved()
  })
  const close = app.observe(['world', 'automation'])
  try {
    app.dispatch({ type: 'automation/unlocked' })
    app.dispatch({ type: 'automation/resource', item_type: resource.item_type })
    app.dispatch({ type: 'automation/start', id: 'exploration' })
    app.dispatch({ type: 'page/open', page: 'leaderboard' })
    await movement
    const run = app.store.getState().run_to.run!
    if (run.status !== 'running') throw new Error('Expected travel to a new zone')
    expect(gathers).toHaveLength(2)
    const { zx, zz } = zone_of(run.x, run.z)
    expect(`${run.world}:${zx}:${zz}`).not.toBe(key)
    // Model the ordinary movement/tracking boundary and the elapsed legal travel budget.
    app.dispatch({ type: 'clock/observed', chain_ms: Date.now() + 1_000_000, received_ms: performance.now() })
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/tracked_zones', character_id: 'alice', world: run.world, zones: [{ zx, zz }] },
    })
    publish_pose(null)
    publish_pose({ ...tick().pose!, x: chain_to_client_coordinate(run.x), z: chain_to_client_coordinate(run.z) })
    app.dispatch({ type: 'run_to/stopped', reason: 'arrived', restore_flat: false })
    await finished
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({ world: run.world, refresh: false })
    expect(gathers[2]).toMatchObject({ zone_x: zx, zone_z: zz })
    expect(app.store.getState().automation.run).not.toBeNull()
  } finally {
    app.dispatch({ type: 'automation/stop', reason: 'stopped' })
    close()
    unsubscribe()
    publish_pose(null)
  }
})

test('a preflight movement refusal retries once the delay expires without another Start click', async () => {
  const app = create_app()
  let calls = 0
  let retried!: () => void
  const retry = new Promise<void>((resolve) => {
    retried = resolve
  })
  const wallet = {
    address: 'owner',
    character: {
      gather: async () => {
        calls += 1
        if (calls === 1)
          throw new Error(
            "[sdk] transaction resolution failed — NOT submitted: MoveAbort, abort code: 305, in '0xgame::world::prove_move'"
          )
        retried()
        return new Promise(() => {})
      },
    },
  } as unknown as AuthSession
  initialize_automation_app(app, wallet)
  publish_pose(tick().pose)
  const close = app.observe(['world', 'automation'])
  try {
    app.dispatch({ type: 'automation/unlocked' })
    app.dispatch({ type: 'automation/resource', item_type: resource.item_type })
    app.dispatch({ type: 'automation/start', id: 'retry' })
    await Bun.sleep(20)
    const { step } = app.store.getState().automation.run!
    expect(step.type).toBe('retrying')
    expect(calls).toBe(1)
    if (step.type !== 'retrying') throw new Error('Expected a retained retry')
    await retry
    expect(performance.now()).toBeGreaterThanOrEqual(step.retry_at_ms)
    expect(calls).toBe(2)
    expect(app.store.getState().automation.run).not.toBeNull()
  } finally {
    app.dispatch({ type: 'automation/stop', reason: 'stopped' })
    close()
    publish_pose(null)
  }
})
