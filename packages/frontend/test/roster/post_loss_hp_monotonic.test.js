// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1485 product truth — what the world HUD actually PAINTS after a fight loss.
//
// The store-level law lives in @aresrpg/inventory (reduce_hp_anchor.test.js). This is the layer the player
// sees: SelfPlate/SpellBar render `projected_hp(row, now)` off the roster row the `action/sui_data` door
// produced. Fold the reported sequence (loss receipt → lagging /v1 repaint → caught-up /v1 repaint) and
// assert the painted number never blips back to full — it may only climb by natural regen.

import { test, expect, describe } from 'bun:test'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { character_max_hp, projected_hp } from '../../src/chain/read_character.js'

const CHARACTER_TYPE = '0xabc::character::Character'
const SETTLE_MS = 1_700_000_000_000

// A level-1 senshi with no allocated vitality — the full bar is DERIVED from the one max-HP home, never
// pinned to a literal (the reported "50" is one class's base; the law is about the blip, not the number).
const stats = {
  id: 'c1',
  _type: CHARACTER_TYPE,
  classe: 'senshi',
  experience: 0,
  vitality: 0,
  wisdom: 0,
  gear_vitality: 0,
  equipment_stats: null,
}
const FULL = character_max_hp(stats)

const row = (over = {}) => ({ ...stats, current_hp: FULL, hp_updated_ms: SETTLE_MS - 60_000, ...over })

const painted = (sui, now_ms) => projected_hp(sui.characters[0], now_ms)

describe('#1485 — the world HP plate is monotonic across a post-loss repaint storm', () => {
  test('the fixture starts at a genuinely full bar (the state the stale read restores)', () => {
    expect(FULL).toBeGreaterThan(0)
  })

  test('loss → lagging /v1 → caught-up /v1 never paints a full-restore blip', () => {
    const start = { characters: [row()], items: [], xp_floor: {}, loaded: true }
    expect(painted(start, SETTLE_MS)).toBe(FULL)

    // the defeat settles at 0 HP (SPEC §17.23) — the receipt mirrors write_back_hp into the roster
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      final_hp: 0,
      previsional_ms: SETTLE_MS,
    })
    expect(painted(settled, SETTLE_MS)).toBe(0)

    // dungeon_settlement's trailing load_roster() lands while the indexer still projects the PRE-FIGHT row
    const lagging = reduce_sui_data(settled, { kind: 'snapshot', characters: [row()] })
    // …and a second later, the caught-up read
    const caught_up = reduce_sui_data(lagging, {
      kind: 'snapshot',
      characters: [row({ current_hp: 0, hp_updated_ms: SETTLE_MS })],
    })

    // the whole storm, sampled on the wall clock the HUD reads: never a step DOWN, never a jump to full
    const timeline = [
      painted(settled, SETTLE_MS + 500),
      painted(lagging, SETTLE_MS + 1_000),
      painted(caught_up, SETTLE_MS + 1_500),
    ]
    expect(Math.max(...timeline)).toBeLessThan(FULL)
    for (let i = 1; i < timeline.length; i += 1) expect(timeline[i]).toBeGreaterThanOrEqual(timeline[i - 1])
  })

  test('natural regen still climbs off the settled anchor — the fix floors HP, it does not freeze it', () => {
    const start = { characters: [row()], items: [], xp_floor: {}, loaded: true }
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      final_hp: 0,
      previsional_ms: SETTLE_MS,
    })
    const lagging = reduce_sui_data(settled, { kind: 'snapshot', characters: [row()] })
    expect(painted(lagging, SETTLE_MS + 30_000)).toBeGreaterThan(0)
  })

  // #1643 — the same storm on a machine whose clock runs years ahead of the chain. The prediction is painted
  // off the CLIENT's instant (so the plate reads 0 immediately, as it must), but the chain's own catch-up read
  // still wins on arrival: the plate that used to freeze at 0 forever heals.
  test('a skewed client clock predicts the loss and STILL yields to the chain read', () => {
    const SKEWED_NOW = 4_000_000_000_000
    const start = { characters: [row()], items: [], xp_floor: {}, loaded: true }
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      final_hp: 0,
      previsional_ms: SKEWED_NOW,
    })
    expect(painted(settled, SKEWED_NOW), 'the defeat paints 0 on the client that predicted it').toBe(0)

    const caught_up = reduce_sui_data(settled, {
      kind: 'snapshot',
      characters: [row({ current_hp: 0, hp_updated_ms: SETTLE_MS })],
    })
    const healed = reduce_sui_data(caught_up, {
      kind: 'snapshot',
      characters: [row({ current_hp: FULL, hp_updated_ms: SETTLE_MS + 600_000 })],
    })
    expect(painted(healed, SETTLE_MS + 600_000), 'the roster row is not frozen at 0').toBe(FULL)
  })
})
