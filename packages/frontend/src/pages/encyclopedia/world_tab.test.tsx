// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { configure_assets } from '@aresrpg/sdk/jobs'

import en from '../../i18n/locales/en.json'
import { set_catalog_for_test } from '../../game/data/mob_catalog.js'

import { RosterChip } from './world_tab'

afterAll(() => set_catalog_for_test())

const EN = i18next.createInstance()
EN.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const mob = { id: '0xabc', name: 'Alley Bunny', element: 'earth', role: 'trash', minLevel: 1, maxLevel: 4 }
const render = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <RosterChip mob={mob} />
    </I18nextProvider>
  )

test('the world roster mob icon uses the encyclopedia asset-host home — never the forbidden /sprites fallback', () => {
  // Encyclopedia law (encyclopedia_assets.ts): the MinIO `mobs/` family is the ONLY permitted origin.
  // Historical leak (#117): the old generic mob-image component (deleted, #353) fell back to a local
  // /sprites/… path. Kept as the regression tooth: the roster never emits that deleted local path.
  configure_assets({ aggregator: 'https://agg.example' })
  expect(render()).not.toContain('/sprites/')
})

test('the roster shows the resolved asset-host icon (one home with the bestiary)', () => {
  // MISSING-ARTIFACT (#117): EncyclopediaMobImage resolves the name->glb join through mob_catalog.js's
  // get_catalog(), a runtime-published census never fetched in this headless test — set_catalog_for_test
  // is the sanctioned seam (mirrors set_spell_corpus_for_test); seed the row this mob needs.
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_assets({ aggregator: 'https://agg.example' })
  const html = render()
  expect(html).toContain('<img')
  expect(html).toContain('agg.example/mobs/')
})
