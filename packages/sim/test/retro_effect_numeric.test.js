// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as effect from '../src/spell_effect.js'

const legal_effect = (kind, stat = 0) =>
  effect.new_effect(
    kind,
    255,
    0,
    effect.SHAPE_POINT,
    0,
    effect.TF_NONE,
    100,
    0,
    stat,
    0,
    effect.PHASE_ON_ENTER,
  )

describe('wave 12 effect vocabulary numeric parity', () => {
  test('keeps every pre-wave discriminant byte-stable', () => {
    expect([
      effect.K_DAMAGE,
      effect.K_PERCENT_LIFE_DAMAGE,
      effect.K_LIFE_STEAL,
      effect.K_CASTER_DAMAGE,
      effect.K_PUNISHMENT_DAMAGE,
      effect.K_HEAL,
      effect.K_GIVE_POINTS,
      effect.K_REMOVE_POINTS,
      effect.K_STEAL_POINTS,
      effect.K_ALTER_STAT,
      effect.K_STEAL_STAT,
      effect.K_ALTER_RESIST,
      effect.K_PUSH,
      effect.K_PULL,
      effect.K_TELEPORT,
      effect.K_SWAP_POSITIONS,
      effect.K_CARRY,
      effect.K_THROW,
      effect.K_RESET_POSITIONS,
      effect.K_PLACE_TRAP,
      effect.K_PLACE_GLYPH,
      effect.K_APPLY_DOT,
      effect.K_APPLY_STATE,
      effect.K_REMOVE_STATE,
      effect.K_REDUCE_DAMAGE,
      effect.K_REFLECT_DAMAGE,
      effect.K_DISPEL,
      effect.K_INVISIBILITY,
      effect.K_REVEAL,
      effect.K_RETURN_SPELL,
      effect.K_GEOMETRIC_PUSH,
    ]).toEqual(Array.from({ length: 31 }, (_, index) => index))
  })

  test('mirrors the append-only Move kind ids and named accessors', () => {
    const pairs = [
      [effect.K_CRITICAL_FAILURE, effect.k_critical_failure()],
      [effect.K_DAMAGE_TO_HEAL, effect.k_damage_to_heal()],
      [effect.K_FORCED_DEATH, effect.k_forced_death()],
      [effect.K_TIMED_PAYLOAD, effect.k_timed_payload()],
      [effect.K_NAMED_DAMAGE_STACK, effect.k_named_damage_stack()],
      [effect.K_STANCE, effect.k_stance()],
      [effect.K_REACTIVE_PUNISHMENT, effect.k_reactive_punishment()],
      [effect.K_EROSION, effect.k_erosion()],
      [effect.K_DAMAGE_REDIRECT, effect.k_damage_redirect()],
    ]

    expect(pairs.map(([constant]) => constant)).toEqual([
      31, 32, 33, 34, 35, 36, 37, 38, 39,
    ])
    expect(pairs.every(([constant, accessor]) => constant === accessor)).toBe(
      true,
    )
    expect(
      pairs.every(([constant]) => effect.is_legal(legal_effect(constant))),
    ).toBe(true)
    expect(effect.is_legal(legal_effect(40))).toBe(false)
  })

  test('mirrors explicit dodge and physical-damage stat ids', () => {
    expect([
      effect.STAT_AP_DODGE,
      effect.STAT_MP_DODGE,
      effect.STAT_PHYSICAL_DAMAGE,
    ]).toEqual([12, 13, 14])
    expect([
      effect.stat_ap_dodge(),
      effect.stat_mp_dodge(),
      effect.stat_physical_damage(),
    ]).toEqual([12, 13, 14])
    expect(effect.is_legal(legal_effect(effect.K_ALTER_STAT, 14))).toBe(true)
    expect(effect.is_legal(legal_effect(effect.K_ALTER_STAT, 15))).toBe(false)
  })
})
