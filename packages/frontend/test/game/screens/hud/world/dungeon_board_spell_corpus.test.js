// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1742: a board mounted before the runtime spell corpus lands must subscribe to that corpus, then
// re-resolve and publish the fighter's hand. The repo has no DOM renderer, so the live corpus subscription and
// resolver drive the behavioral half while the source contract pins DungeonBoard to the same React binding
// Spellbook uses.

import { readFileSync } from 'node:fs'

import { afterEach, expect, test } from 'bun:test'

import { set_spell_corpus_for_test, subscribe_spell_corpus } from '../../../../../src/game/data/spell_corpus.js'
import { resolve_class_spells } from '../../../../../src/game/screens/hud/fight-spells.js'

const dungeon_board_source = readFileSync(
  new URL('../../../../../src/game/screens/hud/world/DungeonBoardState.jsx', import.meta.url),
  'utf8'
)

const delayed_spell = {
  id: 'senshi_delayed_strike',
  classType: 'senshi',
  unlock: 1,
  name: 'Delayed Strike',
  object_id: '0x1742',
  levels: [],
}

const mount_hand = (class_id, level) => {
  let hand = []
  const render = () => {
    hand = resolve_class_spells(class_id, level).map((spell) => spell.name_key)
  }
  render()
  return {
    hand: () => hand,
    unmount: subscribe_spell_corpus(render),
  }
}

afterEach(() => set_spell_corpus_for_test())

test('DungeonBoard mounted before a delayed corpus publishes the populated spell bar (#1742)', () => {
  set_spell_corpus_for_test()
  const board = mount_hand('senshi', 1)

  try {
    expect(board.hand()).toEqual([])
    set_spell_corpus_for_test([delayed_spell])
    expect(board.hand()).toEqual(['delayed_strike'])

    expect(dungeon_board_source).toContain('const spell_corpus = useSpellCorpus()')
    expect(dungeon_board_source).toMatch(
      /useMemo\(\s*\(\) => resolve_class_spells\(my_class, my_level\),\s*\[my_class, my_level, spell_corpus\]\s*\)/
    )
  } finally {
    board.unmount()
  }
})
