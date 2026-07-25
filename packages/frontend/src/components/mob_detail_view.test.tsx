// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'

import { MobDetailView } from './mob_detail_view'

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

test('MobDetailView renders clickable authored worlds immediately after the loot table', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MobDetailView
        mob={{
          name: 'Alley Bunny',
          icon_name: 'Alley Bunny',
          element: 'EARTH',
          minLevel: 1,
          maxLevel: 4,
          health: 15,
          xpReward: null,
          isBoss: false,
          stats: {},
          drops: [],
          found_in: [
            {
              id: '0x73afc177ac238e2c94d47f2af2b24493647f2a84baa30597621c87009f9be266',
              name: 'First Shore',
              biome: 'archipelago',
            },
          ],
        }}
        on_navigate_to_world={() => {}}
        show_stats={false}
      />
    </I18nextProvider>
  )

  expect(html.indexOf('LOOT TABLE')).toBeLessThan(html.indexOf('FOUND IN'))
  expect(html).toContain('First Shore')
  expect(html).toContain('archipelago')
  expect(html).toContain('data-world-id="0x73afc177ac238e2c94d47f2af2b24493647f2a84baa30597621c87009f9be266"')
  expect(html).toContain('<button')
})

test('the HP reward reads as LIFE — its number wears the red life tone, not the gold every other number uses', () => {
  // design ruling 2026-07-19: show the life of the mob as a better color with a heart. At HEAD the HP number was
  // text-gold like everything else; it must now carry the #f87171 life tone (the same red-family token this
  // view already uses for a negative resistance — no new palette).
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MobDetailView
        mob={{
          name: 'Alley Bunny',
          icon_name: 'Alley Bunny',
          element: 'EARTH',
          minLevel: 1,
          maxLevel: 4,
          health: 1234,
          xpReward: null,
          isBoss: false,
          stats: {},
          drops: [],
          found_in: [],
        }}
        show_stats={false}
      />
    </I18nextProvider>
  )
  const hp = html.slice(html.indexOf('data-reward="hp"'), html.indexOf('data-reward="hp"') + 900)
  expect(hp).toContain('data-reward="hp"')
  expect(hp).toContain('<svg') // the heart icon
  expect(hp).toContain('#f87171') // the life tone rides the HP heart + number
  expect(hp).toContain('>1,234<') // …and the HP value itself wears it (its own coloured span)
})
