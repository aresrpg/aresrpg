// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1088: surfaces mounted before the runtime corpus lands must be notified to re-resolve ranks.

import { afterEach, expect, test } from 'bun:test'

import {
  get_spell_corpus,
  set_spell_corpus_for_test,
  subscribe_spell_corpus,
} from '../../../src/game/data/spell_corpus.js'

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
