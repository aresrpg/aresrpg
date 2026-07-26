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

const t = (key: string) =>
  key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return key
    return (value as Record<string, unknown>)[part] ?? key
  }, en) as string

const base_level = {
  ap: 4,
  range: [1, 3],
  cooldown: 0,
  crit_rate: 0,
  casts_per_turn: 1,
  casts_per_target: 1,
  modifiable_range: false,
  line_of_sight: true,
  linear: false,
  free_cell: false,
  effects: [] as Record<string, unknown>[],
  crit_effects: [] as Record<string, unknown>[],
}

describe('#1046 spell tooltip categories', () => {
  test('derives element and family labels from the selected level effects', () => {
    const category_for = (effects: Record<string, unknown>[]) => {
      const { subline, color } = spell_hover_facts(t, {
        kind: 'dmg',
        levels: [{ ...base_level, effects }],
      })
      return { subline, color }
    }

    expect([
      category_for([{ kind: 'DAMAGE', element: 'fire' }]),
      category_for([{ kind: 'HEAL', element: 'water' }]),
      category_for([{ kind: 'ALTER_STAT', element: 'neutral', target_filter: 32 }]),
      category_for([{ kind: 'TELEPORT', element: 'neutral' }]),
      category_for([{ kind: 'PLACE_TRAP', element: 'neutral' }]),
      category_for([
        { kind: 'PLACE_TRAP', element: 'neutral' },
        { kind: 'DAMAGE', element: 'earth' },
      ]),
    ]).toEqual([
      { subline: 'Fire · Damage', color: '#e0664a' },
      { subline: 'Water · Heal', color: '#6fa8d4' },
      { subline: 'Buff', color: '#b07cff' },
      { subline: 'Utility', color: 'var(--color-gold)' },
      { subline: 'Utility', color: 'var(--color-gold)' },
      { subline: 'Earth · Damage', color: '#c2a05e' },
    ])
  })

  test('encyclopedia chip ignores stale spell metadata', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SpellDetail
          spell={{
            name: 'Blink Fixture',
            name_key: 'blink_fixture',
            unlock_level: 1,
            element: 'air',
            levels: [
              {
                ...base_level,
                effects: [{ kind: 'TELEPORT', element: 'neutral', chance: 100, turns: 0 }],
              },
            ],
          }}
        />
      </I18nextProvider>
    )

    expect(html).toContain('data-spell-category="utility"')
    expect(html).toContain('style="color:var(--color-gold)"')
    expect(html).toContain('Utility')
    expect(html).not.toContain('>Air<')
  })
})
