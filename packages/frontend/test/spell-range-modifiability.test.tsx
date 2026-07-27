// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A spell's range is two facts, never one: the authored min–max AND whether the +range stat extends it
// (SpellLevel.modifiable_range, spell_effect.move). Shipping only the first left a FIXED-range spell
// indistinguishable from a modifiable one — the encyclopedia printed "+RANGE STAT EXTENDS THIS" for the
// modifiable case and NOTHING for the fixed case, so a silent chip could equally mean "fixed" or "the UI
// forgot". This pins the verdict on every surface that prints a range, out of the one caption home
// (spell-range-caption.js), in all six locales.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import { SpellHoverTip, spell_hover_facts } from '../src/game/screens/hud/spell-hover-tip.jsx'
import { spell_range_caption_key } from '../src/game/screens/hud/spell-range-caption.js'
import en from '../src/i18n/locales/en.json'
import { SpellDetail } from '../src/pages/encyclopedia/classes_tab'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = i18n.t.bind(i18n)

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const CAPTION_KEYS = ['range_self_cast', 'range_extendable', 'range_fixed']

const level_with = (overrides: Record<string, unknown> = {}) => ({
  min_char_level: 1,
  ap: 4,
  range: [1, 3],
  modifiable_range: false,
  line_of_sight: true,
  linear: false,
  free_cell: false,
  casts_per_turn: 1,
  casts_per_target: 1,
  cooldown: 0,
  crit_rate: 0,
  effects: [] as unknown[],
  crit_effects: [] as unknown[],
  ...overrides,
})

const encyclopedia_html = (level: Record<string, unknown>) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SpellDetail
        spell={{
          name: 'Range Fixture',
          name_key: 'range_fixture',
          unlock_level: 1,
          levels: [level],
        }}
      />
    </I18nextProvider>
  )

const hover_caption = (level: Record<string, unknown>) =>
  spell_hover_facts(t, { kind: 'dmg', levels: [level] }, null).range_caption

describe('spell range modifiability — one caption home', () => {
  test('the caption key is a total verdict over the three range shapes', () => {
    expect(spell_range_caption_key(level_with({ modifiable_range: false }))).toBe('spells.range_fixed')
    expect(spell_range_caption_key(level_with({ modifiable_range: true }))).toBe('spells.range_extendable')
    expect(spell_range_caption_key(level_with({ range: [0, 0], modifiable_range: true }))).toBe(
      'spells.range_self_cast'
    )
    // A level whose flag never arrived is FIXED, never silent — the chain default is false.
    expect(spell_range_caption_key(level_with({ modifiable_range: undefined }))).toBe('spells.range_fixed')
  })

  test('the encyclopedia spell page states a FIXED range instead of saying nothing', () => {
    const html = encyclopedia_html(level_with({ modifiable_range: false }))

    expect(html).toContain('data-stat-chip="range"')
    expect(html).toContain(en.spells.range_fixed)
    expect(html).not.toContain(en.spells.range_extendable)
  })

  test('the encyclopedia spell page keeps the extendable caption for a modifiable range', () => {
    const html = encyclopedia_html(level_with({ modifiable_range: true }))

    expect(html).toContain(en.spells.range_extendable)
    expect(html).not.toContain(en.spells.range_fixed)
  })

  test('a self-cast range says self-cast on both surfaces, never a boost verdict', () => {
    const self_cast = level_with({ range: [0, 0], modifiable_range: false })

    expect(encyclopedia_html(self_cast)).toContain(en.spells.range_self_cast)
    expect(hover_caption(self_cast)).toBe(en.spells.range_self_cast)
  })

  test('the fight hover card carries the same verdict as the encyclopedia', () => {
    expect(hover_caption(level_with({ modifiable_range: false }))).toBe(en.spells.range_fixed)
    expect(hover_caption(level_with({ modifiable_range: true }))).toBe(en.spells.range_extendable)
  })

  test('the hover card renders the caption it computed', () => {
    const html = renderToStaticMarkup(
      <SpellHoverTip
        t={t}
        name="Range Fixture"
        spell={{ kind: 'dmg', levels: [level_with({ modifiable_range: false })] }}
      />
    )
    expect(html).toContain(en.spells.range_fixed)
  })

  test('the grimoire detail reads the caption from the one home, not a local yes/no of its own', () => {
    const source = readFileSync(new URL('../src/game/screens/hud/Spellbook.jsx', import.meta.url), 'utf8')

    expect(source).toContain("from './spell-range-caption.js'")
    expect(source).toContain('spell_range_caption_key(sl)')
    // The old second implementation — a detached "Modifiable Range: Yes/No" row — is gone.
    expect(source).not.toContain('spells.modifiable_range')
  })

  test.each(LOCALES)('%s.json carries every non-empty range caption', async (lang) => {
    const json = await Bun.file(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url)).json()
    for (const key of CAPTION_KEYS) {
      expect(typeof json?.spells?.[key]).toBe('string')
      expect(json.spells[key].trim().length).toBeGreaterThan(0)
    }
    // The captions moved to `spells` wholesale — no stale encyclopedia copy left to drift from them.
    expect(json?.encyclopedia?.range_extendable).toBeUndefined()
    expect(json?.encyclopedia?.self_cast).toBeUndefined()
  })
})
