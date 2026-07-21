// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #106 — the spell consumer over the RUNTIME corpus loader (end to end). Importing fight-spells.js must
// NOT throw (it no longer statically imports the seed manifest / globs the corpus — the migration-stub
// coupling is dead), its exports DEGRADE to [] when the blob is absent, and they go LIVE the moment the blob
// loads (the memoized projection re-derives off the loader's cache). Proves the boot-safety the smoke asserts.
import { afterEach, describe, expect, test } from 'bun:test'

import { set_spell_corpus_for_test } from '../../data/spell_corpus.js'

import { class_spells, fight_spell, fight_spells_data, resolve_class_spells, spell_object_id } from './fight-spells.js'

afterEach(() => set_spell_corpus_for_test()) // reset the module-state corpus to pristine-empty

const merged = [
  { id: 'senshi_warcleave', classType: 'senshi', unlock: 1, name: 'Warcleave', role: 'damage', element: 'earth', object_id: '0xabc', levels: [] },
  { id: 'senshi_oathblade', classType: 'senshi', unlock: 3, name: 'Oathblade', role: 'damage', element: 'air', object_id: '0xdef', levels: [] },
]

describe('spell consumer over the runtime corpus (issue #106)', () => {
  test('corpus ABSENT (default / open-source tree) → every export degrades to empty, never throws', () => {
    set_spell_corpus_for_test() // empty
    expect(() => resolve_class_spells('senshi', 10)).not.toThrow()
    expect(resolve_class_spells('senshi', 10)).toEqual([])
    expect(class_spells('senshi')).toEqual([])
    expect(fight_spell('warcleave')).toBeNull()
    expect(spell_object_id('warcleave')).toBeNull()
    expect(fight_spells_data.spells).toEqual([])
  })

  test('corpus LOADED → the live projection re-derives; resolve/name-key/object-id all serve it', () => {
    set_spell_corpus_for_test(merged)
    expect(resolve_class_spells('senshi', 10).map((s) => s.name_key)).toEqual(['warcleave', 'oathblade'])
    expect(resolve_class_spells('senshi', 1).map((s) => s.name_key)).toEqual(['warcleave']) // unlock gate
    expect(fight_spell('oathblade')?.name).toBe('Oathblade')
    expect(spell_object_id('warcleave')).toBe('0xabc')
    expect(fight_spells_data.spells).toHaveLength(2)
  })

  test('a later blob swap is picked up live (no stale module-load snapshot)', () => {
    set_spell_corpus_for_test() // empty first
    expect(fight_spells_data.spells).toEqual([])
    set_spell_corpus_for_test(merged) // blob lands
    expect(fight_spells_data.spells).toHaveLength(2) // re-derived, not frozen
  })
})
