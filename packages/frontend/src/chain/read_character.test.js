// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HP TRUTH — proves character_max_hp / projected_hp reproduce the LIVE on-chain kernels EXACTLY
// (aresrpg_foundation::progression_math max_hp_from_base + regen_hp, via hp_math.js), so a client read matches
// what a chain settle computes. max_hp = per-class base_hp (config default_classes) + 5·(level−1) + (vitality +
// gear); regen = (150 + level·6 + wisdom·2)/75 HP/s with remainder-carry, wisdom 0 (the live block-settle rate,
// character_link.move:296/330). Level from the shared 1.29 xp curve. Kernel-level parity lives in hp_math.test.js.
import { describe, expect, test } from 'bun:test'

import { character_max_hp, projected_hp, normalize_character } from './read_character.js'

// A minimal normalized character (only the fields the two helpers read). No `experience` → xp 0 → level 1;
// classe 'senshi' → base_hp 70 (config default_classes / hp_math.DEFAULT_CLASS_BASE_HP).
const char = (over = {}) => ({
  classe: 'senshi',
  vitality: 0,
  gear_vitality: 0,
  current_hp: 50,
  hp_updated_ms: 0,
  ...over,
})

describe('character_max_hp — exact on-chain max_hp (per-class base_hp + 5·(level−1) + (vitality + gear_vit))', () => {
  test('senshi level 1, vitality 0 → 70 (per-class base, NOT the old flat 50)', () => {
    expect(character_max_hp(char({ vitality: 0 }))).toBe(70)
  })
  test('senshi level 1, vitality 60 → 130 (70 + 60)', () => {
    expect(character_max_hp(char({ vitality: 60 }))).toBe(130)
  })
  test('senshi level 2 (xp 110), vitality 60 → 135 (70 + 5·1 + 60)', () => {
    expect(character_max_hp(char({ experience: 110, vitality: 60 }))).toBe(135)
  })
  test('net gear vitality folds in 1:1 (senshi level 1, vit 10 + gear 6 → 86)', () => {
    expect(character_max_hp(char({ vitality: 10, gear_vitality: 6 }))).toBe(86)
  })
  test('an equipped +3 vitality roll raises the derived max HP by 3', () => {
    const equipped = char({
      equipment: [{ item_id: '0xhat' }],
      equipment_stats: { vitality: 3 },
    })
    expect(character_max_hp(equipped)).toBe(73)
  })
  test('per-class base differs — ikari level 1, vitality 0 → 120 (config default_classes)', () => {
    expect(character_max_hp(char({ classe: 'ikari' }))).toBe(120)
  })
  test('unknown / missing class → senshi baseline 70 (total fn, never NaN)', () => {
    expect(character_max_hp({})).toBe(70)
  })
})

describe('projected_hp — exact on-chain lazy regen (kernel rate + remainder-carry, wisdom 0)', () => {
  const damaged = char({ current_hp: 40, hp_updated_ms: 0, vitality: 0 }) // 40/70, senshi L1, anchor 0

  test('0 elapsed → stored current_hp (honest damage, NOT full)', () => {
    expect(projected_hp(damaged, 0)).toBe(40)
  })

  test('senshi L1 kernel vector: 25 hp @5000ms → +10 by now=10000 (num 156) → 35', () => {
    // The EXACT vector from progression_math.move regen_carries_remainder (hp 35; the 193ms fraction carries).
    expect(projected_hp(char({ current_hp: 25, hp_updated_ms: 5_000 }), 10_000)).toBe(35)
  })

  test('sub-unit window → HP unchanged (the carry law: 25 hp @5000ms, now 5400 = <1 whole HP) → 25', () => {
    expect(projected_hp(char({ current_hp: 25, hp_updated_ms: 5_000 }), 5_400)).toBe(25)
  })

  test('huge elapsed → clamps at max_hp (70), never overshoots', () => {
    expect(projected_hp(damaged, 600_000 + 1_000_000_000)).toBe(70)
  })

  test('clock skew (now earlier than the anchor) → elapsed treated as 0, unchanged', () => {
    const skewed = char({ current_hp: 40, hp_updated_ms: 600_000, vitality: 0 })
    expect(projected_hp(skewed, 0)).toBe(40)
  })

  test('a full character stays full (regen only adds, cap holds)', () => {
    expect(projected_hp(char({ current_hp: 70, vitality: 0 }), 1_000_000_000_000)).toBe(70)
  })

  test('geared character caps at the gear-inclusive max (damage not re-hidden)', () => {
    // current 80 out of a gear-inclusive max 86 (senshi L1: 70 + vit 10 + gear 6): projects up but clamps at 86.
    const geared = char({ current_hp: 80, vitality: 10, gear_vitality: 6, hp_updated_ms: 0 })
    expect(projected_hp(geared, 1_000_000_000_000)).toBe(86)
  })
})

