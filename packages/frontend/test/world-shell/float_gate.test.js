// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// FLOATS ARE NUMBERS ONLY (owner live-report: a literal "stat_buff" slug floated over a fighter as a combat
// number). The law: a float is damage, heal, or an AP/MP pool delta — nothing else. Two halves here:
//   1. the pure door (`numeric_float`) accepts exactly the numeric classes and drops everything else;
//   2. the presenter cannot go around it — every float payload in voxel_fight_adapter.js is gated at its site.
// The driven proof that a status beat mounts NOTHING lives in voxel_fight_beat_playback.test.js (real adapter,
// real store, recording board); this file pins the vocabulary and the seam.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { numeric_float } from '../../src/world-shell/damage-floater.js'

const here = dirname(fileURLToPath(import.meta.url))
const adapter_src = readFileSync(join(here, '../../src/world-shell/voxel_fight_adapter.js'), 'utf8')

describe('numeric_float — the float door', () => {
  test('the four numeric classes pass through untouched (crit is the amber damage variant)', () => {
    for (const float of [
      { text: '-7', kind: 'damage' },
      { text: '-120', kind: 'crit' },
      { text: '+35', kind: 'heal' },
      { text: '-3', kind: 'ap' },
      { text: '-2', kind: 'mp' },
    ])
      expect(numeric_float(float)).toBe(float)
  })

  test('an effect slug is DROPPED, whatever kind carries it', () => {
    for (const status of ['STAT_BUFF', 'STAT_DEBUFF', 'SHIELD', 'STUN', 'POISON', 'GLYPH', 'DRAIN'])
      for (const kind of ['info', 'damage', 'mp', undefined]) expect(numeric_float({ text: status, kind })).toBeNull()
  })

  test('a numeric text under an unknown kind is dropped, and a non-numeric text under a known kind too', () => {
    expect(numeric_float({ text: '-7', kind: 'info' })).toBeNull()
    expect(numeric_float({ text: '-7', kind: 'status' })).toBeNull()
    expect(numeric_float({ text: '-7 AP', kind: 'ap' })).toBeNull()
    expect(numeric_float({ text: 'TACKLED', kind: 'mp' })).toBeNull()
    expect(numeric_float({ text: '', kind: 'damage' })).toBeNull()
  })

  test('an absent payload is not a float', () => {
    expect(numeric_float(null)).toBeNull()
    expect(numeric_float(undefined)).toBeNull()
  })
})

describe('the presenter has no ungated float door', () => {
  test('every board float payload in the adapter is composed through numeric_float', () => {
    const ungated = [...adapter_src.matchAll(/^.*\bfloat:(?!\s*numeric_float\().*$/gm)].map((match) => match[0].trim())
    expect(ungated, 'a beat float payload reaches board.entity_beat without passing the numeric_float door').toEqual([])
  })

  test('board.float is reached only through the adapter float_on door', () => {
    const direct = [...adapter_src.matchAll(/board\.float\?*\.?\(/g)]
    expect(direct, 'board.float is called outside float_on — that call can leak a non-numeric float').toHaveLength(1)
    expect(adapter_src).toContain('const float = numeric_float(payload)\n    if (float) board.float?.(id, float)')
  })
})
