// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1088: every grimoire/detail surface starts from the seat's learned spell rank.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../../../src/i18n/locales/en.json'
import { set_spell_corpus_for_test } from '../../../../src/game/data/spell_corpus.js'
import { fight_spell } from '../../../../src/game/screens/hud/fight-spells.js'
import { spell_hover_facts } from '../../../../src/game/screens/hud/spell-hover-tip.jsx'
import { grimoire } from '../../../../src/game/screens/hud/spellbook-data.js'
import { SpellDetail } from '../../../../src/pages/encyclopedia/classes_tab'

const spell_object_id = '0xlearned_rank_fixture'
const spell_key = 'learned_rank_fixture'
const seat = { spell_levels: { [spell_object_id]: 2 } }
const level = (overrides: Record<string, unknown>) => ({
  min_char_level: 1,
  ap_cost: 2,
  range_min: 0,
  range_max: 0,
  modifiable_range: false,
  line_of_sight: true,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: [{ kind: 6, value: 1, target_filter: 32, chance: 100 }],
  crit_effects: [],
  ...overrides,
})
const corpus_row = {
  id: 'senshi_learned_rank_fixture',
  object_id: spell_object_id,
  name: 'Learned Rank Fixture',
  classType: 'senshi',
  unlock: 1,
  role: 'damage',
  element: 'fire',
  levels: [
    level({}),
    level({
      min_char_level: 20,
      ap_cost: 5,
      range_min: 1,
      range_max: 8,
      effects: [{ kind: 0, element: 0, value: 22, target_filter: 2, chance: 100 }],
    }),
  ],
}

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = test_i18n.t.bind(test_i18n)

beforeAll(() => set_spell_corpus_for_test([corpus_row]))
afterAll(() => set_spell_corpus_for_test())

describe("the seat's learned spell rank", () => {
  test('drives hotbar detail facts', () => {
    const facts = spell_hover_facts(t, fight_spell(spell_key), seat)

    expect(facts.ap).toBe(5)
    expect(facts.range_txt).toBe('1-8')
    expect(facts.subline).toBe('Fire · Damage')
  })

  test('drives spellbook row category and targeting descriptor', () => {
    const [row] = grimoire('senshi', 20, 0, seat.spell_levels).rows

    expect(row.current_level).toBe(2)
    expect(row.subline_kind).toBe('fire')
    expect(row.subline_descriptor).toBe('ranged')
  })

  test('opens encyclopedia detail on the learned level', () => {
    const spell = fight_spell(spell_key)
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <SpellDetail spell={spell} seat={seat} />
      </I18nextProvider>
    )

    expect(markup).toContain('1–8')
    expect(markup).toMatch(/bg-gold\/20[^>]*>2<\/div>/)
    expect(markup).toContain('data-spell-category="fire"')
  })
})