describe('normalize_character — #55 spell_points + spell_levels off the on-chain SpellAllocation', () => {
  const TYPE = '0xpkg::character::Character'
  // The EXACT gRPC json shape verified live against a senshi (0x684f…, Lv1, 0 points): a flat SpellAllocation
  // with `points` as a u64 STRING and `levels` a VecMap<u16,u8> rendered `{ contents: [{ key, value }] }`.
  const grpc_json = {
    classe: 'senshi',
    spells: {
      points: '0',
      levels: {
        contents: [
          { key: 1, value: 1 },
          { key: 2, value: 1 },
          { key: 3, value: 1 },
        ],
      },
    },
  }

  test('parses the live senshi shape → {1:1,2:1,3:1}, 0 points', () => {
    const c = normalize_character(grpc_json, '0xabc', TYPE)
    expect(c.spell_points).toBe(0)
    expect(c.spell_levels).toEqual({ 1: 1, 2: 1, 3: 1 })
  })

  test('reads a raised level + banked points (points u64 string coerces)', () => {
    const raised = {
      spells: {
        points: '4',
        levels: {
          contents: [
            { key: 1, value: 3 },
            { key: 7, value: 2 },
          ],
        },
      },
    }
    const c = normalize_character(raised, '0xabc', TYPE)
    expect(c.spell_points).toBe(4)
    expect(c.spell_levels).toEqual({ 1: 3, 7: 2 })
  })

  test('missing / empty spellbook → 0 points, {} levels (no throw)', () => {
    expect(normalize_character({}, '0xabc', TYPE).spell_points).toBe(0)
    expect(normalize_character({}, '0xabc', TYPE).spell_levels).toEqual({})
    expect(
      normalize_character({ spells: { points: '0', levels: { contents: [] } } }, '0xabc', TYPE).spell_levels
    ).toEqual({})
  })

  test('defensive: the `.fields`-wrapped VecMap shape a nested (escrow/stake) read can carry also parses', () => {
    const wrapped = {
      spells: { fields: { points: '2', levels: { fields: { contents: [{ fields: { key: 5, value: 4 } }] } } } },
    }
    const c = normalize_character(wrapped, '0xabc', TYPE)
    expect(c.spell_points).toBe(2)
    expect(c.spell_levels).toEqual({ 5: 4 })
  })
})

describe('normalize_character — P1 2026-07-09 invisible player: the CURRENT struct shape (class/male/customization)', () => {
  const TYPE = '0xd3301bfd…::character::Character'
  // The EXACT live gRPC json of a fresh character 0x93e0… (class String + male bool + colors
  // NESTED in `customization`). The old flat-only mapping returned classe=''/colors=0 → the '' clobbered
  // the RPC card's class on the hydrate merge → the voxel mount silently skipped the avatar.
  const live_grpc_json = {
    anchor: { anchored_at_ms: '0', pos_x: 0, pos_z: 0, zone: '' },
    class: 'senshi',
    created_at_ms: '1783593027696',
    customization: { color_1: 14688031, color_2: 16777215, color_3: 16777215 },
    experience: '0',
    id: '0x93e0',
    male: true,
    name: 'immortal',
  }

  test('current struct → classe from `class`, male from the bool, colors from `customization`', () => {
    const c = normalize_character(live_grpc_json, '0x93e0', TYPE)
    expect(c.classe).toBe('senshi') // '' here = invisible player (the P1 root)
    expect(c.male).toBe(true)
    expect(c.sex).toBe('male')
    expect(c.color_1).toBe(14688031)
    expect(c.color_2).toBe(16777215)
    expect(c.color_3).toBe(16777215)
  })

  test('male: false wins over the sex default (never re-derived from a missing legacy `sex`)', () => {
    const c = normalize_character({ ...live_grpc_json, male: false }, '0x93e0', TYPE)
    expect(c.male).toBe(false)
    expect(c.sex).toBe('female')
  })

  test('a `.fields`-wrapped customization (nested escrow/stake read) also parses', () => {
    const wrapped = { ...live_grpc_json, customization: { fields: { color_1: 7, color_2: 8, color_3: 9 } } }
    const c = normalize_character(wrapped, '0x93e0', TYPE)
    expect(c.color_1).toBe(7)
    expect(c.color_2).toBe(8)
    expect(c.color_3).toBe(9)
  })

  test('legacy flat shape (classe/sex/color_N) still maps — pre-split lineage back-compat', () => {
    const legacy = { classe: 'yajin', sex: 'female', color_1: 1, color_2: 2, color_3: 3 }
    const c = normalize_character(legacy, '0xold', TYPE)
    expect(c.classe).toBe('yajin')
    expect(c.male).toBe(false)
    expect(c.sex).toBe('female')
    expect(c.color_1).toBe(1)
    expect(c.color_2).toBe(2)
    expect(c.color_3).toBe(3)
  })
})
