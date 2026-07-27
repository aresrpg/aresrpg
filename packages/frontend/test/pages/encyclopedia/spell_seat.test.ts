// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1088: encyclopedia rank truth comes from the Character's namespaced spell-state read.

import { readFileSync } from 'node:fs'

import { afterEach, expect, spyOn, test } from 'bun:test'

import * as spell_state from '../../../src/chain/read_spell_state.js'
import { set_spell_corpus_for_test } from '../../../src/game/data/spell_corpus.js'
import { load_encyclopedia_spell_alloc } from '../../../src/pages/encyclopedia/spell_seat'

const spell_object_id = '0xencyclopedia_learned_rank'
const corpus_row = {
  id: 'senshi_encyclopedia_learned_rank',
  object_id: spell_object_id,
  name: 'Encyclopedia Learned Rank',
  classType: 'senshi',
  unlock: 1,
  levels: [],
}

afterEach(() => set_spell_corpus_for_test())

test("loads the selected character's learned levels from the canonical spell-state door", async () => {
  set_spell_corpus_for_test([corpus_row])
  const read_spy = spyOn(spell_state, 'read_spell_state').mockResolvedValue({
    spent: 1,
    levels: { [spell_object_id]: 2 },
  })

  try {
    const allocation = await load_encyclopedia_spell_alloc({
      id: '0xcharacter',
      classe: 'senshi',
    })

    expect(read_spy).toHaveBeenCalledWith('0xcharacter', [spell_object_id])
    expect(allocation).toEqual({ spent: 1, levels: { [spell_object_id]: 2 } })
  } finally {
    read_spy.mockRestore()
  }
})

test('the HUD and encyclopedia derive from one reducer-owned spell allocation composition', () => {
  const store = readFileSync(new URL('../../../src/stores/spell_seat.ts', import.meta.url), 'utf8')
  const spellbook = readFileSync(new URL('../../../src/game/screens/hud/Spellbook.jsx', import.meta.url), 'utf8')
  const encyclopedia = readFileSync(new URL('../../../src/pages/encyclopedia/spell_seat.ts', import.meta.url), 'utf8')

  expect(store).toContain("from '../chain/read_spell_state.js'")
  expect(spellbook).toContain("from '../../../stores/spell_seat'")
  expect(spellbook).not.toContain("from '../../../chain/read_spell_state.js'")
  expect(encyclopedia).toContain("from '../../stores/spell_seat'")
  expect(encyclopedia).not.toContain("from '../../chain/read_spell_state.js'")
})
