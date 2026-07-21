// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'

import en from '../../../i18n/locales/en.json'

import { SpellHoverTip, spell_hover_facts } from './spell-hover-tip.jsx'
import { Tooltip } from './Tooltip.jsx'

const EN_I18N = i18next.createInstance()
EN_I18N.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = EN_I18N.t.bind(EN_I18N)
const visible_text = (html) => html.replace(/<[^>]+>/g, '')

const SPELL = {
  kind: 'dmg',
  levels: [
    {
      ap: 3,
      range: [1, 5],
      crit_rate: 4,
      cooldown: 2,
      effects: [
        { kind: 'DAMAGE', element: 'fire', damageMin: 5, damageMax: 14, chance: 100, turns: 0 },
        { kind: 'REDUCE_DAMAGE', base: 8, chance: 100, turns: 2 },
      ],
    },
  ],
}

describe('spell_hover_facts', () => {
  test('derives the deleted readout data from the seeded spell SSOT', () => {
    const facts = spell_hover_facts(t, SPELL)

    expect(facts.ap).toBe(3)
    expect(facts.range_txt).toBe('1-5')
    expect(facts.crit_txt).toBe('1 / 4')
    expect(facts.cooldown_txt).toBe('2 turns')
    expect(facts.subline).toBe('Fire · Damage')
    expect(facts.effects.map((effect) => effect.text)).toEqual([
      '5 to 14 Fire damage',
      'Absorbs 8 damage · any element · 2 turns',
    ])
  })

  test('collapses equal range bounds and localizes empty crit/cooldown values', () => {
    const facts = spell_hover_facts(t, {
      kind: 'heal',
      levels: [{ ap: 2, range: [3, 3], crit_rate: 0, cooldown: 0, effects: [] }],
    })

    expect(facts.range_txt).toBe('3')
    expect(facts.crit_txt).toBe(en.fight.none)
    expect(facts.cooldown_txt).toBe(en.fight.none)
    expect(facts.subline).toBe(en.spells.heal)
  })
})

describe('SpellHoverTip', () => {
  test('renders name/type, AP badge, all four facts, EFFECTS, and shared effect lines', () => {
    const html = renderToStaticMarkup(createElement(SpellHoverTip, { t, name: 'Ember Ward', spell: SPELL }))
    const text = visible_text(html)

    expect(html).toContain('tt-spell-card__name')
    expect(html).toContain('tt-spell-card__type')
    expect(html).toContain('tt-ap-pill')
    expect(html).toContain('tt-spell-card__facts')
    expect(text).toContain('Ember Ward')
    expect(text).toContain('Fire · Damage')
    expect(text).toContain(en.spells.ap_cost)
    expect(text).toContain(en.spells.range)
    expect(text).toContain(en.spells.crit_chance)
    expect(text).toContain(en.spells.cooldown)
    expect(text).toContain(en.spells.effects)
    expect(text).toContain('Absorbs 8 damage · any element · 2 turns')
    expect(html).not.toContain('tt-spell-card__aim')
  })

  test('renders the localized aiming hint inside the same card only while aimed', () => {
    const html = renderToStaticMarkup(
      createElement(SpellHoverTip, { t, name: 'Ember Ward', spell: SPELL, aiming: true })
    )

    expect(html).toContain('tt-spell-card__aim')
    expect(visible_text(html)).toContain('Aiming Ember Ward — pick a cell in range')
  })

  test('uses the sharp near-black FightReport shell, gold name, and tracked 10px micro-labels', () => {
    const css = readFileSync(new URL('./tooltip.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*background:\s*#07080c/s)
    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*border:\s*1px solid rgba\(255, 255, 255, 0\.1\)/s)
    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*border-radius:\s*0/s)
    expect(css).toMatch(/\.tt-spell-card__name\s*\{[^}]*color:\s*#c8963c/s)
    expect(css).toMatch(/\.tt-spell-card__label,[^}]*font-size:\s*10px[^}]*letter-spacing:\s*0\.14em/s)
  })
})

test('Tooltip pins the selected spell card at the same anchored home without a second presenter', () => {
  const html = renderToStaticMarkup(
    createElement(
      Tooltip,
      { pinned: true, content: createElement('span', null, 'Pinned spell') },
      createElement('button', { type: 'button' }, 'Spell')
    )
  )

  expect(html).toContain('role="tooltip"')
  expect(html).toContain('Pinned spell')
})
