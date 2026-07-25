// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'

import { ArchimobOdds } from './archimob_odds'

const EN = i18next.createInstance()
EN.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const render = (eligible: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <ArchimobOdds eligible={eligible} chance={0.5} />
    </I18nextProvider>
  )

test('a non-archi mob (no archi variant) shows NO archimob-odds line', () => {
  // design ruling 2026-07-19: the "0.5% chance to spawn as an archimob" showed on EVERY mob, even ones with no variant.
  expect(render(false)).toBe('')
})

test('an archi-eligible mob still advertises its spawn odds', () => {
  const html = render(true)
  expect(html).toContain('data-archimob-odds')
  expect(html).toContain('0.5%')
  expect(html).toContain('chance to spawn as an archimob')
})
