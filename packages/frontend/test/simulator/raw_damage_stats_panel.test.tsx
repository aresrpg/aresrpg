// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1389 RED-FIRST — the build already derives gear-carried raw damage, but the simulator stats panel rendered
// only the six allocatable primaries. Drive one published max-roll item through the real aggregate and assert
// that the read-only row shows the same derived value.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { get_secondary_stats, STATISTICS } from '@aresrpg/sdk/stats'

import en from '../../src/i18n/locales/en.json'
import * as item_corpus from '../../src/pages/encyclopedia/item_corpus'
import type { CorpusItem } from '../../src/pages/encyclopedia/item_corpus'
import { CharacterEditor } from '../../src/simulator/CharacterModal'
import { equipment_aggregate } from '../../src/simulator/content.js'
import { EMPTY_STAT_ALLOC, type SimCharacter } from '../../src/simulator/reducer'

const RAW_DAMAGE = 42
const blade: CorpusItem = {
  id: 'raw-damage-blade',
  name: 'Probe Blade',
  description: '',
  category: 'longsword',
  item_type: 'raw_damage_blade',
  level: 50,
  stats: { rawDamage: [7, RAW_DAMAGE] },
  damages: [],
}

const character: SimCharacter = {
  id: 'sim-1389',
  name: 'Raw Probe',
  class_id: 'senshi',
  male: true,
  level: 50,
  stat_alloc: EMPTY_STAT_ALLOC,
  spell_levels: {},
  loadout: { weapon: blade.id },
}

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

test('RED: a gear raw-damage bonus appears in the stats panel at its existing derived value', () => {
  const corpus = { items: [blade], by_id: new Map([[blade.id, blade]]), loading: false, error: null }
  const corpus_spy = spyOn(item_corpus, 'useItemCorpus').mockImplementation(() => corpus)
  try {
    const equipment_stats = equipment_aggregate([blade])
    const derived = get_secondary_stats({ equipment_stats }).find((row) => row.key === STATISTICS.RAW_DAMAGE)
    expect(derived?.value).toBe(RAW_DAMAGE)

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <CharacterEditor character={character} on_deleted={() => {}} />
      </I18nextProvider>
    )
    expect(markup).toContain(`data-stat-icon="${STATISTICS.RAW_DAMAGE}"`)
    expect(markup).toContain(en.stat.raw_damage)
    expect(markup).toContain(`(+${derived?.value})`)
  } finally {
    corpus_spy.mockRestore()
  }
})
