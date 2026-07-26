// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { project_spell_level } from '../src/game/screens/hud/fight-spells-core.js'
import { spell_hover_facts } from '../src/game/screens/hud/spell-hover-tip.jsx'
import en from '../src/i18n/locales/en.json'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = i18n.t.bind(i18n)

const level_with = (crit_rate: number) => ({
  ap_cost: 4,
  range_min: 1,
  range_max: 1,
  crit_rate,
  effects: [
    {
      kind: 0,
      element: 2,
      value: 13,
      value_max: 25,
      target_filter: 1,
      chance: 100,
      turns: 0,
    },
  ],
  crit_effects: [
    {
      kind: 7,
      element: 255,
      value: 1,
      value_max: 1,
      target_filter: 1,
      chance: 100,
      turns: 3,
      stat: 0,
    },
    {
      kind: 0,
      element: 2,
      value: 13,
      value_max: 25,
      target_filter: 1,
      chance: 100,
      turns: 0,
    },
  ],
})

const tooltip_lines = (crit_rate: number) =>
  spell_hover_facts(t, { levels: [project_spell_level(level_with(crit_rate))] }).effects.map((effect) => effect.text)

describe('#1088 critical-only tooltip effects', () => {
  test('renders an unmatched critical effect as an ordinary sibling row', () => {
    const lines = tooltip_lines(50)

    expect(lines).toEqual(['13 to 25 Earth damage · crit 13 to 25', '-1 AP · 3 turns'])
    expect(lines.join(' ')).not.toContain('ON CRITICAL')
  })

  test('does not render the critical-only row when the level cannot crit', () => {
    expect(tooltip_lines(0)).toEqual(['13 to 25 Earth damage'])
  })
})
