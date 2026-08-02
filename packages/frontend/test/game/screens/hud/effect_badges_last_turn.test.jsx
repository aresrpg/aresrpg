// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #2000 RED-FIRST — THE BADGE ROW HELD THE FOURTH HOME OF THE SUPERSEDED DECREMENT LAW.
//
// D42: `remaining_turns` counts the bearer's turns STILL TO COME, so a counter of 0 is a row on its LAST covered
// turn — live on chain, kept by the fold, promoted by the prediction, and therefore owed a badge. The turn card
// and the board hover both render through `ActiveEffectRows`, which filtered `remaining_turns > 0` away: the one
// turn a player most needs to see a buff (its last) was the one turn the HUD hid it, while the chain still
// resolved under it. The lifetime the family pins is 3 → 2 → 1 → 0 (packages/fight/test/badge_turn_boundary),
// so 0 is a rendered state, not an absent one.
//
// DISPLAY LAW: what the badge PRINTS is not the raw counter. The reference client renders the counter raw and a
// live row never displays zero, so the badge floors at one: this row's chain counter is 0 and its badge reads
// "1 turn". The assertions below pin BOTH halves — the row is rendered (never filtered away), and its printed
// duration is the floored display number, not the raw 0.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../../src/i18n/locales/en.json'
import { ActiveEffectRows, effect_badge_view } from '../../../../src/game/screens/hud/EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = (key, params) => i18n.t(key, params)

const render = (effects) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ActiveEffectRows effects={effects} t={t} />
    </I18nextProvider>
  )
const text_of = (html) => html.replace(/<[^>]*>/g, '')

const last_turn_invisibility = { id: 'st-last', kind: 27, remaining_turns: 0 }

describe('#2000 · a row on its LAST covered turn still owns a badge', () => {
  test('RED: the 0-counter row renders, and prints the floored display number', () => {
    const html = render([last_turn_invisibility])

    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(1)
    expect(text_of(html)).toContain('Become invisible · ' + t('spells.fx_turns', { count: 1 }))
  })

  test('RED: it survives next to rows that still have turns to come — no row is hidden mid-window', () => {
    const html = render([{ id: 'st-buff', kind: 9, stat: 5, value: 10, remaining_turns: 2 }, last_turn_invisibility])

    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(2)
  })

  test('an empty or absent effect list is still nothing at all — the container never renders hollow', () => {
    expect(render([])).toBe('')
    expect(render(undefined)).toBe('')
  })

  test('the pure projection keeps the last covered turn visible, floored so a live row never reads zero', () => {
    expect(effect_badge_view(t, last_turn_invisibility).turns).toBe(1)
  })
})
