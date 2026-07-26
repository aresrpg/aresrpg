// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import { spell_hover_facts } from '../src/game/screens/hud/spell-hover-tip.jsx'
import en from '../src/i18n/locales/en.json'
import { SpellDetail } from '../src/pages/encyclopedia/classes_tab'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const t = i18n.t.bind(i18n)
const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

const damage_effect = {
  kind: 'DAMAGE',
  element: 'fire',
  damageMin: 6,
  damageMax: 10,
  crit_base: 18,
  crit_effect: {
    kind: 'DAMAGE',
    element: 'fire',
    damageMin: 16,
    damageMax: 18,
  },
  chance: 100,
}

const level_with = (crit_rate: number | null) => ({
  ap: 4,
  range: [1, 3],
  cooldown: 0,
  crit_rate,
  casts_per_turn: 1,
  casts_per_target: 1,
  modifiable_range: false,
  line_of_sight: true,
  linear: false,
  free_cell: false,
  effects: [damage_effect],
  crit_effects: [damage_effect.crit_effect],
})

const encyclopedia_text = (crit_rate: number | null) =>
  visible_text(
    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SpellDetail
          spell={{
            name: 'Critical Fixture',
            name_key: 'critical_fixture',
            unlock_level: 1,
            levels: [level_with(crit_rate)],
          }}
        />
      </I18nextProvider>
    )
  )

describe('#1051 critical tooltip clauses', () => {
  test.each([0, null])('suppresses impossible critical damage when crit_rate is %p', (crit_rate) => {
    const hover_text = spell_hover_facts(t, {
      kind: 'dmg',
      levels: [level_with(crit_rate)],
    }).effects[0].text

    expect(hover_text).toContain('6 to 10 Fire damage')
    expect(hover_text).not.toContain('crit 16 to 18')
    expect(encyclopedia_text(crit_rate)).not.toContain('crit 16 to 18')
  })

  test('keeps critical damage when the level has a real critical rate', () => {
    const hover_text = spell_hover_facts(t, {
      kind: 'dmg',
      levels: [level_with(45)],
    }).effects[0].text

    expect(hover_text).toContain('crit 16 to 18')
    expect(encyclopedia_text(45)).toContain('crit 16 to 18')
  })
})
