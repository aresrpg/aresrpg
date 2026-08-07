// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import {
  EFFECT_PHASE_BY_KIND,
  K_APPLY_DOT,
  K_DAMAGE,
  K_PLACE_GLYPH,
  PHASE_ON_ENTER,
  PHASE_START,
} from '../../sim/src/spell_effect.js'

const sources = [
  '../../sim/src/spell_effect.js',
  './seed_full_corpus.mjs',
  './seed_spells_phase.mjs',
  './apply_spells_payload.mjs',
  './mob_effect.mjs',
]

const phase_table_homes = (rows) =>
  rows.filter((source) => /(?:KIND_PHASE|EFFECT_PHASE_BY_KIND)\s*=\s*(?:Object\.freeze\()?\s*\{/.test(source))

test('the effect phase table has one home, and the detector catches a planted second home', () => {
  const rows = sources.map((relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'))
  expect(phase_table_homes(rows)).toHaveLength(1)
  expect(phase_table_homes([...rows, 'const KIND_PHASE = { 20: 1, 21: 1 }'])).toHaveLength(2)
})

test('glyph and DoT default to start while ordinary effects default to on-enter', () => {
  expect(EFFECT_PHASE_BY_KIND[K_PLACE_GLYPH]).toBe(PHASE_START)
  expect(EFFECT_PHASE_BY_KIND[K_APPLY_DOT]).toBe(PHASE_START)
  expect(EFFECT_PHASE_BY_KIND[K_DAMAGE] ?? PHASE_ON_ENTER).toBe(PHASE_ON_ENTER)
})
