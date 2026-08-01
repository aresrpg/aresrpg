// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { spell_effect_sentence, spell_effect_sentence_templates } from '../src/game/screens/hud/seed-effect-line.js'
import de from '../src/i18n/locales/de.json'
import en from '../src/i18n/locales/en.json'
import es from '../src/i18n/locales/es.json'
import fr from '../src/i18n/locales/fr.json'
import ja from '../src/i18n/locales/ja.json'
import uk from '../src/i18n/locales/uk.json'

// SPELL_TEXT_CONTRACT.md @ 3eb716d — kind and line count are both pinned so this remains the census tooth.
const effect_kind_census = [
  [0, 1261],
  [9, 528],
  [11, 324],
  [7, 294],
  [6, 267],
  [5, 214],
  [2, 144],
  [22, 138],
  [12, 102],
  [24, 78],
  [21, 78],
  [10, 72],
  [20, 48],
  [8, 42],
  [19, 42],
  [1, 36],
  [25, 36],
  [14, 36],
  [4, 24],
  [3, 18],
  [13, 18],
  [26, 12],
  [28, 12],
  [27, 12],
  [16, 6],
  [17, 6],
  [29, 6],
  [15, 6],
] as const

const locale_rows = [
  ['de', de],
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['ja', ja],
  ['uk', uk],
] as const

const translator_for = (locale: string, resources: object) => {
  const i18n = i18next.createInstance()
  i18n.init({
    lng: locale,
    resources: { [locale]: { translation: resources } },
    interpolation: { escapeValue: false },
  })
  return i18n.t.bind(i18n)
}

const sample_effect = (kind: number) => ({
  kind,
  element: 0,
  stat: 0,
  value: kind === 22 ? 788 : 37,
})

const resolve_state_name = (state_reference: number | string | undefined) =>
  state_reference === 788 ? 'Blood Toll' : null

describe('#1439 spell effect sentence census', () => {
  test('the template vocabulary covers exactly all twenty-eight kinds in live use', () => {
    const census_kinds = effect_kind_census.map(([kind]) => kind).sort((a, b) => a - b)
    const template_kinds = Object.keys(spell_effect_sentence_templates)
      .map(Number)
      .sort((a, b) => a - b)

    expect(effect_kind_census).toHaveLength(28)
    expect(effect_kind_census.reduce((sum, [, count]) => sum + count, 0)).toBe(3860)
    expect(template_kinds).toEqual(census_kinds)
  })

  test.each(locale_rows)('%s renders every census kind as one plain sentence', (locale, resources) => {
    const t = translator_for(locale, resources)

    for (const [kind] of effect_kind_census) {
      const sentence = spell_effect_sentence(t, sample_effect(kind), { resolve_state_name })
      expect(sentence).not.toMatch(/[0-9]/u)
      expect(sentence).not.toMatch(/[\r\n_]|\{\{|\}\}/u)
      expect(sentence.match(/[.!?。！？]/gu)).toHaveLength(1)
      expect(sentence).toMatch(/[.!?。！？]$/u)
    }
  })

  test('unknown kinds and unresolved state references fail without echoing wire values', () => {
    const t = translator_for('en', en)

    expect(() => spell_effect_sentence(t, { kind: 1439 })).toThrow('Spell effect sentence template is unavailable.')
    expect(() => spell_effect_sentence(t, { kind: 22, value: 788 })).toThrow('Spell state name is unavailable.')
    expect(() => spell_effect_sentence(t, { kind: 22, value: 788 }, { resolve_state_name: () => 'State 788' })).toThrow(
      'Spell state name is unavailable.'
    )

    for (const callback of [
      () => spell_effect_sentence(t, { kind: 1439 }),
      () => spell_effect_sentence(t, { kind: 22, value: 788 }),
    ]) {
      try {
        callback()
      } catch (error) {
        expect(String(error)).not.toMatch(/1439|788/)
      }
    }
  })
})

// Test-only copies of the six landed EN seed rows named by the contract. Descriptions remain seed-owned;
// these golden fixtures pin their exact voice while driving the representative L1 effect shapes.
const golden_exemplars = [
  {
    id: 'senshi_fates_edge',
    description: 'One clean stroke, drawn while the opponent is still deciding — the scar arrives before the sound.',
    effects: [{ kind: 0, element: 0, value: 8 }],
  },
  {
    id: 'ikari_blood_toll',
    description: 'The rage does not ask permission. Every cast from here on is paid in your own blood.',
    effects: [{ kind: 22, value: 788 }],
  },
  {
    id: 'tomoda_boar_aspect',
    description: 'Wear the boar. Nothing about you gets smarter — everything about you gets harder to stop.',
    effects: [{ kind: 9, stat: 1, value: 10 }],
  },
  {
    id: 'senshi_oathblade',
    description: 'An oath cuts both ways: the blade bites deeper, and the hand that swears it steadies.',
    effects: [
      { kind: 0, element: 3, value: 10 },
      { kind: 9, stat: 9, value: 1 },
    ],
  },
  {
    id: 'senshi_vault',
    description: 'The ground is a suggestion. Arrive where the fight pretends you cannot.',
    effects: [{ kind: 14, value: 2 }],
  },
  {
    id: 'iyashi_mending_word',
    description: 'Not mercy — maintenance. The line holds because you hold it.',
    effects: [{ kind: 5, element: 1, value: 8 }],
  },
] as const

describe('#1439 six contract voice exemplars', () => {
  test('the landed EN rows render their representative effect sentences', () => {
    const t = translator_for('en', en)
    const rendered = golden_exemplars.map(({ id, description, effects }) => ({
      id,
      description,
      sentences: effects.map((effect) => spell_effect_sentence(t, effect, { resolve_state_name })),
    }))

    expect(rendered).toEqual([
      {
        id: 'senshi_fates_edge',
        description:
          'One clean stroke, drawn while the opponent is still deciding — the scar arrives before the sound.',
        sentences: ['Deals Fire damage.'],
      },
      {
        id: 'ikari_blood_toll',
        description: 'The rage does not ask permission. Every cast from here on is paid in your own blood.',
        sentences: ['Applies Blood Toll.'],
      },
      {
        id: 'tomoda_boar_aspect',
        description: 'Wear the boar. Nothing about you gets smarter — everything about you gets harder to stop.',
        sentences: ['Modifies Intelligence.'],
      },
      {
        id: 'senshi_oathblade',
        description: 'An oath cuts both ways: the blade bites deeper, and the hand that swears it steadies.',
        sentences: ['Deals Air damage.', 'Modifies Raw Damage.'],
      },
      {
        id: 'senshi_vault',
        description: 'The ground is a suggestion. Arrive where the fight pretends you cannot.',
        sentences: ['Teleports the caster to the target cell.'],
      },
      {
        id: 'iyashi_mending_word',
        description: 'Not mercy — maintenance. The line holds because you hold it.',
        sentences: ['Restores health.'],
      },
    ])
  })
})
