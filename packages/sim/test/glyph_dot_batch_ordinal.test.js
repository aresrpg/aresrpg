// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2017 — ONE TICK BATCH, ONE INDEX SPACE.
//
// The chain composes a fighter's turn-start work as a SINGLE vector (`spell_board::tick_start_rows`): every
// covering start-phase glyph's payload effects first, in board order, then that fighter's own start-phase DoT
// rows. `cast::apply_board_batch_from` walks it with one counter `e`, and `e` is BOTH
//   · the damage roll's slot — `roll_in_range(value, value_max, slot_damage_roll(turn_seed(fight, fid), e))`
//   · the per-effect SOURCE lookup — `sources[e]`, which D41 (#1999) turned into live caster stats
//
// The sim applies the two halves through different doors (`check_glyphs`, then `process_turn_effects`), so its
// DoT ordinals used to start at 0 and silently indexed a DIFFERENT vector than the chain's. Latent while every
// board tick amplified off a zero block; a live divergence the moment D41 shipped, because the two lines in an
// overlap resolve DIFFERENT sources off that same index.
//
// The expected values here are built from `slot_damage_roll` + `roll_in_range` — the primitives Move's own
// `t_slot_damage_roll_parity_vectors` pins byte-for-byte against the chain. They are the oracle; the ORDINAL is
// what is under test.

import { describe, expect, test } from 'bun:test'

import { process_turn_effects } from '../src/fight_actions.js'
import { start_glyph_batch_prefix } from '../src/fight_traps.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { roll_in_range, slot_damage_roll } from '../src/turn_seed.js'

const ARENA = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [],
  spawns_b: [],
}

const TICK_SEED = 4242
const DOT_MIN = 10
const DOT_MAX = 40
const VICTIM_CELL = { x: 4, y: 4 }

const fighter = (id, is_player, cell, effects = []) => ({
  id,
  name: id,
  cell,
  health: 400,
  health_max: 400,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'ord',
  level: 1,
  stats: {},
  effects,
  spell_levels: {},
  ap_reserve: 0,
})

/** A BANDED earth DoT sourced by p0 — banded so the slot it rolls against is observable at all. */
const dot_row = {
  id: 1,
  type: /** @type {const} */ ('DAMAGE'),
  timing: /** @type {const} */ ('TURN_START'),
  source_id: 'p0',
  element: /** @type {const} */ ('EARTH'),
  value: DOT_MIN,
  value_max: DOT_MAX,
  dot: true,
  turns_remaining: 5,
}

/** @param {{ glyphs?: object[] }} spec */
const state_with = ({ glyphs = [] } = {}) => ({
  ...create_fight_state({
    fight_id: 'batch_ordinal',
    arena_seed: 1,
    arena_radius: 4,
    arena: ARENA,
    team0: [fighter('p0', true, { x: 2, y: 4 })],
    team1: [fighter('m0', false, VICTIM_CELL, [dot_row])],
  }),
  glyphs,
  started: true,
  turn_order: ['p0', 'm0'],
  turn_number: 1,
})

/** A covering payload glyph carrying `lines` damage effects — the chain's payload model. */
const covering_glyph = lines => ({
  id: 90,
  source_id: 'p0',
  cells: [VICTIM_CELL],
  turns_remaining: 3,
  payload: Array.from({ length: lines }, () => ({
    type: 'DAMAGE',
    element: 'EARTH',
    min: 5,
    max: 5,
    chance: 100,
  })),
})

/** The victim's HP loss to `process_turn_effects` alone — the DoT half of the batch, never the glyph half. */
const dot_tick = state => {
  const before = find_entity(state, 'm0').health
  const prefix = start_glyph_batch_prefix(state, 'm0')
  const ticked = process_turn_effects(state, 'm0', TICK_SEED, prefix)
  return before - find_entity(ticked.state, 'm0').health
}

/** What the chain's parity-pinned primitives say a line at slot `e` is worth (no resistance in play). */
const chain_line_at = e =>
  roll_in_range(DOT_MIN, DOT_MAX, slot_damage_roll(TICK_SEED, e))

describe("#2017 — a DoT's ordinal indexes the WHOLE tick batch, glyph payloads first", () => {
  test('with no glyph covering the victim, the DoT is the batch and rolls slot 0', () => {
    expect(start_glyph_batch_prefix(state_with(), 'm0')).toBe(0)
    expect(dot_tick(state_with())).toBe(chain_line_at(0))
  })

  test('a covering 1-line glyph pushes the DoT to slot 1 — the chain composes glyph payloads first', () => {
    const state = state_with({ glyphs: [covering_glyph(1)] })
    expect(start_glyph_batch_prefix(state, 'm0')).toBe(1)
    expect(dot_tick(state)).toBe(chain_line_at(1))
  })

  test('the prefix counts payload EFFECTS, not glyphs — a 3-line glyph puts the DoT at slot 3', () => {
    const state = state_with({ glyphs: [covering_glyph(3)] })
    expect(start_glyph_batch_prefix(state, 'm0')).toBe(3)
    expect(dot_tick(state)).toBe(chain_line_at(3))
  })

  test('THE DIVERGENCE ITSELF: the overlap moves the roll, so slot 0 is the wrong answer there', () => {
    // If the two ordinals agreed by luck at this seed the fixture would prove nothing — pin that they differ.
    expect(chain_line_at(1)).not.toBe(chain_line_at(0))
    expect(dot_tick(state_with({ glyphs: [covering_glyph(1)] }))).not.toBe(
      chain_line_at(0),
    )
  })

  test('a glyph that does NOT cover the victim contributes no prefix', () => {
    const elsewhere = { ...covering_glyph(2), cells: [{ x: 0, y: 0 }] }
    const state = state_with({ glyphs: [elsewhere] })
    expect(start_glyph_batch_prefix(state, 'm0')).toBe(0)
    expect(dot_tick(state)).toBe(chain_line_at(0))
  })

  test('a LEGACY element/min/max glyph is the chain’s one-line payload — prefix 1', () => {
    const legacy = {
      id: 91,
      source_id: 'p0',
      cells: [VICTIM_CELL],
      turns_remaining: 3,
      element: 'EARTH',
      min: 5,
      max: 5,
      payload: [],
    }
    const state = state_with({ glyphs: [legacy] })
    expect(start_glyph_batch_prefix(state, 'm0')).toBe(1)
    expect(dot_tick(state)).toBe(chain_line_at(1))
  })
})
