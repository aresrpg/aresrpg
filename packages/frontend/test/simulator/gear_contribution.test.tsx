// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE (+X) TRUTH TEST (#1059 follow-up). The reported symptom was "the gear numbers read wrong" — so the
// arithmetic gets pinned against a HAND-COMPUTED expectation rather than against itself. Three equipped items
// with authored ranges, one decoy that is in the corpus but NOT in the loadout, and the four sums written out
// by hand below. Every suspicion the report named is a row here:
//
//   · equipped-only .......... the decoy carries +999 of everything and must contribute NOTHING
//   · per-stat, not pooled ... each row gets ITS stat's sum, never the item's total stat weight
//   · max roll ............... an authored [min,max] contributes its CEILING (the simulator's whole premise)
//   · no double count ........ two items rolling the same stat add once each, not once per stat line
//   · signed ................. a negative line subtracts instead of being absolute-valued
//
// The numbers are deliberately un-round and mutually distinct: a bug that pools, doubles or absolutes them
// cannot land on the expected value by coincidence.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../src/i18n/locales/en.json'
import * as item_corpus from '../../src/pages/encyclopedia/item_corpus'
import { equipment_aggregate, resolve_loadout } from '../../src/simulator/content.js'
import { CharacterEditor } from '../../src/simulator/CharacterModal'
import { EMPTY_STAT_ALLOC, type SimCharacter } from '../../src/simulator/reducer'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const item = (
  id: string,
  category: string,
  stats: Record<string, [number, number] | number>
): item_corpus.CorpusItem => ({
  id,
  name: id,
  description: '',
  category,
  item_type: id,
  level: 60,
  stats,
  damages: [],
})

// ── the equipped three ────────────────────────────────────────────────────────────────────────────
const helmet = item('gc-helmet', 'helmet', { strength: [2, 7], vitality: [10, 41] })
const amulet = item('gc-amulet', 'amulet', { strength: [1, 3], intelligence: [5, 9], vitality: [0, 23] })
// A negative line: gear that COSTS a stat must subtract, not be absolute-valued.
const boots = item('gc-boots', 'boots', { agility: [4, 11], vitality: [-5, -2] })

// ── the decoy: in the corpus, in no slot ──────────────────────────────────────────────────────────
const decoy = item('gc-decoy', 'helmet', {
  strength: [999, 999],
  vitality: [999, 999],
  intelligence: [999, 999],
  agility: [999, 999],
})

// HAND-COMPUTED, from the three EQUIPPED rows' max halves only:
//   strength     = 7 (helmet) + 3 (amulet)                    = 10
//   vitality     = 41 (helmet) + 23 (amulet) + (-2) (boots)   = 62
//   intelligence = 9 (amulet)                                 = 9
//   agility      = 11 (boots)                                 = 11
const EXPECTED = { strength: 10, vitality: 62, intelligence: 9, agility: 11 } as const

const character: SimCharacter = {
  id: 'sim_gc',
  name: 'Ledger',
  class_id: 'senshi',
  male: true,
  level: 60,
  stat_alloc: { ...EMPTY_STAT_ALLOC, strength: 12 },
  spell_levels: {},
  loadout: { helmet: helmet.id, amulet: amulet.id, boots: boots.id },
}

const corpus = {
  items: [helmet, amulet, boots, decoy],
  by_id: new Map([helmet, amulet, boots, decoy].map((row) => [row.id, row])),
  loading: false,
}

test('the gear aggregate is the hand-computed per-stat sum of the EQUIPPED max rolls', () => {
  const { items, unresolved } = resolve_loadout(corpus.by_id, character.loadout)

  expect(unresolved).toEqual([])
  expect(items.map((row) => row.id).sort()).toEqual(['gc-amulet', 'gc-boots', 'gc-helmet'])

  const totals = equipment_aggregate(items)

  expect(totals.strength).toBe(EXPECTED.strength)
  expect(totals.vitality).toBe(EXPECTED.vitality)
  expect(totals.intelligence).toBe(EXPECTED.intelligence)
  expect(totals.agility).toBe(EXPECTED.agility)
  // The decoy's +999 reached nothing: a whole-corpus sum would put every row at 1000+.
  expect(totals.chance ?? 0).toBe(0)
  expect(totals.wisdom ?? 0).toBe(0)
})

test('each stat row prints ITS own hand-computed contribution beside the editable allocation', () => {
  const corpus_spy = spyOn(item_corpus, 'useItemCorpus').mockImplementation(() => corpus)

  try {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <CharacterEditor character={character} on_deleted={() => {}} />
      </I18nextProvider>
    )

    // The input stays the ALLOCATION (12 points), never allocation+gear.
    expect(markup).toContain('value="12"')
    // Exactly one bonus per stat that gear actually touches — four, not six, and not one per stat LINE.
    expect(markup.match(/stats__prow-bonus/g)).toHaveLength(4)
    for (const value of Object.values(EXPECTED)) expect(markup).toContain(`(+${value})`)
    // Nothing in the markup carries the decoy's magnitude.
    expect(markup).not.toContain('999')
    expect(markup).not.toContain('1000')
  } finally {
    corpus_spy.mockRestore()
  }
})
