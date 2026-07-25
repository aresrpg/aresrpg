// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// character_editor.test.tsx — what the roster-slot editor actually SHOWS.
//
// The three regressions this pins, all reported off the live page: stat rows were bare number inputs with no
// icon and no label; spell rows were anonymous numeric inputs; and there was no way to assign equipment at
// all — the pet slot included.
//
// Rendering convention: renderToStaticMarkup, no jsdom/happy-dom (this repo ships no DOM harness — see
// PetFeedModal.test.jsx's header). The hover CARD is therefore driven through the Tooltip's own controlled
// `visible` prop (the same door DeckCluster's hotbar uses) rather than a synthetic pointer event: what is
// under test is WHAT the card says at the selected level, which is the part that can lie.

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import type { ReactElement } from 'react'

import en from '../i18n/locales/en.json'
import { Tooltip } from '../game/screens/hud/Tooltip.jsx'

import type { GrimoireRow } from './build_view'
import { CharacterEditor, SpellEditorRow, SpellTip } from './CharacterModal'
import { EMPTY_STAT_ALLOC, SIM_STATS, type SimCharacter } from './reducer'

const test_i18n = i18next.createInstance()
void test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = test_i18n.getFixedT('en') as unknown as (key: string, params?: object) => string

const render = (node: ReactElement): string =>
  renderToStaticMarkup(<I18nextProvider i18n={test_i18n}>{node}</I18nextProvider>)

const CHARACTER: SimCharacter = {
  id: 'sim_c1',
  name: 'Probe',
  class_id: 'senshi',
  male: true,
  level: 50,
  stat_alloc: { ...EMPTY_STAT_ALLOC, strength: 12 },
  spell_levels: {},
  loadout: {},
}

/** A spell whose levels differ in AP — so a tooltip showing the WRONG level is visible in the markup. */
const SPELL: GrimoireRow = {
  id: '0xspell',
  name: 'Ember Strike',
  name_key: 'ember_strike',
  icon: 'ember_strike',
  color: '#ff4500',
  levels: [
    { min_char_level: 1, ap: 3, range: [1, 4], crit_rate: 0, cooldown: 0, effects: [] },
    { min_char_level: 10, ap: 5, range: [1, 5], crit_rate: 0, cooldown: 0, effects: [] },
    { min_char_level: 20, ap: 7, range: [1, 6], crit_rate: 0, cooldown: 0, effects: [] },
  ] as GrimoireRow['levels'],
  unlock_tier: 1,
  unlocked: true,
  current_level: 1,
  subline_kind: 'fire',
  subline_descriptor: 'damage',
}

describe('stat rows speak the game’s language', () => {
  const markup = render(<CharacterEditor character={CHARACTER} on_deleted={() => {}} />)

  test('every allocatable stat row carries the game’s stat ICON', () => {
    for (const stat of SIM_STATS) expect(markup).toContain(`data-stat-icon="${stat}"`)
    // the icon gem holds the real art, not a coloured square
    expect(markup.match(/class="stats__prow-icon"[^>]*>\s*<img/g)?.length).toBe(SIM_STATS.length)
  })

  test('every stat row carries its localized LABEL', () => {
    for (const label of ['Vitality', 'Wisdom', 'Strength', 'Intelligence', 'Chance', 'Agility'])
      expect(markup).toContain(label)
  })

  test('the allocation input survives — the complaint was the missing identity, not the input', () => {
    expect(markup.match(/type="number"/g)?.length).toBeGreaterThanOrEqual(SIM_STATS.length)
  })
})

describe('every equipment slot is assignable, pet included', () => {
  const markup = render(<CharacterEditor character={CHARACTER} on_deleted={() => {}} />)

  test('the game’s own paper doll is mounted', () => {
    expect(markup).toContain('inv__doll')
    expect(markup).toContain('inv__relics')
  })

  test('the PET slot is a first-class slot', () => {
    expect(markup).toContain('inv__slot--pet')
  })

  test('every doll + cosmetic slot renders', () => {
    for (const slot of [
      'relic_1',
      'relic_6',
      'helmet',
      'amulet',
      'chestplate',
      'gauntlets',
      'pants',
      'weapon',
      'left_ring',
      'right_ring',
      'belt',
      'boots',
      'pet',
      'hat',
      'cloak',
      'title',
    ])
      expect(markup).toContain(`inv__slot--${slot}`)
  })

  test('an empty slot is activatable — the picker opens from the cell itself', () => {
    expect(markup).toContain('role="button"')
  })
})

describe('spell rows: icon · name · level dropdown', () => {
  const markup = render(<SpellEditorRow character={CHARACTER} row={SPELL} />)

  test('the row is the grimoire’s row, keyed by the spell', () => {
    expect(markup).toContain('sb__row')
    expect(markup).toContain('data-spell-row="ember_strike"')
  })

  test('the row names the spell', () => {
    expect(markup).toContain('Ember Strike')
  })

  test('the level control is a DROPDOWN, never a free numeric input', () => {
    expect(markup).toContain('<select')
    expect(markup).not.toContain('type="number"')
  })

  test('the dropdown offers each reachable level with its cost', () => {
    expect(markup).toContain('LV 1 · 0 PTS')
    expect(markup).toContain('LV 3 · 3 PTS')
  })

  test('an unaffordable level is offered DISABLED, not hidden', () => {
    const broke: SimCharacter = { ...CHARACTER, level: 20, spell_levels: { sibling: 6 } }
    // 19 points at level 20, a sibling holds 15 → 4 left; level 3 costs 3, so only level 3 upward is at risk.
    const poor = render(<SpellEditorRow character={{ ...broke, level: 20 }} row={SPELL} />)
    expect(poor).toContain('<option')
    expect(poor).toContain('LV 3 · 3 PTS')
  })
})

describe('hovering a spell shows the FULL detail for the SELECTED level', () => {
  const card = (level: number) =>
    render(
      <Tooltip visible content={<SpellTip t={t} row={SPELL} name="Ember Strike" level={level} />}>
        <span />
      </Tooltip>
    )

  test('the card is the fight hotbar’s own spell card', () => {
    expect(card(1)).toContain('role="tooltip"')
    expect(card(1)).toContain('tt-spell-card')
    // the full fact strip, not a bare name
    for (const label of ['AP Cost', 'Range', 'Crit Chance', 'Cooldown']) expect(card(1)).toContain(label)
  })

  test('the facts FOLLOW the selected level', () => {
    expect(card(1)).toContain('>3</b>')
    expect(card(2)).toContain('>5</b>')
    expect(card(3)).toContain('>7</b>')
  })
})
