// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import fight_chain, { queued_end_turn } from '../../src/modules/fight_chain.ts'
import fight from '../../src/modules/fight.ts'
import { create_app, initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const source = Object.freeze({
  classe: 'senshi',
  level: 1,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  spell_levels: {},
  folded_stats: {},
  weapon: null,
})
const checkpoint = (id: string, character: string) => ({
  contract: {
    id,
    world: 'overworld',
    x: 0,
    z: 0,
    board: { width: 2, height: 2, shape_mask: ['0'], obstacles: [], holes: [], start_cells_a: [0], start_cells_b: [3] },
    closed: [],
    access_a: 0,
    access_b: 0,
    opener_a: character,
    opener_b: '0xfoe',
    fighters: [
      {
        team: 0,
        kind: { type: 'player', character, owner: '0xme', level: 1 },
        cell: 0,
        ready: false,
        dead: false,
        settled: false,
        forfeited: false,
        hp: 10,
        ap: 6,
        mp: 3,
        drops: [],
        effects: [],
        cooldowns: [],
      },
      {
        team: 1,
        kind: { type: 'player', character: '0xfoe', owner: '0xfoe', level: 1 },
        cell: 3,
        ready: true,
        dead: false,
        settled: false,
        forfeited: false,
        hp: 10,
        ap: 6,
        mp: 3,
        drops: [],
        effects: [],
        cooldowns: [],
      },
    ],
    zones: [],
    queue: [],
    turn_ptr: 0,
    round: 0,
    ended: false,
    winner: null,
    dungeon: null,
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: '0',
    turn_slot: 0,
    turn_casts: [],
    placement_ms: 0,
    turn_started_ms: 0,
  },
  players: { [character]: source, '0xfoe': source },
})

test('a delayed A receipt stays in A while B is selected', async () => {
  let resolve_ready!: (receipt: {
    digest: string
    started: boolean
    turn_witnesses: { fighter: bigint; seed: bigint }[]
  }) => void
  const ready = new Promise<{ digest: string; started: boolean; turn_witnesses: { fighter: bigint; seed: bigint }[] }>(
    (resolve) => {
      resolve_ready = resolve
    }
  )
  const base = initial_app_state(settings)
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xa',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } },
        { id: '0xb', custody: 'fight', active_fight: { id: '0xfb', seat: 0 } },
      ] as never,
      wallet: {
        address: '0xme',
        fight: { ready: () => ready, forfeit: async () => Promise.reject(new Error('refused second command')) },
      } as never,
    },
  }
  const listeners = new Map<string, ((input: AppInput) => void)[]>()
  const emit = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    listeners.get(input.type)?.forEach((listener) => listener(input))
  }
  const context = {
    events: {
      on: (name: string, listener: (input: AppInput) => void) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: emit,
  }
  fight.observe?.(context as never)
  fight_chain.observe?.(context as never)
  emit({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: checkpoint('0xfa', '0xa'), seat: 0 } as never,
  })
  emit({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfb', state: checkpoint('0xfb', '0xb'), seat: 0 } as never,
  })
  emit({ type: 'fight/input', fight: '0xfa', origin: 'local', input: { type: 'ready', fighter: 0n } })
  emit({ type: 'character/select', character_id: '0xb' })

  expect(state.fight.checkpoint?.contract.id).toBe('0xfb')
  expect(state.fight.transaction_pending).toBeFalse()
  resolve_ready({ digest: 'ready-a', started: true, turn_witnesses: [{ fighter: 0n, seed: 7n }] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.fight.checkpoint?.contract.id).toBe('0xfb')
  expect(state.fight.checkpoint?.contract.round).toBe(0n)

  emit({ type: 'character/select', character_id: '0xa' })
  expect(state.fight.checkpoint?.contract.id).toBe('0xfa')
  expect(state.fight.checkpoint?.contract.round).toBe(1n)
  expect(state.fight.transaction_pending).toBeFalse()

  emit({ type: 'fight/input', fight: '0xfa', origin: 'local', input: { type: 'forfeit', fighter: 0n } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.fight.checkpoint?.contract.round).toBe(1n)
  expect(state.fight.checkpoint?.contract.fighters[0]?.forfeited).toBeFalse()
})

