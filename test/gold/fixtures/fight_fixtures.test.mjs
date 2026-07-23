// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { fixture_specs } from './fight_fixtures.mjs'

// A8 root ①: the MULTI-TURN drive (play_multi_turn_fight) runs a fixed `for (turn < 12)` loop and asserts a
// visible Victory dialog inside it. The character's `click_damage_spell` priority arms Ghost Talon (tomoda, FIRE,
// AP 5); the tomoda's AP ceiling affords exactly ONE cast/turn — a trace-verified flat 6 damage into a mob with
// NEUTRAL fire resistance. So the fixture mob's HP alone decides whether the fight can win before the loop
// exhausts. The retired Wolfling (base HP 120) needed ⌈120/6⌉ = 20 turns and could never win inside the cap — its
// loop ran out with the mob at ~45% and no Victory dialog. This guard makes any future HP/cap/fire-res drift fail
// HERE (named, at unit speed) instead of as an opaque 150s "Victory dialog never appeared" timeout in the rig.
const GHOST_TALON_PER_TURN = 6 // proven AP-ceiling damage of one Ghost Talon cast into neutral fire res (A8 trace)
const DRIVE_TURN_CAP = 12 // the play_multi_turn_fight loop bound
const WIN_MARGIN = 3 // the win must land at least this many turns before the cap
const MIN_PLAYER_TURNS = 3 // the row's law: prove a genuinely MULTI-turn fight (≥3 driven player turns)
const level_100_xp = 95_886_000 // packages/sdk/src/experience.js levels[100]
const settlement_xp_multiplier = 400
const progression_xp_multiplier = 400
// d6d32bcd:seed/mainnet/spells/{senshi,yajin,tomoda,shugo}.json, each spell's learned-rank `levels[0]`:
// max(base, critical) direct DAMAGE/LIFE_STEAL/PUNISHMENT values = 269 + 179 + 204 + 74.
const full_kit_direct_crit_base = 726
const quietus_base = 31 // same snapshot: yajin_quietus levels[0].effects[0].value (the non-critical floor)
const stoneward_absorb = 9 // shugo_stoneward learned-rank REDUCE_DAMAGE value

describe('multi_turn fight fixture stays inside the drive turn budget', () => {
  const multi_turn = fixture_specs.find((spec) => spec.key === 'multi_turn')

  test('the fixture row exists', () => {
    expect(multi_turn, 'no fixture spec with key "multi_turn"').toBeTruthy()
  })

  test('a Ghost-Talon-only drive wins in ≥3 and ≤9 player turns', () => {
    const expected_turns = Math.ceil(multi_turn.hp / GHOST_TALON_PER_TURN)
    // ≥3: genuinely multi-turn (the row proves ≥3 player turns + ≥2 waves before the win).
    expect(
      expected_turns,
      `multi_turn mob (hp=${multi_turn.hp}) dies in ${expected_turns} turns — too few to prove a ≥${MIN_PLAYER_TURNS}-turn fight`
    ).toBeGreaterThanOrEqual(MIN_PLAYER_TURNS)
    // ≤9: the win lands with WIN_MARGIN turns of headroom under the 12-turn loop cap (Wolfling@120 → 20 → RED here).
    expect(
      expected_turns,
      `multi_turn mob (hp=${multi_turn.hp}) needs ${expected_turns} Ghost Talon turns — the ${DRIVE_TURN_CAP}-turn drive cap cannot land a win with ${WIN_MARGIN}-turn margin`
    ).toBeLessThanOrEqual(DRIVE_TURN_CAP - WIN_MARGIN)
  })

  test('the mob does not resist fire — the 6/turn rate depends on neutral fire resistance', () => {
    // Ghost Talon is FIRE. A positive fire_res would drop the per-turn damage below 6 and silently blow the budget
    // even at a low HP; neutral (0) or fire-weak (<0) keeps the win ≤ ⌈hp/6⌉ turns.
    expect(
      multi_turn.stats?.fire_res ?? 0,
      'multi_turn mob resists fire — Ghost Talon would deal <6/turn and the turn budget above no longer holds'
    ).toBeLessThanOrEqual(0)
  })
})

describe('coop full-kit fight fixtures preserve the leveling and cast budgets', () => {
  const leveler = fixture_specs.find((spec) => spec.key === 'coop_full_kit_leveler')
  const full_kit = fixture_specs.find((spec) => spec.key === 'coop_full_kit')

  test('one genuine solo leveler win lands exactly on the final Progression L100 XP threshold', () => {
    expect(leveler, 'no fixture spec with key "coop_full_kit_leveler"').toBeTruthy()
    expect(leveler.ap, 'the leveler mob must be inert').toBe(0)
    expect(leveler.mp, 'the leveler mob must be inert').toBe(0)
    expect(leveler.hp, 'the leveler must die to one legal damaging cast').toBe(1)
    const settlement_share = (leveler.xp_reward * settlement_xp_multiplier) / 100
    expect((settlement_share * progression_xp_multiplier) / 100).toBe(level_100_xp)
  })

  test('the coop target survives full-kit coverage and retains a bounded cleanup', () => {
    expect(full_kit, 'no fixture spec with key "coop_full_kit"').toBeTruthy()
    expect(full_kit.ap, 'the full-kit mob needs one AP-priced hit per turn').toBe(1)
    expect(full_kit.mp, 'the full-kit mob must stay planted for push-into-trap evidence').toBe(0)
    expect(full_kit.spell).toMatchObject({
      damage: 5,
      ap: 1,
      rmin: 0,
      rmax: 64,
      los: false,
      cpt: 1,
      cpta: 1,
      cd: 0,
      crit: 0,
      area_shape: 'allmap',
    })
    expect(full_kit.spell.damage, 'the mob hit must be positive to prove shield absorption').toBeGreaterThan(0)
    expect(full_kit.spell.damage, 'learned-rank Stoneward must fully absorb the fixture hit').toBeLessThanOrEqual(
      stoneward_absorb
    )
    expect(full_kit.group).toBeUndefined() // default [1,1]: one target, no accidental HP multiplication
    expect(full_kit.hp / full_kit_direct_crit_base).toBeGreaterThan(1.5)
    expect(Math.ceil(full_kit.hp / quietus_base)).toBeLessThanOrEqual(39)
  })
})
