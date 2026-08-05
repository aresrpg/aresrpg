// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
import * as SE from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import {
  CORPUS,
  SPELLS_CORPUS_AVAILABLE,
} from './spell_effect_conformance_matrix.js'

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

// ── THE TWIN SEAL (#2186) ────────────────────────────────────────────────────────────────────────────
// The class gate behind the summoning deletion: the sim's effect vocabulary may never EXCEED the chain's.
// A sim-only kind is client prediction resolving an outcome the chain can never produce — the exact divergence
// summoning was (153 LoC of resolution against a Move enumeration that excludes it by name). Both tables are
// read from source, so the discriminants are compared as DATA, never restated in a comment that can drift.
const MOVE_KINDS = Object.fromEntries(
  [
    ...readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../move/foundation/sources/spell_effect.move',
      ),
      'utf8',
    ).matchAll(/^const (K_[A-Z0-9_]+): u8 = (\d+);/gm),
  ].map(([, name, value]) => [name, Number(value)]),
)

const SIM_KINDS = Object.fromEntries(
  Object.entries(SE).filter(
    ([name, value]) => name.startsWith('K_') && typeof value === 'number',
  ),
)

describe('effect-kind twin seal — the sim never declares a kind the chain cannot encode', () => {
  test('the Move enumeration is actually read (positive control: 41 kinds, K_POOL_SHIELD = 40)', () => {
    expect(Object.keys(MOVE_KINDS)).toHaveLength(41)
    expect(MOVE_KINDS['K_POOL_SHIELD']).toBe(40)
    expect(MOVE_KINDS['K_SUMMON']).toBeUndefined()
  })

  test('every sim kind exists on chain with the SAME discriminant, and vice versa', () => {
    expect(SIM_KINDS).toEqual(MOVE_KINDS)
  })
})

// ── The SUMMON tombstone (#2220) ─────────────────────────────────────────────
// The legacy generated corpus `packages/sdk/src/spells.json` was a SECOND spell-truth home beside the served
// corpus blob, and SUMMON was exactly how it had diverged: 7 of its 78 spells author a SUMMON effect, which
// the chain taxonomy EXCLUDES BY CONSTRUCTION (packages/move/foundation/sources/spell_effect.move — "SUMMONING
// is EXCLUDED"). Nothing summon-shaped ever reached chain or serving. The sim-side resolution is gone too
// (#2186 deleted fight_summon.js — the sim resolved a kind the chain cannot encode), so these arms are all
// that remains of the concern, and they belong with the vocabulary seal above: what the vocabulary IS, and
// what happens at its boundary, is ONE fact home.
describe('SUMMON is authorable by no served spell', () => {
  test('the chain effect vocabulary carries no SUMMON opcode', () => {
    const opcodes = Object.keys(SE).filter(name => name.startsWith('K_'))
    expect(opcodes.length).toBeGreaterThan(20) // the vocabulary was actually read
    expect(opcodes.filter(name => name.includes('SUMMON'))).toEqual([])
  })

  // The vocabulary check above reads names; this one DRIVES the decoder: one chain-dialect row per opcode
  // through the ONE normalizer every served spell passes, and not one of them can fold to a SUMMON.
  test('no chain opcode decodes to a SUMMON effect', () => {
    const opcodes = Object.entries(SE).filter(([name]) => name.startsWith('K_'))
    const decoded = normalize_spell_templates(
      opcodes.map(([name, kind]) => ({
        id: `probe_${name}`,
        levels: [
          {
            ap_cost: 3,
            effects: [{ kind, value: 5, target_filter: 0, flags: 0, chance: 100 }],
            crit_effects: [],
          },
        ],
      })),
    )
    // the normalizer also seeds MOB_ATTACK_TEMPLATE, so probe by id rather than by map size
    const probes = opcodes.map(([name]) => decoded.get(`probe_${name}`))
    expect(probes.filter(Boolean)).toHaveLength(opcodes.length) // every opcode actually decoded
    const types = probes.flatMap(template =>
      template.levels[0].base_effects.map(effect => effect.type),
    )
    expect(types.filter(type => type === 'SUMMON')).toEqual([])
  })

  // MISSING-ARTIFACT (settled #96): seed/mainnet/spells is content-pipeline output, absent by design here.
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'no spell in the served corpus authors a summon',
    () => {
      expect(CORPUS.length).toBeGreaterThan(0)
      const summoning = CORPUS.filter(spell =>
        (spell.levels ?? []).some(level =>
          [...(level.effects ?? []), ...(level.crit_effects ?? [])].some(
            effect => /summon/i.test(JSON.stringify(effect)),
          ),
        ),
      ).map(spell => spell.id)
      expect(summoning).toEqual([])
    },
  )
})
