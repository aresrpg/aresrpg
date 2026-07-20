// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN MP-SPENT FLOATER — the move beat must carry `mp_spent`: a move shows its own green floating
// number for the spent MP. The chain Moved event carries NO cost, so the beat producers derive
// it from the traversed path (origin-EXCLUSIVE, cardinal, 1 MP/cell). BOTH lanes must emit it, twin-identical:
// the optimistic prediction (produce_predicted_render_events) and the confirmed receipt (produce_receipt_render_turns).

import { describe, expect, test } from 'bun:test'
import { create_fight_state, normalize_spell_templates, reduce } from '@aresrpg/sim'

import { produce_predicted_render_events, produce_receipt_render_turns } from './fight_render_events.js'

const W = 20
const enc = (x, y) => y * W + x

const build_arena = () => ({
  width: W,
  height: 19,
  radius: 9,
  center: { x: 10, y: 9 },
  cells: new Uint8Array(W * 19),
  spawns_a: [],
  spawns_b: [],
})

const spell_templates = normalize_spell_templates({ test: {} })

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'test',
  level: 1,
  stats: { agility: 0, intelligence: 0, chance: 0, strength: 0, range: 0 },
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

const started = () => {
  const ctx = { arena: build_arena(), spell_templates }
  const initial = create_fight_state({
    fight_id: 'fight-1',
    arena_seed: 1,
    arena_radius: 9,
    arena: ctx.arena,
    team0: [fighter('p0', { x: 4, y: 8 }, true)],
    team1: [fighter('m0', { x: 14, y: 10 }, false)],
  })
  return { state: reduce(initial, { type: 'start' }, ctx).state, ctx }
}

// p0 walks (4,8) → (4,9) → (4,10): a 2-cell cardinal path (origin-EXCLUSIVE), spending 2 MP.
const MOVE_PATH = [
  { x: 4, y: 9 },
  { x: 4, y: 10 },
]
const MOVE_CMD = { type: 'move', entity_id: 'p0', path: MOVE_PATH }

const receipt_event = (suffix, fields) => ({
  type: `0xE::fight_events::${suffix}`,
  parsedJson: { fight: 'fight-1', ...fields },
})
const RECEIPT_CTX = {
  fight_id: 'fight-1',
  grid_width: W,
  resolve_fighter_id: ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`,
  // known_from for the mover so path_between yields the true 2-cell traversal (not the [to] fallback).
  fighter_cells: new Map([['p0', { x: 4, y: 8 }]]),
}
const RECEIPT_EVENTS = [receipt_event('Moved', { character: 'p0', to_cell: String(enc(4, 10)) })]

const move_beat = (events) => events.find((event) => event.kind === 'move')

describe('green MP-spent floater — the move beat carries mp_spent on both render lanes', () => {
  test('PREDICTION lane: a 2-cell move emits mp_spent 2 on its move beat', () => {
    const { state, ctx } = started()
    const predicted = produce_predicted_render_events(state, MOVE_CMD, ctx)
    // RED at HEAD: the move beat carries no mp_spent (undefined).
    expect(move_beat(predicted.events).payload.mp_spent).toBe(2)
  })

  test('RECEIPT lane: a confirmed 2-cell Moved emits mp_spent 2 on its move beat', () => {
    const beats = produce_receipt_render_turns(RECEIPT_EVENTS, RECEIPT_CTX).turns.flatMap((turn) => turn.events)
    // RED at HEAD: the move beat carries no mp_spent (undefined).
    expect(move_beat(beats).payload.mp_spent).toBe(2)
  })

  test('TWIN: predicted and receipt move beats agree on mp_spent', () => {
    const { state, ctx } = started()
    const predicted = move_beat(produce_predicted_render_events(state, MOVE_CMD, ctx).events)
    const confirmed = move_beat(
      produce_receipt_render_turns(RECEIPT_EVENTS, RECEIPT_CTX).turns.flatMap((turn) => turn.events)
    )
    expect(predicted.payload.mp_spent).toBe(confirmed.payload.mp_spent)
  })
})
