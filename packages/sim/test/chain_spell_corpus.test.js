import { describe, expect, test } from 'bun:test'

import { normalize_chain_spell_corpus } from '../src/chain_spell_corpus.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import { CORPUS } from './spell_effect_conformance_matrix.js'

describe('chain spell corpus door', () => {
  test('normalizes exactly the 240 authored on-chain spells through the sim template algebra', () => {
    const templates = normalize_chain_spell_corpus(CORPUS)
    expect(CORPUS).toHaveLength(240)
    expect(templates.size).toBe(CORPUS.length)

    for (const raw of CORPUS) {
      const expected = normalize_spell_templates([raw]).get(raw.id)
      expect(templates.get(raw.id)).toEqual(expected)
    }
  })

  test('preserves chain-only targeting and flag fields at the package boundary', () => {
    const templates = normalize_chain_spell_corpus([
      {
        id: 'boundary_probe',
        levels: [
          {
            ap_cost: 3,
            effects: [{ kind: 0, value: 7, target_filter: 17, flags: 5, chance: 100 }],
            crit_effects: [],
          },
        ],
      },
    ])
    expect(templates.get('boundary_probe')?.levels[0].base_effects[0]).toMatchObject({
      kind: 0,
      target_filter: 17,
      flags: 5,
    })
  })
})
