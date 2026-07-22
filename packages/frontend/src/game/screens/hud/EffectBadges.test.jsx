// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// (#451) ACTIVE EFFECT ROWS — the turn card renders the same visible localized rows as the board hover:
// effect name/value + remaining turns, directly in the card rather than hidden inside a nested tooltip.
//
// engine_view.fighters[].effects (packages/fight/src/project.js `effects_of`, LEG Q) is the live per-fighter
// effect+duration list this component renders — wired via the one-line prop-pass in FightTimeline.jsx
// (`f.effects`). This suite proves the pure projection (effect_badge_view) + the render output against
// fixtures shaped exactly like that getter's rows.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { EffectBadges, effect_badge_view } from './EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = (key, params) => i18n.t(key, params)

const render = (effects) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <EffectBadges effects={effects} />
    </I18nextProvider>
  )
const text_of = (html) => html.replace(/<[^>]*>/g, '')

// fixture rows shaped exactly like the proposed engine_view getter: the raw chain FighterStatus + its nested
// Effect fields (spell_board.move FighterStatus{fighter,kind,effect,remaining_turns,source} flattened) — kind
// is the numeric spell_effect.move id (27 = INVISIBILITY, 9 = ALTER_STAT), never pre-decoded to a string.
const invisibility_2t = { id: 'st-1', kind: 27, remaining_turns: 2 }
const vitality_ward_3t = { id: 'st-2', kind: 9, stat: 5, value: 10, remaining_turns: 3 }

describe('EffectBadges — compact persistent-effect rows on the turn card', () => {
  test('2 active effects render 2 visible localized rows with their values and remaining turns', () => {
    const html = render([invisibility_2t, vitality_ward_3t])
    const text = text_of(html)
    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(2)
    expect(text).toContain('Become invisible · 2 turns')
    expect(text).toContain('+10 Vitality · 3 turns')
  })

  test('0 active effects renders NOTHING — no empty container element', () => {
    expect(render([])).toBe('')
  })

  test('a missing effects prop (the getter not merged yet at HEAD) also renders nothing, never crashes', () => {
    expect(render(undefined)).toBe('')
  })

  test('an expired row (remaining_turns 0) is filtered out — never a stale badge', () => {
    expect(render([{ id: 'gone', kind: 27, remaining_turns: 0 }])).toBe('')
  })

  test('every active projection row stays readable rather than collapsing behind an overflow count', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 27, remaining_turns: i + 1 }))
    const html = render(many)
    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(6)
    expect(text_of(html)).toContain('Become invisible · 6 turns')
  })

  test('effect_badge_view reuses the EXISTING spells.fx_invisibility house grammar — no invented copy', () => {
    const view = effect_badge_view(t, invisibility_2t)
    expect(view.turns).toBe(2)
    expect(view.label).toBe(t('spells.fx_invisibility') + ' · ' + t('spells.fx_turns', { count: 2 }))
  })

  test('effect_badge_view exposes the shared structured line view for the renderer', () => {
    const view = effect_badge_view(t, vitality_ward_3t)
    expect(view.view).toMatchObject({ pre: '+', value: '10', post: ' Vitality', meta: '3 turns' })
  })
})
