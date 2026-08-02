// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1867 RED-FIRST — THE LOOT TILE FLICKERED AT FIGHT END: it appeared, disappeared, and came back.
//
// Settlement dispatches the victory card's loot up to three times for one fight, and they race:
//   ① the FLOOR — `floor_loot(rolled_units)` off the ResultOpened event, `resolved: false` (placeholder tiles);
//   ② the MINT — exact `ItemMinted` instance rows once `mint_all_and_burn` lands, `resolved: true, instances: true`;
//   ③ the DISPLAY READ — `loot_from_rolled(result.rolled)` off a chain read of the FightResult, `resolved: true`.
//
// ③ was adopted wholesale, and `results.move` shrinks `rolled` one entry per `mint_rolled` — so a read taken
// while (or after) the mint drains it observes a SHORTER, and for a fully minted result an EMPTY, declaration
// than the receipt that opened the card. Arriving before ②, that empty read blanked the tiles; ② then refilled
// them. The middle state was a lie either way: the items existed on chain the whole time.
//
// THE LAW this pins: an empty declaration over rows the card already holds is ABSENCE, not proof that nothing
// dropped. Certified loot leaves the slice on `close` and nowhere else — reads ADOPT forward, never blank
// backward. Richer data still wins: an instance-resolved dispatch always replaces a floor.

import { describe, expect, test } from 'bun:test'

import player_experience from '../../../../src/game/core/modules/player_experience.js'

const RESULT = '0xresult'
const mod = player_experience()

const reduce = (state, type, payload) => mod.reduce(state, { type, payload })

/** An opened, receipt-bound card holding the placeholder floor — the exact live state when ③ lands. */
const carded = (loot, over = {}) => ({
  fight_result: {
    status: 'resolved',
    result_id: RESULT,
    xp: 120,
    level: 7,
    levels_gained: 0,
    points_gained: 0,
    loot,
    loot_units: 1,
    loot_resolved: false,
    loot_instances_resolved: false,
    ...over,
  },
})

const floor = [{ item_type: '', name: '', amount: 1 }]
const minted = [{ item_id: '0xitem', template_id: '0xtpl', item_type: 'ring_of_x', name: 'Ring of X', amount: 1 }]

describe('#1867 the loot tiles never blank between the receipt and reconciliation', () => {
  test('RED: a drained display read cannot clear the tiles the receipt certified', () => {
    // ③ arriving first, off a FightResult whose `rolled` the mint already drained.
    const after = reduce(carded(floor), 'action/fight_result/loot', { result_id: RESULT, loot: [], resolved: true })
    expect(after.fight_result.loot).toEqual(floor)
    expect(after.fight_result.loot_resolved, 'and it never claims the empty read as the resolved truth').toBe(false)
  })

  test('the same empty read cannot clear REAL instance rows either', () => {
    const held = carded(minted, { loot_resolved: true, loot_instances_resolved: true })
    expect(
      reduce(held, 'action/fight_result/loot', { result_id: RESULT, loot: [], resolved: true }).fight_result.loot
    ).toEqual(minted)
  })

  test('GREEN: richer rows still replace the floor — the hold is not a freeze', () => {
    const after = reduce(carded(floor), 'action/fight_result/loot', {
      result_id: RESULT,
      loot: minted,
      resolved: true,
      instances: true,
    })
    expect(after.fight_result.loot).toEqual(minted)
    expect(after.fight_result.loot_instances_resolved).toBe(true)
  })

  test('a genuinely empty result still renders empty — the hold needs something to hold', () => {
    // No floor (a 0-unit victory): nothing certified yet, so an empty declaration is the honest reading.
    const after = reduce(carded([]), 'action/fight_result/loot', { result_id: RESULT, loot: [], resolved: true })
    expect(after.fight_result.loot).toEqual([])
    expect(after.fight_result.loot_resolved).toBe(true)
  })

  test('a dispatch for a DIFFERENT result never reaches this card', () => {
    expect(
      reduce(carded(minted), 'action/fight_result/loot', { result_id: '0xother', loot: [], resolved: true })
        .fight_result.loot
    ).toEqual(minted)
  })

  test('closing the card is the ONE thing that clears certified loot', () => {
    expect(reduce(carded(minted), 'action/fight_result/close', {}).fight_result).toBeNull()
  })
})
