// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import fight_chain_module from '../../src/modules/fight_chain.ts'
import fight_module, { create_fight_session } from '../../src/modules/fight.ts'
import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const settled_boundary = Object.freeze({ error: null, awaiting_turn_witness: false })
const raw_fighter = (character: string, owner: string, team: number, cell: number) => ({
  team,
  kind: { type: 'player', character, owner, level: 10n },
  cell,
  ready: true,
  dead: false,
  settled: false,
  forfeited: false,
  hp: 100,
  ap: 6,
  mp: 3,
  drops: [],
  effects: [],
  cooldowns: [],
})

const raw_player_source = () => ({
  name: 'Fighter',
  classe: 'senshi',
  level: 10,
  experience: '0',
  vitality: 50,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  spell_levels: {},
  folded_stats: {},
  weapon: null,
})

const raw_checkpoint = () => ({
  contract: {
    id: '0xf1',
    world: 'overworld',
    x: 120,
    z: 120,
    board: {
      width: 8,
      height: 8,
      shape_mask: ['0'],
      obstacles: [],
      holes: [],
      start_cells_a: [1],
      start_cells_b: [62],
    },
    closed: [],
    access_a: 1,
    access_b: 1,
    opener_a: '0xa',
    opener_b: '0xb',
    fighters: [raw_fighter('0xa', '0xme', 0, 1), raw_fighter('0xb', '0xher', 1, 62)],
    zones: [],
    queue: [0, 1],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: null,
    dungeon: null,
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: '12345',
    turn_slot: 0,
    turn_casts: [],
    placement_ms: 0,
    turn_started_ms: 0,
  },
  sources: { players: { '0xa': raw_player_source(), '0xb': raw_player_source() }, spells: catalog_spell_sources() },
})

