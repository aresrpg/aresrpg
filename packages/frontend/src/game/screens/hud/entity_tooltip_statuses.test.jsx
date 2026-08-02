// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// (#451) RED-FIRST — the presented fighter projection already carried active timed effects, but the board-hover
// card reduced them to aria-hidden dots. Pin the exact live report through the pure render seam: a +1 Raw Damage
// buff with 3 turns remaining must be readable, while an expired projection row must render nothing.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'

import en from '../../../i18n/locales/en.json'
import { TooltipCard } from './tooltip_card.jsx'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = (key, params) => i18n.t(key, params)
const text_of = (html) => html.replace(/<[^>]*>/g, '')

// Numeric kinds come from spell_effect.js / the conformance matrix: 9 = ALTER_STAT, 21 = APPLY_DOT,
// 27 = INVISIBILITY. This is the exact shape engine_view projects from presented fighter.statuses.
const buff = { id: 's-buff', kind: 9, stat: 9, value: 1, remaining_turns: 3 }
const dot_fire = { id: 's-dot', kind: 21, element: 0, value: 5, remaining_turns: 1 }
const invis = { id: 's-inv', kind: 27, remaining_turns: 4 }
// #2000 (D42) — a 0 counter is the bearer's LAST COVERED TURN, not an expired row: still live on chain, still
// readable on the hover. A genuinely gone row reaches this card as an ABSENT one (the fold drops it), never as a 0.
const last_turn = { id: 's-last', kind: 9, stat: 9, value: 99, remaining_turns: 0 }
const base_props = {
  team: 0,
  style: {},
  exiting: false,
  name: 'Alice',
  shown_hp: 10,
  displacement: null,
  effects: [],
  t,
}

describe('TooltipCard — presented active effects are readable on the board hover', () => {
  test('an active timed buff renders its value + remaining turns; a row on its last covered turn still does', () => {
    const active_html = renderToStaticMarkup(<TooltipCard {...base_props} outcome={null} status_effects={[buff]} />)
    expect(text_of(active_html)).toContain('+1 Raw Damage · 3 turns')

    const last_html = renderToStaticMarkup(<TooltipCard {...base_props} outcome={null} status_effects={[last_turn]} />)
    expect(text_of(last_html)).toContain('+99 Raw Damage')
    expect(last_html).toContain('hud-effects')
  })

  test('each active projected effect renders through the shared compact effect-line grammar', () => {
    const html = renderToStaticMarkup(
      <TooltipCard {...base_props} outcome={null} status_effects={[buff, dot_fire, invis]} />
    )
    const text = text_of(html)
    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(3)
    expect(text).toContain('5 Fire damage per turn · 1 turn')
    expect(text).toContain('Become invisible · 4 turns')
  })

  test('absent effects render no empty effects container', () => {
    const html = renderToStaticMarkup(<TooltipCard {...base_props} outcome={null} />)
    expect(html).not.toContain('hud-effects')
  })
})
