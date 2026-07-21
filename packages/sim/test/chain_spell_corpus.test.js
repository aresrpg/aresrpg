// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { normalize_chain_spell_corpus } from '../src/chain_spell_corpus.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import {
  CORPUS,
  SPELLS_CORPUS_AVAILABLE,
} from './spell_effect_conformance_matrix.js'

describe('chain spell corpus door', () => {
  // MISSING-ARTIFACT (#96): seed/mainnet/spells is generated content from the content pipeline (private
  // repo), absent by design here — CORPUS degrades to []. The 2nd test below (inline boundary-probe data)
  // has no corpus dependency and keeps running for real.
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'normalizes exactly the 240 authored on-chain spells through the sim template algebra',
    () => {
      const templates = normalize_chain_spell_corpus(CORPUS)
      expect(CORPUS).toHaveLength(240)
      expect(templates.size).toBe(CORPUS.length)

      for (const raw of CORPUS) {
        const expected = normalize_spell_templates([raw]).get(raw.id)
        expect(templates.get(raw.id)).toEqual(expected)
      }
    },
  )

  test('preserves chain-only targeting and flag fields at the package boundary', () => {
    const templates = normalize_chain_spell_corpus([
      {
        id: 'boundary_probe',
        levels: [
          {
            ap_cost: 3,
            effects: [
              { kind: 0, value: 7, target_filter: 17, flags: 5, chance: 100 },
            ],
            crit_effects: [],
          },
        ],
      },
    ])
    expect(
      templates.get('boundary_probe')?.levels[0].base_effects[0],
    ).toMatchObject({
      kind: 0,
      target_filter: 17,
      flags: 5,
    })
  })
})
