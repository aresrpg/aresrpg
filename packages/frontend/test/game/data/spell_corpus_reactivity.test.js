// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1088: surfaces mounted before the runtime corpus lands must be notified to re-resolve ranks.

import { readFileSync } from 'node:fs'

import { afterEach, expect, test } from 'bun:test'

import {
  get_spell_corpus,
  set_spell_corpus_for_test,
  subscribe_spell_corpus,
} from '../../../src/game/data/spell_corpus.js'
import { class_spells } from '../../../src/game/screens/hud/fight-spells.js'

const classes_tab_source = readFileSync(
  new URL('../../../src/pages/encyclopedia/classes_tab.tsx', import.meta.url),
  'utf8'
)

afterEach(() => set_spell_corpus_for_test())

test('a delayed spell corpus publication notifies already-mounted consumers', () => {
  set_spell_corpus_for_test()
  const snapshots = []
  const unsubscribe = subscribe_spell_corpus(() => snapshots.push(get_spell_corpus()))
  const rows = [{ id: 'senshi_delayed_rank' }]

  try {
    set_spell_corpus_for_test(rows)
    expect(snapshots).toEqual([rows])
  } finally {
    unsubscribe()
  }
})

test('an encyclopedia mounted before publication re-resolves its class spell rows', () => {
  set_spell_corpus_for_test()
  const snapshots = [class_spells('senshi').map((spell) => spell.name_key)]
  const unsubscribe = subscribe_spell_corpus(() => {
    snapshots.push(class_spells('senshi').map((spell) => spell.name_key))
  })

  try {
    set_spell_corpus_for_test([
      {
        id: 'senshi_delayed_encyclopedia',
        object_id: '0xdelayed_encyclopedia',
        name: 'Delayed Encyclopedia',
        classType: 'senshi',
        unlock: 1,
        levels: [],
      },
    ])

    expect(snapshots).toEqual([[], ['delayed_encyclopedia']])
    // This repo has no DOM renderer: pin the final React link as a source contract. The subscription and live
    // class projection above drive the behavioral half; this guards the ClassesTab memo against going stale.
    expect(classes_tab_source).toContain('const spell_corpus = useSpellCorpus()')
    expect(classes_tab_source).toMatch(
      /useMemo\(\s*\(\) => \(selected_class \? class_spells\(selected_class\.id\) : \[\]\),\s*\[selected_class, spell_corpus\]/
    )
  } finally {
    unsubscribe()
  }
})
