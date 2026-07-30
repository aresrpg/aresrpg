// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { el_fire, el_earth } from '../src/spell.js'
import {
  new_effect,
  damage,
  heal,
  alter_stat,
  remove_points,
  place_trap,
  place_glyph,
  apply_dot,
  geometric_push,
  is_legal,
  has_flag,
  kind,
  element,
  value,
  area_shape,
  area_size,
  target_filter,
  chance,
  turns,
  stat,
  phase,
  k_return_spell,
  k_geometric_push,
  K_DAMAGE,
  K_REMOVE_POINTS,
  K_PLACE_TRAP,
  K_PLACE_GLYPH,
  K_APPLY_DOT,
  K_GEOMETRIC_PUSH,
  TF_NOT_TEAM,
  TF_NOT_ENEMY,
  FLAG_NEGATIVE,
  FLAG_DISPELLABLE,
  FLAG_DODGE,
  POINT_AP,
  POINT_MP,
  STAT_STRENGTH,
  STAT_AGILITY,
  STAT_MAX_HP,
  STAT_HEAL,
  SHAPE_POINT,
  SHAPE_CIRCLE,
  SHAPE_CROSS,
  PHASE_ON_ENTER,
  PHASE_START,
  PHASE_END,
} from '../src/spell_effect.js'

// PARITY FIXTURES — copied VERBATIM from spell_effect.move's own tests. Each test cites its Move source by name.

describe('spell effect envelope — parity with spell_effect.move', () => {
  test('t_damage_effect_fields', () => {
    const e = damage(el_fire(), 15)
    expect(kind(e)).toBe(K_DAMAGE)
    expect(element(e)).toBe(el_fire())
    expect(value(e)).toBe(15)
    expect(target_filter(e)).toBe(TF_NOT_TEAM)
    expect(chance(e)).toBe(100)
  })

  test('t_alter_stat_sign_and_filter', () => {
    const buff = alter_stat(STAT_STRENGTH, 50, false, true, 3)
    expect(has_flag(buff, FLAG_NEGATIVE)).toBe(false)
    expect(has_flag(buff, FLAG_DISPELLABLE)).toBe(true)
    expect(target_filter(buff)).toBe(TF_NOT_ENEMY) // buffs target allies/self
    const debuff = alter_stat(STAT_AGILITY, 40, true, false, 2)
    expect(has_flag(debuff, FLAG_NEGATIVE)).toBe(true)
    expect(target_filter(debuff)).toBe(TF_NOT_TEAM) // debuffs target enemies
  })

  test('t_remove_points_dodge_flag', () => {
    const dodgeable = remove_points(POINT_AP, 3, true)
    expect(kind(dodgeable)).toBe(K_REMOVE_POINTS)
    expect(stat(dodgeable)).toBe(POINT_AP)
    expect(has_flag(dodgeable, FLAG_DODGE)).toBe(true)
    const guaranteed = remove_points(POINT_MP, 2, false)
    expect(has_flag(guaranteed, FLAG_DODGE)).toBe(false)
    expect(stat(guaranteed)).toBe(POINT_MP)
  })

  test('t_trap_and_glyph_and_dot_kinds', () => {
    const trap = place_trap(SHAPE_CIRCLE, 2)
    expect(kind(trap)).toBe(K_PLACE_TRAP)
    expect(phase(trap)).toBe(PHASE_ON_ENTER)
    expect(area_shape(trap)).toBe(SHAPE_CIRCLE)
    expect(area_size(trap)).toBe(2)
    const glyph = place_glyph(SHAPE_CIRCLE, 1, 3, false)
    expect(kind(glyph)).toBe(K_PLACE_GLYPH)
    expect(phase(glyph)).toBe(PHASE_START)
    expect(turns(glyph)).toBe(3)
    const glyph_end = place_glyph(SHAPE_CIRCLE, 1, 2, true)
    expect(phase(glyph_end)).toBe(PHASE_END)
    const dot = apply_dot(el_earth(), 8, 3)
    expect(kind(dot)).toBe(K_APPLY_DOT)
    expect(phase(dot)).toBe(PHASE_START)
    expect(turns(dot)).toBe(3)
    expect(value(dot)).toBe(8)
    const fear = geometric_push(SHAPE_CROSS, 3)
    expect(kind(fear)).toBe(K_GEOMETRIC_PUSH)
    expect(k_geometric_push()).toBe(K_GEOMETRIC_PUSH)
    expect(target_filter(fear)).toBe(0)
    expect(area_shape(fear)).toBe(SHAPE_CROSS)
    expect(area_size(fear)).toBe(3)
  })

  test('t_is_legal_accepts_wellformed_and_rejects_garbage', () => {
    // every convenience constructor produces a legal effect
    expect(is_legal(damage(el_fire(), 15))).toBe(true)
    expect(is_legal(heal(30))).toBe(true)
    expect(is_legal(place_trap(SHAPE_CROSS, 2))).toBe(true)
    expect(is_legal(alter_stat(STAT_MAX_HP, 50, false, true, 3))).toBe(true)
    // unknown kind / shape / filter bit / chance / element → rejected
    expect(
      is_legal(
        new_effect(
          200,
          0,
          1,
          SHAPE_POINT,
          0,
          TF_NOT_TEAM,
          100,
          0,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    // Move rejects the removed random-element flag bit (32); only bits 0..4 remain structural vocabulary.
    expect(
      is_legal(
        new_effect(
          K_DAMAGE,
          0,
          1,
          SHAPE_POINT,
          0,
          TF_NOT_TEAM,
          100,
          0,
          0,
          32,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    expect(
      is_legal(
        new_effect(
          K_DAMAGE,
          0,
          1,
          99,
          0,
          TF_NOT_TEAM,
          100,
          0,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    expect(
      is_legal(
        new_effect(
          K_DAMAGE,
          0,
          1,
          SHAPE_POINT,
          0,
          64,
          100,
          0,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    expect(
      is_legal(
        new_effect(
          K_DAMAGE,
          0,
          1,
          SHAPE_POINT,
          0,
          TF_NOT_TEAM,
          101,
          0,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    expect(
      is_legal(
        new_effect(
          K_DAMAGE,
          7,
          1,
          SHAPE_POINT,
          0,
          TF_NOT_TEAM,
          100,
          0,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    // Append-only vocabulary: legacy ids stay fixed; kind 40 is live and 41 is the next unknown slot.
    expect(k_return_spell()).toBe(29)
    expect(k_geometric_push()).toBe(30)
    expect(
      is_legal(
        new_effect(
          41,
          255,
          0,
          SHAPE_POINT,
          0,
          TF_NOT_TEAM,
          100,
          1,
          0,
          0,
          PHASE_ON_ENTER,
        ),
      ),
    ).toBe(false)
    // stat-id bump (F8): a STAT_HEAL(11) buff is legal
    expect(is_legal(alter_stat(STAT_HEAL, 20, false, true, 3))).toBe(true)
  })
})
