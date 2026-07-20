// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Safety proof for the on-chain item-stat bias round trip. The admin WRITES ItemTemplates on-chain, so a
// wrong encode corrupts EVERY template — this test locks the read (decode) and write (encode) as exact
// inverses, and proves a template read → edit-nothing → write reproduces byte-identical on-chain stats.
import { test, expect, describe } from 'bun:test'

import { STAT_BIAS, decode_stat, encode_stat } from './stat_bias.js'
import { normalize_item_template, ITEM_STAT_KEY_MAP, ITEM_STAT_EXTRA_KEYS } from './read_templates.js'

describe('stat_bias scalar inverse', () => {
  test('encode(decode(raw)) === raw across the u16 domain', () => {
    for (const raw of [0, 1, 100, STAT_BIAS - 5, STAT_BIAS, STAT_BIAS + 5, 65535]) {
      expect(encode_stat(decode_stat(raw))).toBe(raw)
    }
    // exhaustive sweep — no drift anywhere in 0..65535
    for (let raw = 0; raw <= 65535; raw++) expect(encode_stat(decode_stat(raw))).toBe(raw)
  })

  test('decode(encode(delta)) === delta for real signed deltas', () => {
    for (const delta of [-32768, -100, -5, 0, 5, 100, 32767]) {
      expect(decode_stat(encode_stat(delta))).toBe(delta)
    }
  })

  test('neutral sentinel: raw 32768 decodes to 0, and 0 encodes back to 32768', () => {
    expect(decode_stat(STAT_BIAS)).toBe(0)
    expect(encode_stat(0)).toBe(STAT_BIAS)
  })
})

// Build a raw ItemTemplate `fields` shape (as the chain read hands to normalize) from a chain_key→[min,max]
// biased map; unlisted keys are the neutral sentinel [32768,32768].
function make_fields(biased) {
  const min = {}
  const max = {}
  for (const [, chain_key] of Object.entries(ITEM_STAT_KEY_MAP)) {
    ;[min[chain_key], max[chain_key]] = biased[chain_key] ?? [STAT_BIAS, STAT_BIAS]
  }
  for (const chain_key of ITEM_STAT_EXTRA_KEYS) {
    ;[min[chain_key], max[chain_key]] = biased[chain_key] ?? [STAT_BIAS, STAT_BIAS]
  }
  return {
    name: 'Test Blade',
    item_type: 'test_blade',
    item_category: 'sword',
    level: 50,
    pods: 10,
    stats_min: { fields: min },
    stats_max: { fields: max },
  }
}

// Mirror the write path (template_tab_actions builds a REAL-valued map defaulting missing keys to 0, then
// write_templates.js encodes each with encode_stat) to recover the on-chain args from a decoded statsJson.
function encode_chain_args(stats_json) {
  const min = {}
  const max = {}
  for (const [ui_key, chain_key] of Object.entries(ITEM_STAT_KEY_MAP)) {
    const t = stats_json[ui_key]
    min[chain_key] = encode_stat(Number(t?.[0] ?? 0))
    max[chain_key] = encode_stat(Number(t?.[1] ?? 0))
  }
  for (const chain_key of ITEM_STAT_EXTRA_KEYS) {
    const t = stats_json[chain_key]
    min[chain_key] = encode_stat(Number(t?.[0] ?? 0))
    max[chain_key] = encode_stat(Number(t?.[1] ?? 0))
  }
  return { min, max }
}

describe('normalize_item_template decode', () => {
  const fields = make_fields({
    strength: [STAT_BIAS + 5, STAT_BIAS + 5], // +5 .. +5
    raw_damage: [STAT_BIAS - 68, STAT_BIAS + 32], // -68 .. +32
    earth_resistance: [STAT_BIAS, STAT_BIAS + 10], // 0 .. +10 (min neutral but max not → kept)
    range: [STAT_BIAS + 1, STAT_BIAS + 1], // extra key, +1
    // vitality + everything else left neutral → must be dropped
  })
  const norm = normalize_item_template(fields, '0xabc', null)
  const stats = JSON.parse(norm.statsJson)

  test('decodes non-neutral stats to real signed values', () => {
    expect(stats.strength).toEqual([5, 5])
    expect(stats.rawDamage).toEqual([-68, 32]) // UI key from ITEM_STAT_KEY_MAP (raw_damage → rawDamage)
    expect(stats.earthResistance).toEqual([0, 10])
    expect(stats.range).toEqual([1, 1]) // extra keys ride under their chain name
  })

  test('drops neutral [32768,32768] stats entirely', () => {
    expect(stats.vitality).toBeUndefined()
    expect(stats.wisdom).toBeUndefined()
    expect(stats.critical_outcomes).toBeUndefined()
  })
})

describe('read → edit-nothing → write is byte-identical', () => {
  test('re-encoding a decoded template reproduces the exact on-chain u16 fields', () => {
    const fields = make_fields({
      strength: [STAT_BIAS + 5, STAT_BIAS + 5],
      agility: [STAT_BIAS - 3, STAT_BIAS + 12],
      raw_damage: [STAT_BIAS - 68, STAT_BIAS + 32],
      earth_resistance: [STAT_BIAS, STAT_BIAS + 10],
      critical: [STAT_BIAS + 7, STAT_BIAS + 7],
      range: [STAT_BIAS + 1, STAT_BIAS + 1],
      movement: [STAT_BIAS - 2, STAT_BIAS - 2],
    })
    const stats = JSON.parse(normalize_item_template(fields, '0xabc', null).statsJson)
    const { min, max } = encode_chain_args(stats)
    // Every one of the 17 chain fields (including the neutral-dropped ones, defaulted back to 32768) matches.
    expect(min).toEqual(fields.stats_min.fields)
    expect(max).toEqual(fields.stats_max.fields)
  })
})
