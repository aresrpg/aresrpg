// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1809 — "Gobadoc's zone cast damages the casting mob itself." REOPENED on chain-state truth: on edge the boss
// measurably LOSES HP during his own AoE.
//
// The row's hypothesis (splash membership skips `target_filter`) is FALSIFIED on both twins — the filter is
// intersected per splash cell in sim (`fight_spells.js` target list) and in Move (`cast.move` player/mob zone
// walks), and this file pins that as a standing invariant below.
//
// THE ACTUAL DIVERGENCE is one effect kind up. `K_CASTER_DAMAGE` (kind 3, "recoil/sacrifice to the caster") is
// a CASTER-SIDE kind on chain: `cast.move::apply_effect` opens with it, hits the caster for the FLAT authored
// value through the raw sink, and RETURNS — the zone is never walked, the filter never consulted, the proc roll
// never taken. The sim decoded kind 3 into a plain `type: 'DAMAGE'` line (`spell_templates.js`) and then
// resolved it through the ZONE + `target_filter` like any other damage row. So on a mob zone spell carrying a
// recoil line the two twins disagree twice over:
//   · the chain debits the CASTER; the sim debits nobody (an enemies-only filter excludes the caster), and
//   · the sim debits every ENEMY in the zone for the recoil value; the chain debits none of them.
// Which reads, from the seat, exactly as the report: the boss's HP drops during his own AoE, the client never
// predicted it, and every presentation surface is innocent — it is rendering a receipt the client mispredicted.
//
// The existing kind-3 coverage never caught it because it only ever exercises the ONE configuration where the
// sim's zone routing coincides with the chain's caster-side application: `target_filter = ONLY_CASTER`, aimed
// at the caster's own cell (`effect_consequence_direct_cases.js`, `effect_kind_matrix.js`).

import { describe, expect, test } from 'bun:test'

import * as spell_effect from '../src/spell_effect.js'

import {
  CASTER,
  CASTER_CELL,
  ENEMY,
  ENEMY_CELL,
  cast,
  fight,
  hp,
  turn_to,
} from './effect_consequence_driver.js'
import { raw_effect } from './missing_effect_helpers.js'

const EARTH = 2
const { SHAPE_CIRCLE } = spell_effect
const SLAM_DAMAGE = 36
const RECOIL = 10

/** Gobadoc's shape: a mob zone cast, enemies-only, whose area covers the caster's own cell AND the player. */
const slam = ({ recoil = true } = {}) => ({
  id: 'devastating_slam',
  effects: [
    raw_effect(spell_effect.K_DAMAGE, {
      value: SLAM_DAMAGE,
      element: EARTH,
      target_filter: spell_effect.TF_NOT_TEAM, // "enemies of the caster" — the on-chain template's filter 1
      area_shape: SHAPE_CIRCLE,
      area_size: 4,
    }),
    ...(recoil
      ? [
          raw_effect(spell_effect.K_CASTER_DAMAGE, {
            value: RECOIL,
            element: EARTH,
            target_filter: spell_effect.TF_NOT_TEAM, // authored filter — the chain ignores it for kind 3
            area_shape: SHAPE_CIRCLE,
            area_size: 4,
          }),
        ]
      : []),
  ],
})

/** The mob casts its own zone on itself — the reported repro: the area includes the caster's cell. */
const mob_slams_its_own_cell = definition => {
  const initial = turn_to(fight([definition], { p0: 200, m0: 200 }), ENEMY)
  return { initial, after: cast(initial, definition.id, ENEMY_CELL, ENEMY) }
}

describe('#1809 — a mob zone cast that covers its own cell', () => {
  // POSITIVE CONTROL, not a second home: the splash∩filter invariant itself is sealed by the shared-fixture
  // pair (`aoe_splash_target_filter.test.js` + `aoe_target_filter_tests.move`). It stands here so the recoil
  // assertions below cannot pass vacuously — the zone provably reaches the player and provably spares the mob.
  test('control — the enemies-only zone reaches the player and spares the mob that cast it', () => {
    const { initial, after } = mob_slams_its_own_cell(slam({ recoil: false }))
    expect(after.accepted, 'the cast resolved').toBe(true)
    expect(
      hp(after, ENEMY),
      'the caster is inside its own zone and takes nothing from it',
    ).toBe(hp(initial, ENEMY))
    expect(
      hp(initial, CASTER) - hp(after, CASTER),
      'the player in the zone is hit',
    ).toBeGreaterThan(0)
  })

  test('RECOIL is caster-side, not a zone row: the caster pays the flat value and no enemy pays it', () => {
    const with_recoil = mob_slams_its_own_cell(slam())
    const without = mob_slams_its_own_cell(slam({ recoil: false }))

    // cast.move `apply_effect`: `if (kind == k_caster_damage()) { hit(caster, effect.value()); return false }`
    expect(
      hp(with_recoil.initial, ENEMY) - hp(with_recoil.after, ENEMY),
      'the chain debits the caster the FLAT authored value — no stats, no element, no filter, no proc roll',
    ).toBe(RECOIL)

    // …and the recoil never reaches the zone. The player's loss is the DAMAGE line's, byte-identical to the
    // same cast without a recoil row at all.
    const player_loss = probe =>
      hp(probe.initial, CASTER) - hp(probe.after, CASTER)
    expect(
      player_loss(with_recoil),
      'a recoil row must not inflate what the zone deals',
    ).toBe(player_loss(without))
  })

  test('an ONLY_CASTER recoil aimed away from the caster still lands — the zone is irrelevant to kind 3', () => {
    const definition = {
      id: 'self_sacrifice',
      effects: [
        raw_effect(spell_effect.K_CASTER_DAMAGE, {
          value: RECOIL,
          element: EARTH,
          target_filter: spell_effect.TF_ONLY_CASTER,
          area_shape: SHAPE_CIRCLE,
          area_size: 0, // a point zone on a FAR cell: the caster is nowhere near it
        }),
      ],
    }
    const initial = fight([definition], { p0: 200, m0: 200 })
    const after = cast(initial, definition.id, ENEMY_CELL)
    expect(after.accepted).toBe(true)
    expect(
      hp(initial, CASTER) - hp(after, CASTER),
      'recoil is paid wherever the cast was aimed',
    ).toBe(RECOIL)
    expect(
      hp(initial, ENEMY) - hp(after, ENEMY),
      'and never leaks onto the aimed cell',
    ).toBe(0)
  })

  test('the caster-side kinds are exactly the two the chain short-circuits before the zone walk', () => {
    // A guard against silent drift: if `cast.move::apply_effect` grows another pre-zone branch, this fails and
    // the sim's own short-circuit list has to grow with it.
    expect(spell_effect.K_CASTER_DAMAGE).toBe(3)
    expect(spell_effect.K_TELEPORT).toBe(14)
  })
})

test('CASTER_CELL and ENEMY_CELL sit inside one size-4 circle (the fixture measures what it claims)', () => {
  const distance =
    Math.abs(CASTER_CELL.x - ENEMY_CELL.x) +
    Math.abs(CASTER_CELL.y - ENEMY_CELL.y)
  expect(distance).toBeLessThanOrEqual(4)
})
