// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'

import { SpellHoverTip, spell_hover_facts } from './spell-hover-tip.jsx'

// DeckCluster imports the browser-flavoured dungeon store. Keep the same narrow host surface alive as the
// colocated FightControls.turn-phase test so this regression can mount the REAL bar against the REAL fight core.
const w = /** @type {any} */ (globalThis.window ??= /** @type {any} */ ({}))
w.addEventListener ??= () => {}
w.removeEventListener ??= () => {}
w.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
w.location ??= { origin: 'http://localhost:5173', href: 'http://localhost:5173/' }
w.location.href ??= 'http://localhost:5173/'
w.dispatchEvent ??= () => true
globalThis.localStorage ??= /** @type {any} */ ({ getItem: () => null, setItem() {}, removeItem() {} })
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const { DeckCluster } = await import('./DeckCluster.jsx')
const { seed_fight_core, reset_fight_core } = await import('../../../test_helpers/fight_core_harness.js')
const { set_spell_corpus_for_test } = await import('../../data/spell_corpus.js')

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
        {
          kind: 'DAMAGE',
          element: 'fire',
          damageMin: 5,
          damageMax: 14,
          crit_base: 19,
          crit_effect: { kind: 'DAMAGE', element: 'fire', damageMin: 15, damageMax: 24 },
          chance: 100,
          turns: 2,
        },
        { kind: 'REDUCE_DAMAGE', base: 8, chance: 100, turns: 2 },
        { kind: 'GIVE_POINTS', stat: 1, base: 1, chance: 100, turns: 1 },
      ],
    },
  ],
}

const BAR_SPELL = {
  id: 'test_ember_ward',
  classType: 'senshi',
  unlock: 1,
  name: 'Ember Ward',
  role: 'damage',
  element: 'fire',
  object_id: '0xabc',
  levels: [],
}

const seed_spell_bar = () => {
  set_spell_corpus_for_test([BAR_SPELL])
  const store = seed_fight_core({ fight_id: 'hover-card-test', my: '0xme', active: '0xme' })
  store.getState().input({ type: 'hand_update', hand: ['ember_ward'] })
  return store
}

const render_spell_bar = () =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: EN_I18N }, createElement(DeckCluster)))

afterEach(() => {
  reset_fight_core()
  set_spell_corpus_for_test()
})

describe('spell_hover_facts', () => {
  test('derives the deleted readout data from the seeded spell SSOT', () => {
    const facts = spell_hover_facts(t, SPELL)

    expect(facts.ap).toBe(3)
    expect(facts.range_txt).toBe('1-5')
    expect(facts.crit_txt).toBe('1 / 4')
    expect(facts.cooldown_txt).toBe('2 turns')
    expect(facts.subline).toBe('Fire · Damage')
    expect(facts.effects.map((effect) => effect.text)).toEqual([
      '5 to 14 Fire damage · 2 turns · crit 15 to 24',
      'Absorbs 8 damage · any element · 2 turns',
      '+1 MP · 1 turn',
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
    expect(facts.subline).toBe(en.spells.utility)
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
    expect(text).toContain('5 to 14 Fire damage · 2 turns · crit 15 to 24')
    expect(text).toContain('Absorbs 8 damage · any element · 2 turns')
    expect(text).toContain('+1 MP · 1 turn')
    expect(html).not.toContain('tt-spell-card__aim')
  })

  test('uses the sharp near-black FightReport shell, gold name, and tracked 10px micro-labels', () => {
    const css = readFileSync(new URL('./tooltip.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*background:\s*#07080c/s)
    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*border:\s*1px solid rgba\(255, 255, 255, 0\.1\)/s)
    expect(css).toMatch(/\.tt-card\.tt-card--spell\s*\{[^}]*border-radius:\s*0/s)
    expect(css).toMatch(/\.tt-spell-card__name\s*\{[^}]*color:\s*#c8963c/s)
    expect(css).toMatch(/\.tt-spell-card__label,[^}]*font-size:\s*10px[^}]*letter-spacing:\s*0\.14em/s)
  })

  // #368 RED-FIRST: the greyed cooldown affordance must refuse a cast attempt WITH THE REASON at hover
  // (silent-refusal law) — same idiom as the equip fix's hover/disabled reason, adapted to this bar's rich
  // Tooltip (the house's ONE replacement for native title=, Tooltip.jsx header) instead of a native title=.
  test('cd_left > 0 surfaces the on-cooldown reason, reusing the toast copy — absent when not on cooldown', () => {
    const on_cd = renderToStaticMarkup(
      createElement(SpellHoverTip, { t, name: 'Ember Ward', spell: SPELL, cd_left: 2 })
    )
    expect(on_cd).toContain('tt-spell-card__reason')
    expect(visible_text(on_cd)).toContain(t('dungeons.spell_on_cooldown', { n: 2 }))

    const ready = renderToStaticMarkup(createElement(SpellHoverTip, { t, name: 'Ember Ward', spell: SPELL }))
    expect(ready).not.toContain('tt-spell-card__reason')
  })
})

test('selecting a spell without pointer hover does not mount its hover card', () => {
  const store = seed_spell_bar()
  store.getState().input({ type: 'arm', spell_id: 'ember_ward' })
  expect(store.getState().armed_spell_id).toBe('ember_ward')
  const html = render_spell_bar()

  expect(html).not.toContain('role="tooltip"')
  expect(html).not.toContain('tt-spell-card')
})

test('pointer hover alone mounts the card until leave, including while the spell is selected', () => {
  const store = seed_spell_bar()

  // These are the exact reducer inputs emitted by SpellSocket's existing onPointerEnter/onPointerLeave handlers.
  store.getState().input({ type: 'hover_spell', spell_id: 'ember_ward' })
  const hovered = render_spell_bar()
  expect(hovered).toContain('role="tooltip"')
  expect(hovered).toContain('tt-spell-card')

  store.getState().input({ type: 'arm', spell_id: 'ember_ward' })
  expect(store.getState().armed_spell_id).toBe('ember_ward')
  const selected_while_hovered = render_spell_bar()
  expect(selected_while_hovered).toContain('role="tooltip"')
  expect(selected_while_hovered).not.toContain('tt-spell-card__aim')

  store.getState().input({ type: 'hover_spell', spell_id: null })
  const left_while_selected = render_spell_bar()
  expect(left_while_selected).not.toContain('role="tooltip"')
  expect(left_while_selected).not.toContain('tt-spell-card')
})
