// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FEED-PET DIET: the empty-food state used to say only "you have no feedable
// resources" without naming what the pet actually eats. It now always shows the D757 global food display
// (pet_food_section.tsx's PetFoodHoverRow) inside the empty box, alongside the existing caption.
//
// PetFeedModal itself always portals to <body> (createPortal, no conditional) — this repo's convention is
// renderToStaticMarkup with no jsdom/happy-dom (see ItemIcon.test.jsx), which cannot resolve a portal target.
// PetFeedEmptyState is the extracted, portal-free piece (mirrors CrushMenu/CrushConfirmModal's own split),
// so the empty-state markup is directly render-testable.
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = i18n.getFixedT('en')

reset_auth_mock()
const { PetFeedEmptyState } = await import('./PetFeedModal.jsx')

const render = (food_slugs) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(PetFeedEmptyState, { food_slugs, t }))
  )

test('an empty owned-food list still names what the pet eats (never a bare "you have none")', () => {
  const html = render(['barley_flour', 'orchid_spore_blend'])
  expect(html).toContain('data-pet-food-row')
  expect(html).toContain('You have no feedable resources.')
})

test('honest empty when nothing is configured yet — no fabricated diet row', () => {
  const html = render([])
  expect(html).not.toContain('data-pet-food-row')
  expect(html).toContain('You have no feedable resources.')
})
