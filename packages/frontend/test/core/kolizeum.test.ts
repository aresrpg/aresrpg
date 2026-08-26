// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { KolizeumLobbyRow } from '@aresrpg/protocol'

import fight from '../../src/modules/fight.ts'
import fight_chain from '../../src/modules/fight_chain.ts'
import kolizeum, { kolizeum_side_open, parse_kolizeum_pledge } from '../../src/modules/kolizeum.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const lobby = Object.freeze({
  id: '0xk1',
  fight: '0xf1',
  creator: '0xowner',
  format: 3,
  pledge_mist: '1000000000',
  pot_mist: '2000000000',
  level_min: 1,
  level_max: 100,
  public: true,
  can_join: true,
  status: 'open',
  fighters: Object.freeze([
    { seat: 0, team: 0 as const, character_id: '0xc0', name: 'Zero', classe: 'senshi', level: 10, settled: false },
    { seat: 1, team: 0 as const, character_id: '0xc1', name: 'One', classe: 'senshi', level: 10, settled: false },
    { seat: 2, team: 0 as const, character_id: '0xc2', name: 'Two', classe: 'senshi', level: 10, settled: false },
  ]),
}) satisfies KolizeumLobbyRow

const placement_checkpoint = () => ({
  contract: {
    id: '0xf1',
    world: 'overworld',
    x: 0,
    z: 0,
    board: { width: 2, height: 2, shape_mask: ['0'], obstacles: [], holes: [], start_cells_a: [0], start_cells_b: [3] },
    closed: [],
    access_a: 0,
    access_b: 0,
    opener_a: '0xa',
    opener_b: '0xb',
    fighters: [
      {
        team: 0,
        kind: { type: 'player', character: '0xa', owner: '0xme', level: 10 },
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
        kind: { type: 'player', character: '0xb', owner: '0xher', level: 10 },
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
    managed: true,
    wagered: true,
    drops_rolled: false,
    turn_seed: '0',
    turn_slot: 0,
    turn_casts: [],
    placement_ms: 0,
    turn_started_ms: 0,
  },
  players: {
    '0xa': {
      name: 'A',
      classe: 'senshi',
      level: 10,
      experience: '0',
      vitality: 0,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
      spell_levels: {},
      folded_stats: {},
      weapon: null,
    },
    '0xb': {
      name: 'B',
      classe: 'senshi',
      level: 10,
      experience: '0',
      vitality: 0,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
      spell_levels: {},
      folded_stats: {},
      weapon: null,
    },
  },
  kolizeum: '0xk1',
})

test('formats cap each side independently and zero-stake lobbies remain valid', () => {
  expect(kolizeum_side_open(lobby, 0)).toBeFalse()
  expect(kolizeum_side_open(lobby, 1)).toBeTrue()
  expect(parse_kolizeum_pledge('0')).toBe(0n)
  expect(parse_kolizeum_pledge('1.25')).toBe(1_250_000_000n)
  expect(parse_kolizeum_pledge('-1')).toBeNull()
})

test('a delayed join remains owned by its character and preserves the selected side', async () => {
  let resolve_join!: (receipt: { digest: string; fight: string }) => void
  const calls: unknown[] = []
  const base = initial_app_state(settings)
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xa',
      characters: [
        { id: '0xa', name: 'A', level: 10, custody: 'kiosk', kiosk: '0xka', kiosk_cap: '0xcap-a' },
        { id: '0xb', name: 'B', level: 10, custody: 'kiosk', kiosk: '0xkb', kiosk_cap: '0xcap-b' },
      ] as never,
      wallet: {
        address: '0xme',
        kolizeum: {
          join: (args: unknown) => {
            calls.push(args)
            return new Promise<{ digest: string; fight: string }>((resolve) => {
              resolve_join = resolve
            })
          },
        },
      } as never,
    },
  }
  const listeners = new Map<string, ((input: AppInput) => void)[]>()
  const dispatched: AppInput[] = []
  const emit = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    dispatched.push(input)
    listeners.get(input.type)?.forEach((listener) => listener(input))
  }
  kolizeum.observe?.({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: AppInput) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: emit,
  })
  emit({ type: 'server/packet', packet: { type: 'packet/kolizeums', lobbies: [{ ...lobby, fighters: [] }] } })
  emit({ type: 'kolizeum/join', kolizeum: lobby.id, side: 1 })
  emit({ type: 'character/select', character_id: '0xb' })

  expect(calls).toEqual([
    {
      kolizeum: '0xk1',
      fight: '0xf1',
      pledge_mist: 1_000_000_000n,
      side: 1,
      character_id: '0xa',
      custody: { kiosk: '0xka', kiosk_cap: '0xcap-a' },
    },
  ])
  expect(state.kolizeum.pending_by_character).toEqual({ '0xa': 'join:0xk1' })
  resolve_join({ digest: 'joined', fight: '0xf1' })
  await Promise.resolve()
  expect(dispatched).toContainEqual({ type: 'fight/watch', character_id: '0xa', fight: '0xf1' })
})

test('a wagered ready/start is routed through its Kolizeum manager', async () => {
  const listeners = new Map<string, ((input: AppInput) => void)[]>()
  const ready_calls: unknown[] = []
  const base = initial_app_state(settings)
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xa',
      wallet: {
        address: '0xme',
        fight: { ready: async () => Promise.reject(new Error('generic wagered ready must not run')) },
        kolizeum: {
          ready: async (args: unknown) => {
            ready_calls.push(args)
            return { digest: 'ready', started: true, turn_witnesses: [] }
          },
        },
      } as never,
    },
  }
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
    packet: { type: 'packet/fight_state', fight: '0xf1', state: placement_checkpoint(), seats: { '0xa': 0 } },
  })
  emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'ready', fighter: 0n } })
  await Promise.resolve()
  await Promise.resolve()

  expect(ready_calls).toEqual([{ kolizeum: '0xk1', fight: '0xf1', fighter_idx: 0n, and_start: true }])
  expect(state.fight.kolizeum_by_fight).toEqual({ '0xf1': '0xk1' })
})
