// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { encode } from '../src/combat_grid.js'
import { el_earth, el_fire, el_air } from '../src/spell.js'
import {
  damage,
  apply_dot as make_dot,
  shape_circle,
  value,
} from '../src/spell_effect.js'
import {
  empty,
  place_trap,
  place_glyph,
  apply_dot,
  on_enter,
  has_trap_at,
  tick_start,
  tick_end,
  decrement_glyphs,
  collect_spent_statuses,
  decrement_fighter_statuses,
  entry_count,
  status_count,
} from '../src/effect_board.js'

// PARITY FIXTURES — trap/glyph/DoT lifecycle copied VERBATIM from spell_board.move's own tests. Each test cites
// its Move source test by name. §5d ordering is the deterministic contract these assert.

describe('effect board — parity with spell_board.move', () => {
  test('t_trap_detonates_on_enter_and_self_removes', () => {
    const b = empty()
    place_trap(b, encode(5, 5), 0, shape_circle(), 1, [damage(el_earth(), 30)])
    expect(entry_count(b)).toBe(1)
    const payload = on_enter(b, encode(5, 5))
    expect(payload.length).toBe(1)
    expect(value(payload[0])).toBe(30)
    expect(entry_count(b)).toBe(0) // self-removed
    expect(on_enter(b, encode(5, 5))).toEqual([]) // a second entry finds nothing
  })

  test('t_trap_triggers_within_zone_and_for_anyone', () => {
    const b = empty()
    place_trap(b, encode(5, 5), 0, shape_circle(), 1, [damage(el_earth(), 30)])
    // inside the blast lozenge (manhattan 1) triggers — no team check
    expect(on_enter(b, encode(5, 6)).length).toBeGreaterThan(0)
    // re-place and step OUTSIDE the zone (manhattan 2) → no trigger, trap stays
    place_trap(b, encode(5, 5), 0, shape_circle(), 1, [damage(el_earth(), 30)])
    expect(on_enter(b, encode(5, 7))).toEqual([])
    expect(entry_count(b)).toBe(1)
  })

  test('t_has_trap_at_reads_anchor_only_and_frees_on_detonation', () => {
    const b = empty()
    place_trap(b, encode(5, 5), 0, shape_circle(), 1, [damage(el_earth(), 30)])
    expect(has_trap_at(b, encode(5, 5))).toBe(true) // the anchor holds a live trap
    expect(has_trap_at(b, encode(5, 6))).toBe(false) // zone COVERAGE is not anchorage (overlap stays legal)
    place_glyph(b, encode(6, 6), 0, shape_circle(), 1, 3, false, [])
    expect(has_trap_at(b, encode(6, 6))).toBe(false) // a glyph is never a trap read
    on_enter(b, encode(5, 5))
    expect(has_trap_at(b, encode(5, 5))).toBe(false) // detonation self-removes → anchor free
  })

  test('t_glyph_ticks_start_not_on_enter', () => {
    const b = empty()
    place_glyph(b, encode(4, 4), 0, shape_circle(), 1, 3, false, [
      damage(el_fire(), 12),
    ])
    expect(on_enter(b, encode(4, 4))).toEqual([]) // on_enter never fires a glyph
    const t = tick_start(b, 1, encode(4, 4)) // start-of-turn while standing in it ticks
    expect(t.length).toBe(1)
    expect(value(t[0])).toBe(12)
    expect(tick_end(b, encode(4, 4))).toEqual([]) // a start glyph sees no end-phase tick
    expect(tick_start(b, 1, encode(8, 8))).toEqual([]) // standing outside the zone → no tick
  })

  test('t_glyph_end_phase', () => {
    const b = empty()
    place_glyph(b, encode(4, 4), 0, shape_circle(), 0, 2, true, [
      damage(el_air(), 9),
    ])
    expect(tick_end(b, encode(4, 4)).length).toBe(1)
    expect(tick_start(b, 1, encode(4, 4))).toEqual([])
  })

  test('t_glyph_expires_after_duration', () => {
    const b = empty()
    place_glyph(b, encode(4, 4), 0, shape_circle(), 0, 2, false, [
      damage(el_fire(), 12),
    ])
    decrement_glyphs(b) // 2 → 1
    expect(entry_count(b)).toBe(1)
    decrement_glyphs(b) // 1 → expire
    expect(entry_count(b)).toBe(0)
  })

  test('t_dot_lifecycle', () => {
    const b = empty()
    apply_dot(b, 1, 2, make_dot(el_earth(), 8, 3))
    expect(status_count(b)).toBe(1)
    const t = tick_start(b, 1, encode(0, 0)) // ticks at start of fighter 1's turn
    expect(t.length).toBe(1)
    expect(value(t[0])).toBe(8)
    expect(tick_start(b, 2, encode(0, 0))).toEqual([]) // not another fighter's DoT
    // #2000: a 3 is aged on THREE of the bearer's turns, each of them ticking. #2033: ageing never removes —
    // the turn whose ageing lands the counter on 0 is the last covered one, and its END collects the row.
    decrement_fighter_statuses(b, 1) // turn 1: 3 → 2
    expect(collect_spent_statuses(b, 1)).toEqual([]) // …still has turns to come
    decrement_fighter_statuses(b, 1) // turn 2: 2 → 1
    collect_spent_statuses(b, 1)
    decrement_fighter_statuses(b, 1) // turn 3: 1 → 0, its last covered turn
    expect(status_count(b)).toBe(1)
    expect(tick_start(b, 1, encode(0, 0)).length).toBe(1) // its last tick, on that same turn
    collect_spent_statuses(b, 1) // …and that turn's END collects it — not a round later
    expect(status_count(b)).toBe(0)
  })
})