test('nested runtime projections drain FIFO before the outer dispatch returns', () => {
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['fight'])
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/characters',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } },
        { id: '0xb', custody: 'fight', active_fight: { id: '0xfb', seat: 0 } },
      ],
    } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xa' })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: checkpoint('0xfa', '0xa'), seat: 0 } as never,
  })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfb', state: checkpoint('0xfb', '0xb'), seat: 0 } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xb' })

  expect(app.store.getState().fight.checkpoint?.contract.id).toBe('0xfb')
  expect(app.store.getState().fight.mounted).toBeTrue()
  stop()
})

test('a background spectator returns to terminal truth instead of the overworld', () => {
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['fight'])
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/characters',
      characters: [
        { id: '0xa', custody: 'kiosk' },
        { id: '0xb', custody: 'kiosk' },
      ],
    } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xa' })
  app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: '0xfa' })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: checkpoint('0xfa', '0xfoe'), seat: {} } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xb' })
  const active = checkpoint('0xfa', '0xfoe')
  const ended = { ...active, contract: { ...active.contract, ended: true, winner: 0 } }
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: ended, seat: {} } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xa' })

  expect(app.store.getState().fight.mounted).toBeFalse()
  expect(app.store.getState().fight.spectating_by_character['0xa']).toBeUndefined()
  stop()
})

test('an ended wire checkpoint computes XP from the normalized fight state', () => {
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['fight', 'fight_result'])
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/characters',
      characters: [{ id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } }],
    } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xa' })
  const ended = checkpoint('0xfa', '0xa')
  ended.players['0xa'] = { ...source, folded_stats: { strength: 1_000_001 } }
  ended.contract.ended = true
  Reflect.set(ended.contract, 'winner', 0)
  ended.contract.round = 1
  ended.contract.fighters[1] = {
    ...ended.contract.fighters[1]!,
    kind: {
      type: 'mob',
      snapshot: {
        mob_type: 'training_mob',
        level: 1,
        max_hp: 10,
        ap: 6,
        mp: 3,
        agility: 0,
        wisdom: 0,
        xp: 100,
        kit: [],
      },
    },
    dead: true,
  } as never

  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: ended, seats: { '0xa': 0 } } as never,
  })

  expect(app.store.getState().fight_result.current_by_character['0xa']?.participants[0]?.xp_awarded).toBeGreaterThan(0)
  stop()
})

test('switching spectator fights evicts the last unreferenced environment', () => {
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['fight'])
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [{ id: '0xa', custody: 'kiosk' }] } as never,
  })
  app.dispatch({ type: 'character/select', character_id: '0xa' })
  app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: '0xf1' })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xf1', state: checkpoint('0xf1', '0xfoe'), seat: {} } as never,
  })
  expect(app.store.getState().fight.cached['0xf1']).toBeDefined()

  app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: '0xf2' })
  expect(app.store.getState().fight.cached['0xf1']).toBeUndefined()
  expect(app.store.getState().fight.environments['0xf1']).toBeUndefined()
  stop()
})

test('a queued background turn remains executable without its FightLayer mounted', () => {
  const base = initial_app_state(settings)
  const raw = checkpoint('0xfa', '0xa')
  const active = {
    ...raw,
    contract: { ...raw.contract, round: 1n, queue: [0n], turn_ptr: 0n, turn_started_ms: 0n },
  } as never
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xb',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } },
        { id: '0xb', custody: 'fight', active_fight: { id: '0xfb', seat: 0 } },
      ] as never,
      wallet: { address: '0xme' } as never,
    },
    fight: { ...base.fight, cached: { '0xfa': active } },
  }
  state = reduce_app_state(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint: active,
    zone_ids: [],
    events: [{ type: 'fight_started', payload: {} }] as never,
    presentation_batch: 1,
    error: null,
    awaiting_turn_witness: false,
    project: false,
  })
  state = reduce_app_state(state, { type: 'fight/end_turn_queued', fight: '0xfa', queued: true })

  // a background fight stores no animation replay — only its live state and the queued turn
  expect(state.fight.environments['0xfa']?.presentations).toEqual([])
  expect(queued_end_turn(state, '0xfa', 10_000)).toEqual({ fighter: 0n, delay_ms: 0 })
})

