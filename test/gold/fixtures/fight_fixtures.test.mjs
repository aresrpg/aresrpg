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
