// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seals the 2026-08-20 audit blockers: (1) the duel reducer's full handshake — validity is
// decided in the fold, effects fire on the `challenge`/`join` pendings appearing; (2) a raw
// wire checkpoint opens a remote fight session without throwing; (3) a turn seed with no
// pending boundary replays a crank (with a real clock) instead of desyncing forever.

import { describe, expect, test } from 'bun:test'
import { DUEL_INVITE_TTL_MS } from '@aresrpg/protocol'
import { client_to_chain_coordinate } from '@aresrpg/immutable'

import duel_module from '../../src/modules/duel.ts'
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

// ── the duel handshake, pure fold ───────────────────────────────────────────────────────────

const fold = (state: AppState, ...inputs: readonly AppInput[]): AppState =>
  inputs.reduce((folded, input) => reduce_app_state(folded, input), state)

describe('the duel reducer', () => {
  const base = initial_app_state(settings)

  test('challenger: invite → accept folds the challenge pending (the effect trigger)', () => {
    const invited = fold(base, { type: 'duel/invited', to: '0xher', character: 'Nyx', at_ms: 1_000 })
    expect(invited.duel.outgoing).toEqual({ to: '0xher', character: 'Nyx', at_ms: 1_000 })
    const accepted = fold(invited, {
      type: 'duel/received',
      from: '0xher',
      character: 'Nyx',
      kind: 'accept',
      at_ms: 2_000,
    })
    expect(accepted.duel.outgoing).toBeNull()
    expect(accepted.duel.challenge).toEqual({ to: '0xher' })
  })

  test('challenger: an accept past the TTL is void — no transaction pending', () => {
    const invited = fold(base, { type: 'duel/invited', to: '0xher', character: 'Nyx', at_ms: 1_000 })
    const late = fold(invited, {
      type: 'duel/received',
      from: '0xher',
      character: 'Nyx',
      kind: 'accept',
      at_ms: 1_000 + DUEL_INVITE_TTL_MS + 1,
    })
    expect(late.duel.challenge).toBeNull()
    expect(late.duel.outgoing).toBeNull()
  })

  test("challenger: a stranger's accept changes nothing", () => {
    const invited = fold(base, { type: 'duel/invited', to: '0xher', character: 'Nyx', at_ms: 1_000 })
    const forged = fold(invited, {
      type: 'duel/received',
      from: '0xevil',
      character: 'Mallory',
      kind: 'accept',
      at_ms: 2_000,
    })
    expect(forged.duel.challenge).toBeNull()
    expect(forged.duel.outgoing).not.toBeNull()
  })

  // THE FIGHT COMES FROM THE INDEXER, NOT THE PEER (owner 2026-08-21): the acceptor matches
  // the streamed `packet/fight_created` against the challenger's OWN standing position — a
  // client can no longer name the chain object another client will transact against.
  const standing = (owner: string, x: number, z: number): AppInput => ({
    type: 'server/packet',
    packet: {
      type: 'packet/player_appeared',
      player: { character_id: `chr-${owner}`, owner, name: 'Nox', x, y: 0, z } as never,
    },
  })
  const fight_born = (x: number, z: number, id = '0xf1'): AppInput => ({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_created',
      fight: { id, world: 'w', x, z, phase: 'placement', access_a: 1, access_b: 255 } as never,
    },
  })
  // the challenger stands at client 40/60 — the chain cell the fight is born on
  const CHAIN_X = Math.round(client_to_chain_coordinate(40))
  const CHAIN_Z = Math.round(client_to_chain_coordinate(60))

  test("acceptor: the challenger's own fight folds the join pending", () => {
    const answered = fold(
      base,
      standing('0xhim', 40, 60),
      { type: 'duel/received', from: '0xhim', character: 'Nox', kind: 'invite', at_ms: 1_000 },
      { type: 'duel/answered', accept: true, to: '0xhim', at_ms: 2_000 }
    )
    expect(answered.duel.accepted).toEqual({ from: '0xhim', at_ms: 2_000 })

    const joined = fold(answered, fight_born(CHAIN_X, CHAIN_Z))
    expect(joined.duel.accepted).toBeNull()
    expect(joined.duel.join).toEqual({ from: '0xhim', fight: '0xf1' })
  })

  test('acceptor: a fight born anywhere else is not our duel', () => {
    const answered = fold(
      base,
      standing('0xhim', 40, 60),
      { type: 'duel/received', from: '0xhim', character: 'Nox', kind: 'invite', at_ms: 1_000 },
      { type: 'duel/answered', accept: true, to: '0xhim', at_ms: 2_000 }
    )
    const elsewhere = fold(answered, fight_born(CHAIN_X + 40, CHAIN_Z, '0xbad'))
    expect(elsewhere.duel.join).toBeNull()
    expect(elsewhere.duel.accepted).not.toBeNull() // still waiting on the real challenger
  })

  test('acceptor: a fight with no accepted handshake is just scenery', () => {
    const watching = fold(base, standing('0xhim', 40, 60), fight_born(CHAIN_X, CHAIN_Z))
    expect(watching.duel.join).toBeNull()
  })

  test('decline clears the outgoing without any pending', () => {
    const declined = fold(
      base,
      { type: 'duel/invited', to: '0xher', character: 'Nyx', at_ms: 1_000 },
      { type: 'duel/received', from: '0xher', character: 'Nyx', kind: 'decline', at_ms: 2_000 }
    )
    expect(declined.duel).toEqual(initial_app_state(settings).duel)
  })

  test('the duel module observe reads targets from INPUTS, never post-fold state', () => {
    // regression for the audit blocker: reduce runs before emit — an effect reading the field
    // its own fold just cleared sends nothing. The signal must derive from the input.
    const signals: AppInput[] = []
    const listeners = new Map<string, (payload: never) => void>()
    let state = initial_app_state(settings)
    duel_module.observe?.({
      events: { on: (name, listener) => listeners.set(name, listener as unknown as (payload: never) => void) },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: (input) => {
        state = reduce_app_state(state, input)
        if (input.type === 'duel/signal') signals.push(input)
      },
    })
    // simulate the store: fold FIRST, then emit — exactly the order that killed the old code
    const emit = (input: AppInput): void => {
      state = reduce_app_state(state, input)
      ;(listeners.get(input.type) as ((payload: AppInput) => void) | undefined)?.(input)
    }
    emit({ type: 'duel/received', from: '0xhim', character: 'Nox', kind: 'invite', at_ms: 1_000 })
    emit({ type: 'duel/answered', accept: true, to: '0xhim', at_ms: 2_000 })
    expect(signals).toEqual([{ type: 'duel/signal', to: '0xhim', kind: 'accept' }])
  })
})

