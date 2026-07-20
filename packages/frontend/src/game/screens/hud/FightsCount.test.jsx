// Nearby-fights count card — the sword badge's bare count ("1") sits glued
// against the label text, which ALSO embeds the count ("1 fights nearby") — the same number renders
// twice. ONE count home: the badge digit stays, the label goes count-less.
import { afterAll, expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

reset_auth_mock()
const [game_store] = await Promise.all([import('../../store.js')])
const state = { visible_fights: { size: 1 }, fight_mode: false }
const spies = [spyOn(game_store, 'use_game_state').mockImplementation((selector) => selector(state))]

const { FightsCount } = await import('./FightsCount.jsx')

const render = () =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(FightsCount)))

test('the count digit renders exactly once — the label carries no duplicate number', () => {
  const html = render()
  // the dedicated badge digit is present
  expect(html).toContain('hud-fights-count__num')
  const num_match = html.match(/hud-fights-count__num[^>]*>([^<]*)</)
  expect(num_match?.[1]).toBe('1')
  // the label span must NOT itself contain a digit (that would be the count glued a second time)
  const label_match = html.match(/hud-fights-count__label[^>]*>([^<]*)</)
  expect(label_match?.[1]).toBeTruthy()
  expect(label_match?.[1]).not.toMatch(/\d/)
})

test('accessibility keeps the real count in aria-label (not visually duplicated, still announced)', () => {
  const html = render()
  expect(html).toMatch(/aria-label="1 fights? nearby"/)
})

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})
