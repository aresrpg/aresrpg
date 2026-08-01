// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MAX-HP TWIN PARITY (#867) — the SDK's `get_max_health` against the chain's frozen progression math.
//
// THE ORACLE IS THE MOVE SOURCE, transcribed here rather than imported from the SDK, so this file can never
// agree with the code by construction:
//   • `packages/move/foundation/sources/progression_math.move:54` max_hp_from_base —
//       `base_hp + (level > 1 ? (level − 1) × HP_PER_LEVEL : 0) + vitality`, HP_PER_LEVEL = 5 (ANNEX §4c,
//       FROZEN — it rides with the immutable XP curve, it is not an admin dial). Its own in-module asserts
//       (:95-97) pin (70,1,0)=70, (70,10,0)=115, (70,10,25)=140 — reproduced below as the first spread rows.
//   • `packages/move/aresrpg/sources/config.move:201-217` default_classes() — the per-class BASE HP rows in
//       the frozen class-id order. `aresrpg::progression::max_hp` (progression.move:34) is what feeds the two
//       together on chain: `max_hp_from_base(config::base_hp(row), level, vitality)`.
//
// The pre-#867 SDK computed a class-blind `30 + level×5 + vitality`, which read 35 for a level-1 Senshi where
// the chain reads 70 — the divergence this file exists to make impossible to reintroduce silently.
import { describe, test, expect } from 'bun:test'

import CLASSES from '../src/classes.json' with { type: 'json' }
import { level_to_experience } from '../src/experience.js'
import { get_max_health } from '../src/stats.js'

// config.move default_classes(), in the frozen class-id order (0..11) — the on-chain init values.
const MOVE_CLASS_BASE_HP = {
  senshi: 70,
  yajin: 45,
  ikari: 120,
  mori: 55,
  tokei: 45,
  shugo: 50,
  yogen: 30,
  rojin: 50,
  shusen: 65,
  tomoda: 30,
  asobi: 55,
  iyashi: 50,
}

const HP_PER_LEVEL = 5 // progression_math.move HP_PER_LEVEL — ANNEX §4c, frozen

/** progression_math::max_hp_from_base, transcribed. */
const move_max_hp = (base_hp, level, vitality) => base_hp + (level > 1 ? (level - 1) * HP_PER_LEVEL : 0) + vitality

const character = (classe, level, extra = {}) => ({
  classe,
  experience: level_to_experience(level),
  vitality: 0,
  ...extra,
})

describe('max HP parity with progression_math.move (#867)', () => {
  test('the SDK class table carries the same base HP as config.move default_classes()', () => {
    const sdk_base_hp = Object.fromEntries(Object.entries(CLASSES).map(([id, { health }]) => [id, health]))
    expect(sdk_base_hp).toEqual(MOVE_CLASS_BASE_HP)
  })

  test('the reported divergence: a level-1 Senshi is its class base, not a flat 30 + 5', () => {
    expect(get_max_health(character('senshi', 1))).toBe(70)
  })

  test('every class at every sampled level and vitality matches the Move formula', () => {
    // The three tuples progression_math.move asserts on itself, then a sweep over all 12 classes.
    for (const [level, vitality] of [
      [1, 0],
      [10, 0],
      [10, 25],
      [2, 0],
      [50, 7],
      [100, 250],
      [200, 999],
    ])
      for (const [classe, base_hp] of Object.entries(MOVE_CLASS_BASE_HP))
        expect({ classe, level, vitality, hp: get_max_health(character(classe, level, { vitality })) }).toEqual({
          classe,
          level,
          vitality,
          hp: move_max_hp(base_hp, level, vitality),
        })
  })

  test('level 1 grants NO level bonus — the growth term starts at level 2', () => {
    for (const [classe, base_hp] of Object.entries(MOVE_CLASS_BASE_HP)) {
      expect(get_max_health(character(classe, 1))).toBe(base_hp)
      expect(get_max_health(character(classe, 2))).toBe(base_hp + HP_PER_LEVEL)
    }
  })

  test('gear vitality folds into the pool through the same signed aggregate the chain folds', () => {
    // character_health.move max_hp folds max(0, gear_pos.vit − gear_neg.vit) on top of the allocated vitality.
    expect(get_max_health(character('ikari', 10, { vitality: 30, equipment_stats: { vitality: 12 } }))).toBe(
      move_max_hp(120, 10, 42)
    )
    // the positive-only compatibility fallback, before the aggregate backfill
    expect(get_max_health(character('yogen', 1, { gear_vitality: 9 }))).toBe(move_max_hp(30, 1, 9))
  })

  test('LIVE-CHAIN provenance: a real level-1 Senshi sits above the pre-fix ceiling', () => {
    // Captured 2026-07-26 from https://rpc.aresrpg.world/v1/characters?owner=0xb4951afe…5cd177 (the canary
    // owner in src/rpc/fixtures/characters.json). Character 0xe3d99d59…fce7b "qa3c15f0be": class senshi,
    // level 1, experience 31, vitality 0, no gear, current_hp 51. The chain lets it hold 51 HP, which the
    // pre-#867 SDK called 16 points ABOVE its maximum — a max HP below a live character's current HP is a
    // contradiction no rounding explains.
    const live = { classe: 'senshi', experience: 31, vitality: 0, current_hp: 51 }
    expect(get_max_health(live)).toBeGreaterThanOrEqual(live.current_hp)
    expect(get_max_health(live)).toBe(70)
  })
})