// ── the remote checkpoint, wire-shaped (numbers + decimal strings, never bigint) ────────────

const raw_fighter = (character: string, owner: string, team: number, cell: number) => ({
  team,
  kind: { type: 'player', character, owner },
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
  classe: 'senshi',
  level: 10,
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
  test('a raw wire checkpoint opens a remote session without throwing', () => {
    const session = create_fight_session({ now: () => 1n, reconcile: () => {} })
    session.open({ mode: 'remote', state: raw_checkpoint() as never })
    expect(session.state()?.checkpoint.contract.id).toBe('0xf1')
    expect(session.state()?.checkpoint.contract.fighters).toHaveLength(2)
  })

  test('the fight module forwards `state` through fight/opened (audit blocker regression)', () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    let state = initial_app_state(settings)
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

    // ── the crank fallback: a seed for a turn nobody ended locally replays a crank ──
    emit({
      type: 'server/packet',
      packet: { type: 'packet/turn_seed', fight: '0xf1', seat: '1', seed: '999' } as never,
    })
    const crank = dispatched.find(
      (input) => input.type === 'fight/input' && input.input.type === 'crank' && input.input.observed_ms !== undefined
    )
    expect(crank).toBeDefined()
  })

  test("the LAST seat's ready carries the start in the same transaction", () => {
    const listeners = new Map<string, ((payload: never) => void)[]>()
    let state = initial_app_state(settings)
    const ready_calls: unknown[] = []
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
    // a placement checkpoint: the OTHER fighter (0xb) is already ready, mine (0xa) is not
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
    // a wallet whose fight hand records the ready call
    state = Object.freeze({
      ...state,
      session: Object.freeze({
        ...state.session,
        wallet: {
          address: '0xme',
          fight: { ready: async (args: unknown) => void ready_calls.push(args) },
        } as never,
      }),
    })
    emit({ type: 'fight/input', origin: 'local', input: { type: 'ready', fighter: 0n } })
    expect(ready_calls).toEqual([{ fight: '0xf1', fighter_idx: 0n, and_start: true }])
  })
})
