// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE DAMAGE-BUFF FAMILY AMPLIFIES OUTGOING DAMAGE — #1168's functional half, sealed.
//
// The report: "a +110% Damage buff changes nothing — the same damage is dealt with and without it", extended to
// "flat +RAW DAMAGE buffs are inert too … the sim's outgoing-damage resolution ignores the whole damage-buff
// family". The ROOT was never the damage formula: `spell_calculator.amplify_damage` has always read
// `percent_damage` / `raw_damage` / `physical_damage` / the element characteristic off the caster's folded
// stats, byte-for-byte with the chain (`spell_formula::amplify_damage`, spell_formula.move:35-40). What was
// broken was the ROW: the simulator opened its local chain with AUTHORED corpus values while the normalizer is
// the CHAIN-dialect door (32768-centered signed kinds), so every authored buff folded as its own complement and
// landed clamped at 0 — a +42 became a −32726 STAT_DEBUFF. #1170 fixed the door; nothing pinned the OUTCOME.
//
// This is that pin, in the shape the report asked for: one fixture per modifier, buffed cast vs unbuffed cast,
// damage differing by EXACTLY the modifier.
//
// HONEST SCOPE — this file is GREEN on both sides of #1170 and says so rather than claiming a red it never had.
// #1170's bug lived one layer up, in the frontend simulator's START door (`fight_start.js`); these fixtures
// author the CENTERED value directly at the normalizer, which is the dialect that door was failing to speak, so
// they could never have reproduced it. The RED-FIRST artifact for the reported symptom is its sibling,
// `packages/frontend/src/simulator/fight_buff_damage.test.js`, which drives that exact door and goes red against
// 788d9ef6^ with `percent_damage: -32658` / `critical_hit: -32759` — the owner's screenshot values.
//
// What THIS file seals is the half no test covered on either side of that fix: that the resolution consults
// every member of the family. It goes red the day `amplify_damage` stops reading one of them — a regression the
// door fix does nothing to prevent, and the one the report's headline ("the buff changes nothing") describes.

import { describe, expect, test } from 'bun:test'

import { effective_stats, find_entity } from '../src/fight_state.js'
import * as SE from '../src/spell_effect.js'

import {
  cast,
  fighter,
  raw_effect,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'

const SIGNED_SHIFT = 32768
const BASE = 20

/** The unbuffed control and every buffed variant share ONE damage spell — same element, same fixed band. */
const strike = element =>
  spell_of(`strike_${element}`, [
    raw_effect(SE.K_DAMAGE, { value: BASE, value_max: BASE, element }),
  ])

/** Cast an authored `+n` on `stat` at the caster (the wire is CENTERED — the sim's decode door strips it), then
 *  strike the mob and report the damage dealt plus the caster stat block the strike resolved against. */
const damage_with = ({ stat, authored, element = 2 } = {}) => {
  const board = state_of(
    [fighter('p0', { x: 2, y: 2 }, true)],
    [fighter('m0', { x: 3, y: 2 }, false, { health: 5000, health_max: 5000 })],
  )
  const buffed =
    stat === undefined
      ? board
      : cast(
          board,
          'p0',
          spell_of(`buff_${stat}_${authored}`, [
            raw_effect(SE.K_ALTER_STAT, {
              value: SIGNED_SHIFT + authored,
              stat,
              turns: 5,
              target: 'self',
              target_filter: SE.TF_ONLY_CASTER,
            }),
          ]),
          { x: 2, y: 2 },
        ).state
  const before = find_entity(buffed, 'm0').health
  const struck = cast(buffed, 'p0', strike(element), { x: 3, y: 2 }).state
  return {
    damage: before - find_entity(struck, 'm0').health,
    stats: effective_stats(find_entity(buffed, 'p0')),
  }
}

const UNBUFFED = damage_with().damage

describe('every member of the damage-buff family amplifies outgoing damage (#1168)', () => {
  test('the unbuffed control deals exactly the authored base', () => {
    expect(UNBUFFED).toBe(BASE)
  })

  test('+110% DAMAGE — the buff the report filmed — multiplies the base', () => {
    const { damage, stats } = damage_with({
      stat: SE.STAT_PERCENT_DAMAGE,
      authored: 110,
    })
    expect(stats.percent_damage).toBe(110) // the row landed DECODED, not centered-raw
    expect(damage).toBe(Math.floor((BASE * 210) / 100)) // 42 — base × (100 + percent)/100
    expect(damage).toBeGreaterThan(UNBUFFED)
  })

  test('+42 RAW DAMAGE — the flat half of the report — lands AFTER amplification', () => {
    const { damage, stats } = damage_with({
      stat: SE.STAT_RAW_DAMAGE,
      authored: 42,
    })
    expect(stats.raw_damage).toBe(42)
    expect(damage).toBe(BASE + 42)
  })

  test('+50 STRENGTH percentage-amplifies EARTH damage through the element characteristic', () => {
    const { damage } = damage_with({
      stat: SE.STAT_STRENGTH,
      authored: 50,
      element: 2,
    })
    expect(damage).toBe(Math.floor((BASE * 150) / 100))
  })

  test('+30 PHYSICAL DAMAGE is flat on earth damage (physical rides earth/neutral only)', () => {
    const { damage } = damage_with({
      stat: SE.STAT_PHYSICAL_DAMAGE,
      authored: 30,
      element: 2,
    })
    expect(damage).toBe(BASE + 30)
  })

  test('…and physical damage does NOT touch a FIRE strike — the element gate is real', () => {
    const fire_control = damage_with({ element: 0 }).damage
    expect(
      damage_with({ stat: SE.STAT_PHYSICAL_DAMAGE, authored: 30, element: 0 })
        .damage,
    ).toBe(fire_control)
  })

  test('the modifiers COMPOSE the way the chain composes them: (base × (100+primary+percent)/100) + flats', () => {
    // one caster carrying the whole family at once, resolved in the chain's order
    const board = state_of(
      [fighter('p0', { x: 2, y: 2 }, true)],
      [
        fighter('m0', { x: 3, y: 2 }, false, {
          health: 5000,
          health_max: 5000,
        }),
      ],
    )
    const rows = [
      [SE.STAT_PERCENT_DAMAGE, 110],
      [SE.STAT_STRENGTH, 50],
      [SE.STAT_RAW_DAMAGE, 42],
    ]
    const buffed = rows.reduce(
      (state, [stat, authored]) =>
        cast(
          state,
          'p0',
          spell_of(`stack_${stat}`, [
            raw_effect(SE.K_ALTER_STAT, {
              value: SIGNED_SHIFT + authored,
              stat,
              turns: 5,
              target: 'self',
              target_filter: SE.TF_ONLY_CASTER,
            }),
          ]),
          { x: 2, y: 2 },
        ).state,
      board,
    )
    const before = find_entity(buffed, 'm0').health
    const struck = cast(buffed, 'p0', strike(2), { x: 3, y: 2 }).state
    expect(before - find_entity(struck, 'm0').health).toBe(
      Math.floor((BASE * (100 + 50 + 110)) / 100) + 42,
    )
  })
})
