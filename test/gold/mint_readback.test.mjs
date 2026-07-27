// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST fixture for the mint-fidelity readback's pure core (mint_readback.diff_corpus).
//
// The gold rig mints a FAITHFUL corpus, so its end-to-end run exercises only the GREEN transform path plus
// the baselined elementless-resist rows. The RED paths — a value/kind mint drift (a "-4 vs -1"
// class) and a NOVEL elementless resist (the mint dropping a now-present element) — cannot appear on a
// faithful rig, so they are proven here against a synthetic minted corpus. Each case injects exactly one
// defect and asserts the verdict flips, per the project's RED-FIRST law.
import { describe, expect, test } from 'bun:test'

import { encode_effect_value } from '../../packages/move/scripts/spell_wire.mjs'

import { diff_corpus } from './mint_readback.mjs'

const KIND_PHASE = { 20: 1, 21: 1 }
const clone = (value) => JSON.parse(JSON.stringify(value))

// The mint's documented transform (seed_spells_phase.mjs effectFx, now spell_wire.mjs's encode_effect_value —
// #1250), reproduced so a faithful chain object is exactly mint(seed) — the diff must then find zero
// transform-drift.
function mint_effect(effect) {
  const { value, flags } = encode_effect_value(effect.kind ?? 0, effect.value ?? 0, effect.flags ?? 0)
  return {
    kind: effect.kind ?? 0,
    element: effect.element ?? 255,
    value,
    area_shape: effect.area_shape ?? 0,
    area_size: effect.area_size ?? 0,
    target_filter: effect.target_filter ?? 0,
    chance: effect.chance ?? 100,
    turns: effect.turns ?? 0,
    stat: effect.stat ?? 0,
    flags,
    phase: KIND_PHASE[effect.kind] ?? 0,
  }
}
function mint_level(level) {
  return {
    min_char_level: level.min_char_level ?? 1,
    ap_cost: level.ap_cost ?? 3,
    range_min: level.range_min ?? 1,
    range_max: level.range_max ?? 1,
    modifiable_range: !!level.modifiable_range,
    line_launch: !!level.line_launch,
    line_of_sight: level.line_of_sight !== false,
    free_cell: !!level.free_cell,
    casts_per_turn: level.casts_per_turn ?? 255,
    casts_per_target: level.casts_per_target ?? 255,
    cooldown_turns: level.cooldown_turns ?? 0,
    crit_rate: level.crit_rate ?? 0,
    ends_turn_on_fail: false,
    required_states: [],
    forbidden_states: [],
    effects: (level.effects ?? []).map(mint_effect),
    crit_effects: (level.crit_effects ?? []).map(mint_effect),
  }
}
function mint_spell(row) {
  return {
    class: row.classType,
    unlock_level: row.unlock,
    name: row.id,
    levels: row.levels.map(mint_level),
  }
}

// A 6-level spell whose every level carries the given effect list (6 levels = exact 1.29, mint_spell asserts it).
function seed_spell(id, class_type, effects, crit_effects = []) {
  const level = { min_char_level: 1, ap_cost: 3, range_min: 1, range_max: 1, effects, crit_effects }
  return { id, classType: class_type, unlock: 1, levels: Array.from({ length: 6 }, () => clone(level)) }
}

const spell_key = (row) => `${row.classType}:${row.unlock}:${row.id}`

// Assemble the diff inputs from a list of {row, chain} pairs; `chain` null = an unreadable object.
function build(pairs, baseline = { elementless_resist: {} }) {
  const seed_manifest = { spells: {} }
  const chain_by_id = {}
  const seed_spells = []
  pairs.forEach(({ row, chain }, index) => {
    const object_id = `0x${(index + 1).toString(16).padStart(2, '0')}`
    seed_manifest.spells[spell_key(row)] = { id: object_id }
    chain_by_id[object_id] = chain === undefined ? mint_spell(row) : chain
    seed_spells.push(row)
  })
  return diff_corpus({ seed_spells, seed_manifest, chain_by_id, baseline })
}

const DAMAGE = { kind: 0, element: 1, value: 7, target_filter: 1, chance: 100 }
const RESIST_FIRE = { kind: 11, element: 1, value: 8, turns: 5, flags: 2 }
const RESIST_NONE = { kind: 11, value: 8, turns: 5, flags: 2 } // no element → mint writes el_none(255)

describe('mint_readback.diff_corpus — GREEN on a faithful mint', () => {
  test('faithful mint of a damage spell → PASS, zero drift', () => {
    const result = build([{ row: seed_spell('warcleave', 'senshi', [DAMAGE]) }])
    expect(result.verdict).toBe('PASS')
    expect(result.counts.transform_drift).toBe(0)
    expect(result.counts.elementless_total).toBe(0)
    expect(result.counts.spells_read).toBe(1)
  })

  test("negative-authored value is mint-abs'd — NOT flagged as drift", () => {
    // 6 negative values exist in the real corpus; the mint stores |value|, and the diff must agree.
    const result = build([{ row: seed_spell('recoil', 'senshi', [{ kind: 3, element: 1, value: -12 }]) }])
    expect(result.verdict).toBe('PASS')
    expect(result.counts.transform_drift).toBe(0)
  })
})