test('the transaction observer drains A queued turn while B remains visible', async () => {
  const base = initial_app_state(settings)
  const active = (id: string, character: string) => {
    const raw = checkpoint(id, character)
    return {
      ...raw,
      contract: { ...raw.contract, round: 1n, queue: [0n], turn_ptr: 0n, turn_started_ms: 0n },
    } as never
  }
  const fight_a = active('0xfa', '0xa')
  const fight_b = active('0xfb', '0xb')
  const commits: unknown[] = []
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xb',
      characters: [
        { id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } },
        { id: '0xb', custody: 'fight', active_fight: { id: '0xfb', seat: 0 } },
      ] as never,
      wallet: {
        address: '0xme',
        fight: {
          commit_turn: async (input: unknown) => {
            commits.push(input)
            return { digest: 'background-a' }
          },
        },
      } as never,
    },
    fight: {
      ...base.fight,
      mode: 'remote',
      checkpoint: fight_b,
      cached: { '0xfa': fight_a, '0xfb': fight_b },
      mounted: true,
    },
  }
  state = reduce_app_state(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint: fight_a,
    zone_ids: [],
    events: [],
    presentation_batch: 0,
    error: null,
    awaiting_turn_witness: false,
    project: false,
  })
  const previous = state
  state = reduce_app_state(state, { type: 'fight/end_turn_queued', fight: '0xfa', queued: true })
  const listeners = new Map<string, ((...arguments_: never[]) => void)[]>()
  const dispatch = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    listeners.get(input.type)?.forEach((listener) => listener(input as never))
  }
  fight_chain.observe?.({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (...arguments_: never[]) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch,
  })
  listeners.get('STATE_UPDATED')?.forEach((listener) => listener(state as never, previous as never))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(commits).toEqual([{ fight: '0xfa', actions: [], ended: false }])
  expect(state.fight.checkpoint?.contract.id).toBe('0xfb')
})

test('a pre-submission too-soon refusal restores the runtime before requeueing', async () => {
  const base = initial_app_state(settings)
  const raw = checkpoint('0xfa', '0xa')
  const active = {
    ...raw,
    contract: { ...raw.contract, round: 1n, queue: [0n], turn_ptr: 0n, turn_started_ms: 0n },
  } as never
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xa',
      characters: [{ id: '0xa', custody: 'fight', active_fight: { id: '0xfa', seat: 0 } }] as never,
      wallet: {
        address: '0xme',
        fight: {
          commit_turn: async () =>
            Promise.reject(
              new Error(
                "Transaction resolution failed: MoveAbort in 1st command, abort code: 1724, in '0xgame::fight::commit_turn' (transaction NOT submitted)"
              )
            ),
        },
      } as never,
    },
  }
  const listeners = new Map<string, ((input: AppInput) => void)[]>()
  const dispatch = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    listeners.get(input.type)?.forEach((listener) => listener(input))
  }
  const context = {
    events: {
      on: (name: string, listener: (input: AppInput) => void) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch,
  }
  fight.observe?.(context as never)
  fight_chain.observe?.(context as never)
  dispatch({
    type: 'server/packet',
    packet: { type: 'packet/fight_state', fight: '0xfa', state: active, seat: 0 } as never,
  })

  dispatch({
    type: 'fight/input',
    fight: '0xfa',
    origin: 'local',
    input: { type: 'end_turn', fighter: 0n, observed_ms: 10_000n },
  })
  expect(state.fight.awaiting_turn_witness).toBeTrue()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(state.fight.awaiting_turn_witness).toBeFalse()
  expect(state.fight.end_turn_queued).toBeTrue()
  expect(state.fight.end_turn_submitted).toBeFalse()
})
