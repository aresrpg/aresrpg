// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import fight_module from '../../src/modules/fight.ts'
import fight_chain_module from '../../src/modules/fight_chain.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const player = (character: string, owner: string, team: number, cell: number) => ({
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

const source = () => ({
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

const checkpoint = () => ({
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
  fighters: [player('0xa', '0xme', 0, 1), player('0xb', '0xher', 1, 62)],
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
})

test('a same-turn spectator refresh discards paths drafted from the replaced checkpoint', () => {
  const listeners = new Map<string, ((payload: never) => void)[]>()
  const turns: unknown[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: '0xa',
      wallet: {
        address: '0xme',
        fight: { commit_turn: async (turn: unknown) => void turns.push(turn) },
      } as never,
    },
  }
  const emit = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
  }
  const context = {
    events: {
      on: (name: string, listener: unknown) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as (payload: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: emit,
  }
  fight_module.observe?.(context as never)
  fight_chain_module.observe?.(context as never)
  const packet = {
    type: 'server/packet' as const,
    packet: {
      type: 'packet/fight_state',
      fight: '0xf1',
      state: { contract: checkpoint(), players: { '0xa': source(), '0xb': source() } },
      seat: 0,
    } as never,
  }
  emit(packet)
  emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'move_to', fighter: 0n, path: [2n] } })

  emit(packet)
  emit({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'move_to', fighter: 0n, path: [2n] } })
  emit({
    type: 'fight/input',
    fight: '0xf1',
    origin: 'local',
    input: { type: 'end_turn', fighter: 0n, observed_ms: 99_000n },
  })

  expect(turns).toEqual([{ fight: '0xf1', ended: false, actions: [{ type: 'move', path: [2n] }] }])
})