describe('mint_readback.diff_corpus — RED on transform drift (the prize)', () => {
  test('a scaled value (7 minted as 1) → RED with a value drift row', () => {
    const row = seed_spell('warcleave', 'senshi', [DAMAGE])
    const chain = mint_spell(row)
    chain.levels[0].effects[0].value = 1 // the "-4 predicted vs -1 landed" static shape
    const result = build([{ row, chain }])
    expect(result.verdict).toBe('RED')
    const drift = result.transform_drift.find((d) => d.field === 'value')
    expect(drift).toMatchObject({ id: 'warcleave', field: 'value', authored: '7', minted: '1' })
  })

  test('a remapped kind → RED with a kind drift row', () => {
    const row = seed_spell('warcleave', 'senshi', [DAMAGE])
    const chain = mint_spell(row)
    chain.levels[2].effects[0].kind = 5
    const result = build([{ row, chain }])
    expect(result.verdict).toBe('RED')
    expect(result.transform_drift.some((d) => d.field === 'kind')).toBe(true)
  })

  test('a dropped effect → RED with an effect_count row', () => {
    const row = seed_spell('warcleave', 'senshi', [DAMAGE, { kind: 5, value: 20 }])
    const chain = mint_spell(row)
    chain.levels[0].effects.pop()
    const result = build([{ row, chain }])
    expect(result.verdict).toBe('RED')
    expect(result.transform_drift.some((d) => d.field === 'effect_count')).toBe(true)
  })

  test('the mint dropping a NOW-present resist element → RED (drift + novel elementless)', () => {
    const row = seed_spell('fixedward', 'shugo', [RESIST_FIRE])
    const chain = mint_spell(row)
    for (const level of chain.levels) level.effects[0].element = 255 // old shape, element lost
    const result = build([{ row, chain }])
    expect(result.verdict).toBe('RED')
    expect(result.transform_drift.some((d) => d.field === 'element')).toBe(true)
    expect(result.ratchet.novel.some((n) => n.id === 'fixedward')).toBe(true)
  })
})

describe('mint_readback.diff_corpus — elementless-resist shrink-only ratchet', () => {
  test('an elementless resist OUTSIDE the baseline → RED (novel)', () => {
    const result = build([{ row: seed_spell('newghost', 'ikari', [RESIST_NONE]) }])
    expect(result.verdict).toBe('RED')
    expect(result.counts.elementless_total).toBe(6) // one per level
    expect(result.ratchet.novel).toEqual([{ id: 'newghost', found: 6, budget: 0 }])
    expect(result.counts.transform_drift).toBe(0) // faithful mint of a bad seed — the seed is the defect, not the mint
  })

  test('an elementless resist AT baseline → PASS (known-class)', () => {
    const result = build([{ row: seed_spell('mori_briarwall', 'mori', [RESIST_NONE]) }], {
      elementless_resist: { mori_briarwall: 6 },
    })
    expect(result.verdict).toBe('PASS')
    expect(result.ratchet.matched).toEqual([{ id: 'mori_briarwall', found: 6 }])
  })

  test('fewer than baseline → PASS but reported as IMPROVED (tighten the ledger)', () => {
    const result = build([{ row: seed_spell('mori_briarwall', 'mori', [RESIST_NONE]) }], {
      elementless_resist: { mori_briarwall: 12 },
    })
    expect(result.verdict).toBe('PASS')
    expect(result.ratchet.improved).toEqual([{ id: 'mori_briarwall', found: 6, budget: 12 }])
  })

  test('more than baseline → RED (exceeded)', () => {
    const result = build([{ row: seed_spell('mori_briarwall', 'mori', [RESIST_NONE, RESIST_NONE]) }], {
      elementless_resist: { mori_briarwall: 6 },
    })
    expect(result.verdict).toBe('RED')
    expect(result.ratchet.exceeded).toEqual([{ id: 'mori_briarwall', found: 12, budget: 6 }])
  })
})

describe('mint_readback.diff_corpus — blockers never skip green', () => {
  test('an unreadable minted object → RED blocker', () => {
    const result = build([{ row: seed_spell('warcleave', 'senshi', [DAMAGE]), chain: null }])
    expect(result.verdict).toBe('RED')
    expect(result.counts.blockers).toBe(1)
    expect(result.blockers[0]).toContain('unreadable')
  })

  test('a chain identity mismatch → RED blocker', () => {
    const row = seed_spell('warcleave', 'senshi', [DAMAGE])
    const chain = mint_spell(row)
    chain.name = 'imposter'
    const result = build([{ row, chain }])
    expect(result.verdict).toBe('RED')
    expect(result.blockers[0]).toContain('identity')
  })
})
