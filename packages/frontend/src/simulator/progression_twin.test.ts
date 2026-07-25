// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZERO-DIVERGENCE TWIN — the simulator's point budgets ARE the world's (owner law: "everything we use in the
// simulator is the exact same generic code we use in the real world").
//
// Before the extraction this file pinned nothing because there was nothing to pin against: the 5-stat/1-spell
// grant lived in FOUR independent homes (simulator/reducer.ts, game/core/modules/player_experience.js,
// game/screens/hud/SimulatorDrawer.jsx, game/screens/hud/Spellbook.jsx) and the spell-point cost curve in TWO
// (the simulator's cumulative `l·(l−1)/2` and the spellbook's marginal `upgrade_cost`). They agreed by luck.
// Now `@aresrpg/sdk/progression` is the one home and this test proves every consumer resolves to it — a
// re-derivation at any call site makes one of these identity assertions fail.

import { describe, expect, it } from 'bun:test'
import {
  points_for_level_range,
  spell_points_for_level,
  spell_points_invested,
  spell_upgrade_cost,
  stat_points_for_level,
} from '@aresrpg/sdk/progression'

import { upgrade_cost } from '../game/screens/hud/spellbook-data.js'

import { spell_budget, spell_cost, stat_budget } from './reducer'

describe('progression twin — one home for the chain point grants', () => {
  it('the simulator budget functions ARE the SDK functions (same reference, not a copy)', () => {
    expect(stat_budget).toBe(stat_points_for_level)
    expect(spell_budget).toBe(spell_points_for_level)
    expect(spell_cost).toBe(spell_points_invested)
  })

  it("the world spellbook's upgrade_cost IS the SDK's marginal cost", () => {
    expect(upgrade_cost).toBe(spell_upgrade_cost)
  })

  // progression_math.move: 5 stat / 1 spell per level GAINED, from level 2.
  it('matches the on-chain grant at the Move test vectors', () => {
    expect(points_for_level_range(1, 5)).toEqual({ stat_points: 20, spell_points: 4 })
    expect(points_for_level_range(5, 5)).toEqual({ stat_points: 0, spell_points: 0 })
    expect(stat_budget(1)).toBe(0)
    expect(spell_budget(1)).toBe(0)
    expect(stat_budget(200)).toBe(199 * 5)
    expect(spell_budget(200)).toBe(199)
  })

  // spell_level.move's own worked example: "1→6 costs 1+2+3+4+5 = 15".
  it('the cumulative spell cost is exactly Σ of the marginal cost the chain charges', () => {
    expect(spell_cost(6)).toBe(15)
    for (let level = 1; level <= 12; level++) {
      const summed = Array.from({ length: level - 1 }, (_, index) => spell_upgrade_cost(index + 1)).reduce(
        (sum, cost) => sum + cost,
        0
      )
      expect(spell_cost(level)).toBe(summed)
    }
  })

  it('level 1 is the free baseline on both views', () => {
    expect(spell_cost(1)).toBe(0)
    expect(spell_upgrade_cost(0)).toBe(0)
  })
})