describe('the remote fight fold', () => {
  test('a raw checkpoint opens a remote session', () => {
    const session = create_fight_session({ now: () => 1n, reconcile: () => {} })
    session.open({ mode: 'remote', state: raw_checkpoint() as never })
    expect(session.state()?.checkpoint.contract.id).toBe('0xf1')
    expect(session.state()?.checkpoint.contract.fighters).toHaveLength(2)
  })

  test('an authoritative restore discards a refused boundary pending its turn seed', () => {
    const session = create_fight_session({ now: () => 99_000n, reconcile: () => undefined })
    const checkpoint = raw_checkpoint() as never
    session.open({ mode: 'remote', state: checkpoint })
    session.apply({ type: 'end_turn', fighter: 0n, observed_ms: 99_000n })
    session.restore(checkpoint)
    session.apply({ type: 'turn_seed', fighter: 1n, seed: 7n })

    expect(session.state()?.error?.code).toBe('unexpected_turn_seed')
  })

  test('the fight module forwards `state` through fight/opened (audit blocker regression)', () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    const base = initial_app_state(settings)
    let state: AppState = {
      ...base,
      session: { ...base.session, selected_character_id: '0xa', wallet: { address: '0xme' } as never },
    }
    const dispatched: AppInput[] = []
    const emit = (input: AppInput): void => {
      state = reduce_app_state(state, input)
      for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
    }
    fight_module.observe?.({
      events: {
        on: (name, listener) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (payload: never) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: (input) => {
        dispatched.push(input)
        emit(input)
      },
    })
    emit({
      type: 'server/packet',
      packet: {
        type: 'packet/fight_state',
        fight: '0xf1',
        state: {
          contract: raw_checkpoint().contract,
          players: { '0xa': raw_player_source(), '0xb': raw_player_source() },
        },
        seat: 0,
      } as never,
    })
    const reconciled = dispatched.find((input) => input.type === 'fight/reconciled')
    expect(reconciled).toBeDefined()
    expect(state.fight.mode).toBe('remote')
    expect(state.fight.checkpoint?.contract.id).toBe('0xf1')

    emit({
      type: 'server/packet',
      packet: { type: 'packet/turn_seed', fight: '0xf1', seat: '1', seed: '999' } as never,
    })
    expect(state.fight.error).toBeNull()
    const after_witness = state.fight.checkpoint
    const presentation_count = state.fight.presentations.length
    emit({
      type: 'server/packet',
      packet: { type: 'packet/turn_seed', fight: '0xf1', seat: '1', seed: '999' } as never,
    })
    expect(state.fight.checkpoint).toEqual(after_witness)
    expect(state.fight.presentations).toHaveLength(presentation_count)
    expect(state.fight.error?.code).not.toBe('unexpected_turn_seed')

    emit({
      type: 'server/packet',
      packet: {
        type: 'packet/characters',
        characters: [{ id: '0xa', custody: 'kiosk' }],
      } as never,
    })
    expect(state.fight.mode).toBeNull()
  })

  const drive_fight_state = (owner: string | null): AppState => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    const base = initial_app_state(settings)
    let state: AppState = owner
      ? {
          ...base,
          session: { ...base.session, selected_character_id: '0xa', wallet: { address: owner } as never },
        }
      : base
    const emit = (input: AppInput): void => {
      state = reduce_app_state(state, input)
      for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
    }
    fight_module.observe?.({
      events: {
        on: (name, listener) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (payload: never) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: emit,
    })
    emit({
      type: 'server/packet',
      packet: {
        type: 'packet/fight_state',
        fight: '0xf1',
        state: {
          contract: raw_checkpoint().contract,
          players: { '0xa': raw_player_source(), '0xb': raw_player_source() },
        },
        seat: 0,
      } as never,
    })
    return state
  }

  test('a streamed fight holding OUR OWN seat mounts the board by itself', () => {
    expect(drive_fight_state('0xme').fight.mounted).toBe(true)
  })

  test('a streamed fight we hold no seat in stays an unmounted preview', () => {
    expect(drive_fight_state('0xstranger').fight.mounted).toBe(false)
  })

  test('selecting a character outside the fight releases its board immediately', () => {
    const active = drive_fight_state('0xme')
    const state = reduce_app_state(
      {
        ...active,
        session: {
          ...active.session,
          characters: [{ id: '0xa' }, { id: '0xoutside' }] as never,
          selected_character_id: '0xa',
        },
      },
      { type: 'character/select', character_id: '0xoutside' }
    )

    expect(state.session.selected_character_id).toBe('0xoutside')
    expect(state.fight.mode).toBeNull()
    expect(state.fight.mounted).toBeFalse()

    const returned = reduce_app_state(state, { type: 'character/select', character_id: '0xa' })
    expect(returned.session.selected_character_id).toBe('0xa')
    expect(returned.fight.checkpoint?.contract.id).toBe('0xf1')
    expect(returned.fight.mounted).toBeTrue()
  })

  test('selecting another owned character in the same fight keeps that board mounted', () => {
    const active = drive_fight_state('0xme')
    const checkpoint = structuredClone(active.fight.checkpoint!)
    checkpoint.contract.fighters[1]!.kind = { type: 'player', character: '0xb', owner: '0xme', level: 10n }
    const state = reduce_app_state(
      {
        ...active,
        fight: { ...active.fight, checkpoint, cached: { [checkpoint.contract.id]: checkpoint } },
        session: {
          ...active.session,
          characters: [{ id: '0xa' }, { id: '0xb' }] as never,
          selected_character_id: '0xa',
        },
      },
      { type: 'character/select', character_id: '0xb' }
    )

    expect(state.session.selected_character_id).toBe('0xb')
    expect(state.fight.mode).toBe('remote')
    expect(state.fight.mounted).toBeTrue()
  })

  test('releasing one owned seat preserves the shared fight for another owned character', () => {
    const active = drive_fight_state('0xme')
    const checkpoint = structuredClone(active.fight.checkpoint!)
    checkpoint.contract.fighters[1]!.kind = { type: 'player', character: '0xb', owner: '0xme', level: 10n }
    const shared = {
      ...active,
      fight: { ...active.fight, checkpoint, cached: { [checkpoint.contract.id]: checkpoint } },
      session: {
        ...active.session,
        characters: [{ id: '0xa' }, { id: '0xb' }] as never,
        selected_character_id: '0xa',
      },
    }
    const released = reduce_app_state(shared, { type: 'fight/released', character_id: '0xa' })
    expect(released.fight.mounted).toBeFalse()
    expect(released.fight.cached['0xf1']).toBeDefined()

    const switched = reduce_app_state(released, { type: 'character/select', character_id: '0xb' })
    expect(switched.fight.checkpoint?.contract.id).toBe('0xf1')
    expect(switched.fight.mounted).toBeTrue()
  })

  test('selecting a character in another cached fight swaps boards without waiting for the server', () => {
    const active = drive_fight_state('0xme')
    const other = structuredClone(active.fight.checkpoint!)
    other.contract.id = '0xf2'
    other.contract.fighters[0]!.kind = { type: 'player', character: '0xb', owner: '0xme', level: 10n }
    const cached = reduce_app_state(active, { type: 'fight/cached', checkpoint: other })
    const state = reduce_app_state(
      {
        ...cached,
        session: {
          ...cached.session,
          characters: [{ id: '0xa' }, { id: '0xb' }] as never,
        },
      },
      { type: 'character/select', character_id: '0xb' }
    )

    expect(state.fight.checkpoint?.contract.id).toBe('0xf2')
    expect(state.fight.mounted).toBeTrue()
    expect(Object.keys(state.fight.cached).sort()).toEqual(['0xf1', '0xf2'])
  })

  test('back-to-back witness batches wait in presentation order instead of replacing damage cues', () => {
    let state = drive_fight_state('0xme')
    const checkpoint = state.fight.checkpoint!
    const reconcile = (batch: number) => {
      state = reduce_app_state(state, {
        type: 'fight/reconciled',
        mode: 'remote',
        checkpoint,
        zone_ids: [],
        events: [{ type: 'turn_switched', payload: { from: 0n, to: 1n, round: 1n, skipped: [], reason: 'test' } }],
        presentation_batch: batch,
        ...settled_boundary,
      })
    }
    reconcile(1)
    reconcile(2)

    expect(state.fight.presentations.map(({ batch }) => batch)).toEqual([1, 2])
    state = reduce_app_state(state, { type: 'fight/presented', presentation: state.fight.presentations[0]! })
    expect(state.fight.presentations.map(({ batch }) => batch)).toEqual([2])
  })

  test('End Turn stays queued through the current action and clears at the next turn boundary', () => {
    let state = drive_fight_state('0xme')
    const checkpoint = state.fight.checkpoint!
    state = reduce_app_state(state, {
      type: 'fight/end_turn_queued',
      fight: checkpoint.contract.id,
      queued: true,
    })
    state = reduce_app_state(state, {
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint,
      zone_ids: [],
      events: [],
      presentation_batch: 1,
      ...settled_boundary,
    })
    expect(state.fight.end_turn_queued).toBeTrue()

    const next_turn = structuredClone(checkpoint)
    next_turn.contract.turn_started_ms += 1n
    state = reduce_app_state(state, {
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint: next_turn,
      zone_ids: [],
      events: [],
      presentation_batch: 1,
      ...settled_boundary,
    })
    expect(state.fight.end_turn_queued).toBeFalse()
  })

  test('End Turn cannot queue a second submission while a transaction is pending', () => {
    let state = drive_fight_state('0xme')
    const fight = state.fight.checkpoint!.contract.id
    state = reduce_app_state(state, { type: 'fight/transaction_pending', fight, pending: true })
    state = reduce_app_state(state, { type: 'fight/end_turn_queued', fight, queued: true })

    expect(state.fight.transaction_pending).toBeTrue()
    expect(state.fight.end_turn_queued).toBeFalse()
  })

  test('End Turn stays latched after transaction completion until canonical turn truth advances', () => {
    let state = drive_fight_state('0xme')
    const checkpoint = state.fight.checkpoint!
    state = reduce_app_state(state, {
      type: 'fight/input',
      fight: '0xf1',
      origin: 'local',
      input: { type: 'end_turn', fighter: 0n, observed_ms: 99_000n },
    })
    expect(state.fight.end_turn_submitted).toBeTrue()

    state = reduce_app_state(state, {
      type: 'fight/transaction_pending',
      fight: checkpoint.contract.id,
      pending: false,
    })
    state = reduce_app_state(state, {
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint,
      zone_ids: [],
      events: [],
      presentation_batch: 1,
      ...settled_boundary,
    })
    expect(state.fight.end_turn_submitted).toBeTrue()

    const next_turn = structuredClone(checkpoint)
    next_turn.contract.turn_started_ms += 3_000n
    state = reduce_app_state(state, {
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint: next_turn,
      zone_ids: [],
      events: [],
      presentation_batch: 1,
      ...settled_boundary,
    })
    expect(state.fight.end_turn_submitted).toBeFalse()
  })

  test("the LAST seat's ready carries the start and receipt witness in the same transaction", async () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    const ready_calls: unknown[] = []
    const base = initial_app_state(settings)
    let state: AppState = {
      ...base,
      session: {
        ...base.session,
        selected_character_id: '0xa',
        wallet: {
          address: '0xme',
          fight: {
            ready: async (args: unknown) => {
              ready_calls.push(args)
              return { digest: 'ready', started: true, turn_witnesses: [{ fighter: 0n, seed: 77n }] }
            },
          },
        } as never,
      },
    }
    const emit = (input: AppInput): void => {
      state = reduce_app_state(state, input)
      for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
    }
    const context = {
      events: {
        on: (name: string, listener: unknown) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as (payload: never) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: emit,
    }
    fight_module.observe?.(context as never)
    fight_chain_module.observe?.(context as never)
    const placement = raw_checkpoint()
    placement.contract.round = 0
    placement.contract.queue = []
    placement.contract.fighters[0]!.ready = false
    emit({
      type: 'server/packet',
      packet: {
        type: 'packet/fight_state',
        fight: '0xf1',
        state: { contract: placement.contract, players: { '0xa': raw_player_source(), '0xb': raw_player_source() } },
        seat: 0,
      } as never,
    })
    emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'ready', fighter: 0n } })
    await Promise.resolve()
    await Promise.resolve()
    expect(ready_calls).toEqual([{ fight: '0xf1', fighter_idx: 0n, and_start: true }])
    expect(state.fight.checkpoint?.contract.round).toBe(1n)
  })

  test('a confirmed turn feeds its receipt witnesses into presentation without waiting for the indexer', async () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    const dispatched: AppInput[] = []
    const base = initial_app_state(settings)
    const state: AppState = {
      ...base,
      fight: { ...base.fight, mode: 'remote', checkpoint: raw_checkpoint() as never },
      session: {
        ...base.session,
        selected_character_id: '0xa',
        wallet: {
          address: '0xme',
          fight: {
            commit_turn: async () => ({
              digest: 'turn',
              turn_witnesses: [{ fighter: 1n, seed: 42n }],
            }),
          },
        } as never,
      },
    }
    fight_chain_module.observe?.({
      events: {
        on: (name, listener) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (payload: never) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: (input) => void dispatched.push(input),
    })

    listeners.get('fight/input')?.forEach((listener) =>
      listener({
        type: 'fight/input',
        fight: '0xf1',
        origin: 'local',
        input: { type: 'end_turn', fighter: 0n, observed_ms: 99_000n },
      } as never)
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dispatched).toContainEqual({
      type: 'fight/runtime_input',
      fight: '0xf1',
      input: { type: 'turn_seed', fighter: 1n, seed: 42n },
    })
  })

  test('a refused remote command restores chain-confirmed state and unlocks input', async () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    const turn_calls: unknown[] = []
    const base = initial_app_state(settings)
    let state: AppState = {
      ...base,
      session: {
        ...base.session,
        selected_character_id: '0xa',
        wallet: {
          address: '0xme',
          fight: {
            commit_turn: async (turn: unknown) => {
              turn_calls.push(turn)
              throw new Error('MoveAbort 1725')
            },
          },
        } as never,
      },
    }
    const emit = (input: AppInput): void => {
      state = reduce_app_state(state, input)
      for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
    }
    const context = {
      events: {
        on: (name: string, listener: unknown) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as (payload: never) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: emit,
    }
    fight_module.observe?.(context as never)
    fight_chain_module.observe?.(context as never)
    emit({
      type: 'server/packet',
      packet: {
        type: 'packet/fight_state',
        fight: '0xf1',
        state: {
          contract: raw_checkpoint().contract,
          players: { '0xa': raw_player_source(), '0xb': raw_player_source() },
        },
        seat: 0,
      } as never,
    })

    emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'move_to', fighter: 0n, path: [2n] } })
    expect(state.fight.transaction_pending).toBeFalse()
    expect(state.fight.checkpoint?.contract.fighters[0]?.cell).toBe(2n)
    emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'move_to', fighter: 0n, path: [3n] } })
    expect(turn_calls).toHaveLength(0)
    emit({
      type: 'fight/input',
      fight: '0xf1',
      origin: 'local',
      input: { type: 'end_turn', fighter: 0n, observed_ms: 99_000n },
    })
    expect(state.fight.transaction_pending).toBeTrue()
    expect(turn_calls).toEqual([
      {
        fight: '0xf1',
        ended: false,
        actions: [
          { type: 'move', path: [2n] },
          { type: 'move', path: [3n] },
        ],
      },
    ])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.fight.transaction_pending).toBeFalse()
    expect(state.fight.end_turn_submitted).toBeFalse()
    expect(state.fight.checkpoint?.contract.fighters[0]?.cell).toBe(1n)
  })
})
