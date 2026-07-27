// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1059: simulator stat rows show editable base allocation plus max-roll gear.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../src/i18n/locales/en.json'
import * as item_corpus from '../../src/pages/encyclopedia/item_corpus'
import { CharacterEditor } from '../../src/simulator/CharacterModal'
import { EMPTY_STAT_ALLOC, type SimCharacter } from '../../src/simulator/reducer'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const max_roll_helmet: item_corpus.CorpusItem = {
  id: 'helmet-max-roll',
  name: 'Max Roll Helmet',
  description: '',
  category: 'helmet',
  item_type: 'max_roll_helmet',
  level: 20,
  stats: {
    strength: [2, 7],
    intelligence: [-9, -5],
    vitality: [0, 0],
  },
  damages: [],
}

const character: SimCharacter = {
  id: 'sim_c1',
  name: 'Builder',
  class_id: 'senshi',
  male: true,
  level: 50,
  stat_alloc: { ...EMPTY_STAT_ALLOC, strength: 12 },
  spell_levels: {},
  loadout: { helmet: max_roll_helmet.id },
}

test('stat rows render base (+gear) while the input remains the editable base allocation', () => {
  const corpus = {
    items: [max_roll_helmet],
    by_id: new Map([[max_roll_helmet.id, max_roll_helmet]]),
    loading: false,
  }
  const corpus_spy = spyOn(item_corpus, 'use_item_corpus').mockImplementation(() => corpus)

  try {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <CharacterEditor character={character} on_deleted={() => {}} />
      </I18nextProvider>
    )

    expect(markup).toContain('aria-label="strength"')
    expect(markup).toContain('value="12"')
    expect(markup).toContain('<span class="stats__prow-bonus"> (+7)</span>')
    expect(markup).toContain('<span class="stats__prow-bonus"> (-5)</span>')
    expect(markup.match(/stats__prow-bonus/g)).toHaveLength(2)
  } finally {
    corpus_spy.mockRestore()
  }
})
