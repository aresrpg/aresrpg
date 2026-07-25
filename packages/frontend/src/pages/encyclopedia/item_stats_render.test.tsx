// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import { item_damages_from_v1, item_stats_from_v1 } from '../../chain/read_findables'
import { ItemDetailView } from '../../components/item_detail_view'
import en from '../../i18n/locales/en.json'

const en_i18n = i18next.createInstance()
en_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

test('item encyclopedia decodes live stat ranges and renders min to max while omitting neutral rows', () => {
  const stats = item_stats_from_v1({
    vitality: [32771, 32776],
    wisdom: [32768, 32768],
  })
  const text = visible_text(
    renderToStaticMarkup(
      <I18nextProvider i18n={en_i18n}>
        <ItemDetailView
          item={{
            name: 'Range Ring',
            category: 'RING',
            rarity: '',
            level: 1,
            damages: [],
            stats,
          }}
        />
      </I18nextProvider>
    )
  )

  expect(text).toContain('+3 to 8 Vitality')
  expect(text).not.toContain('Wisdom')
})

// #619 leg 3 — the encyclopedia joined `damages` from the build-time seed catalog, which resolves EMPTY in
// this repo's build (vite.config.ts catalog_fallback_plugin), so every weapon rendered a characteristics block
// with no damage line at all. The chain truth ships on the same /v1 row as the stat ranges.
test('a weapon renders its authored damage line off the live /v1 projection (#619)', () => {
  const damages = item_damages_from_v1([{ from: 16, to: 29, damage_type: 'weapon', element: 'water' }])
  const text = visible_text(
    renderToStaticMarkup(
      <I18nextProvider i18n={en_i18n}>
        <ItemDetailView
          item={{
            name: 'Practice Longsword',
            category: 'LONGSWORD',
            rarity: '',
            level: 1,
            damages,
            stats: {},
          }}
        />
      </I18nextProvider>
    )
  )

  expect(text).toContain('16 - 29')
  expect(text).toContain('WATER')
})
