// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// A DRAIN'S ROW STATES ITS OUTCOME — the sim half of #1168 ("-2 MP removed no MP and I cannot tell whether the
// mob dodged or the mechanic isn't implemented").
//
// The mechanic IS implemented: `apply_stat_effect` runs the agility-contested removal through `spell_formula`
// `remove_points`, byte-for-byte with the chain's. A lost contest is a REAL outcome, and the chain says so —
// `emit_drain(point_kind, removed, requested)` fires UNCONDITIONALLY (cast.move:1832), dodge included. The sim
// used to answer a full dodge with a bare `{ status: 'POINT_DODGED' }`: no pool, no attempted count, so nothing
// downstream could state WHAT was resisted. A PARTIAL dodge already spoke — it rides the landed row, which
// carries `requested` — so the same contest was loud at 1-of-2 points and silent at 0-of-2.
//
// The dodge is COMMON, which is why the silence read as "unimplemented": a wisdom-0 caster against an
// agility-0 mob fully dodges a 2-MP drain on 9 of the first 16 arena seeds below.

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import * as SE from '../src/spell_effect.js'

import {
  cast,
  fighter,
  raw_effect,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'

/** One dodgeable AP/MP drain of `value` points, cast at the adjacent mob on arena seed `seed`. */
const drain_once = (kind, point, value, seed) => {
  const state = state_of(
    [fighter('p0', { x: 2, y: 2 }, true)],
    [fighter('m0', { x: 3, y: 2 }, false)],
    seed,
  )
  const spell = spell_of(`drain_${kind}_${point}_${seed}`, [
    raw_effect(kind, { value, stat: point, turns: 1, flags: SE.FLAG_DODGE }),
  ])
  const before = find_entity(state, 'm0')
  const result = cast(state, 'p0', spell, { x: 3, y: 2 })
  return {
    row: result.effects[0],
    before,
    after: find_entity(result.state, 'm0'),
    caster: find_entity(result.state, 'p0'),
  }
}

// Measured through `drain_once` itself: seed 1 fully dodges, 8 removes both points, 6 removes one of two.
const FULLY_DODGED_SEED = 1
const FULLY_REMOVED_SEED = 8
const PARTIAL_SEED = 6

describe('a point drain states its outcome — dodged or removed, never silence', () => {
  test('a DODGED drain names the pool it failed to take and the count it wanted', () => {
    const { row, before, after } = drain_once(
      SE.K_REMOVE_POINTS,
      SE.POINT_MP,
      2,
      FULLY_DODGED_SEED,
    )
    // the pool genuinely did not move — a real dodge, not a swallowed effect
    expect(after.mp).toBe(before.mp)
    // …and the row SAYS so: the same shape a landed drain carries, with 0 as the honest magnitude
    expect(row).toEqual({
      target_id: 'm0',
      status: 'POINT_DODGED',
      stat: 'mp',
      value: 0,
      requested: 2,
    })
  })

  test('landed and partial rows are unchanged — one shape reads all three endings', () => {
    const landed = drain_once(
      SE.K_REMOVE_POINTS,
      SE.POINT_MP,
      2,
      FULLY_REMOVED_SEED,
    )
    expect(landed.before.mp - landed.after.mp).toBe(2)
    expect(landed.row).toEqual({
      target_id: 'm0',
      status: 'STAT_DEBUFF',
      stat: 'mp',
      value: 2,
      requested: 2,
    })
    const partial = drain_once(SE.K_REMOVE_POINTS, SE.POINT_MP, 2, PARTIAL_SEED)
    expect(partial.before.mp - partial.after.mp).toBe(1)
    expect(partial.row.value).toBe(1)
    expect(partial.row.requested).toBe(2)
  })

  test('a dodged STEAL feeds the caster nothing and still names its pool', () => {
    const { row, caster } = drain_once(
      SE.K_STEAL_POINTS,
      SE.POINT_MP,
      2,
      FULLY_DODGED_SEED,
    )
    expect(caster.mp).toBe(6) // the helper's base MP — nothing was stolen
    expect(row).toEqual({
      target_id: 'm0',
      status: 'POINT_DODGED',
      stat: 'mp',
      value: 0,
      requested: 2,
    })
  })

  test('an AP drain rides the same row — the pool is a field, never a second code path', () => {
    const { row } = drain_once(
      SE.K_REMOVE_POINTS,
      SE.POINT_AP,
      3,
      FULLY_DODGED_SEED,
    )
    expect(row).toEqual({
      target_id: 'm0',
      status: 'POINT_DODGED',
      stat: 'ap',
      value: 0,
      requested: 3,
    })
  })
})
