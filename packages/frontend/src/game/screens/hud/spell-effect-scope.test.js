// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import DE from '../../../i18n/locales/de.json' with { type: 'json' }
import EN from '../../../i18n/locales/en.json' with { type: 'json' }
import ES from '../../../i18n/locales/es.json' with { type: 'json' }
import FR from '../../../i18n/locales/fr.json' with { type: 'json' }
import JA from '../../../i18n/locales/ja.json' with { type: 'json' }
import UK from '../../../i18n/locales/uk.json' with { type: 'json' }
import { SPELLS_SEED_AVAILABLE } from '../../../test_helpers/spells_fixture.js'
import { fight_spells_data } from './fight-spells.js'
import { seed_effect_line, seed_effect_parts } from './seed-effect-line.js'

const lookup = (locale, key) => key.split('.').reduce((value, part) => (value == null ? value : value[part]), locale)
const translator =
  (locale) =>
  (key, params = {}) => {
    let text =
      params.count != null
        ? (lookup(locale, `${key}_${params.count === 1 ? 'one' : 'other'}`) ?? lookup(locale, key))
        : lookup(locale, key)
    if (typeof text !== 'string') return key
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{{${name}}}`, String(value))
    return text
  }
const t_en = translator(EN)

describe('REDUCE_DAMAGE line states its element scope', () => {
  const absorb = { kind: 'REDUCE_DAMAGE', base: 73, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 }

  test('the English line honestly says the shield absorbs any element', () => {
    expect(seed_effect_line(t_en, absorb)).toBe('Absorbs 73 damage · any element · 2 turns')
  })

  test('all 6 locales resolve their natural any-element copy', () => {
    for (const locale of [EN, FR, DE, ES, JA, UK]) {
      const t = translator(locale)
      const line = seed_effect_line(t, absorb)
      expect(line).toContain(t('spells.fx_any_element'))
      expect(line).not.toContain('spells.')
      expect(line).not.toContain('{{')
    }
  })
})

// ALTER_RESIST is intentionally adjacent: unlike element-less absorb shields, resist rows scope to the
// element they carry. Together these tests pin both sides of the player-facing element-scope grammar.
describe('ALTER_RESIST line names the element', () => {
  const resist = (overrides) => ({
    kind: 'ALTER_RESIST',
    base: 8,
    chance: 100,
    turns: 4,
    area_shape: 'POINT',
    area_size: 0,
    ...overrides,
  })

  test('an element-carrying resist row renders the element name, sign in the grey pre', () => {
    expect(seed_effect_line(t_en, resist({ element: 'earth' }))).toBe('+8 Earth resistance · 4 turns')
    expect(seed_effect_line(t_en, resist({ element: 'fire', base: -12, turns: 2 }))).toBe(
      '-12 Fire resistance · 2 turns'
    )
    const parts = seed_effect_parts(t_en, resist({ element: 'water' }))
    expect(parts.pre.endsWith('+')).toBe(true)
    expect(parts.value).toBe('8')
    expect(parts.post).toContain('Water')
  })

  test('legacy element-less and neutral rows stay honestly bare', () => {
    expect(seed_effect_line(t_en, resist({ turns: 0 }))).toBe('+8 resistance')
    const neutral_line = seed_effect_line(t_en, resist({ element: 'neutral', turns: 0 }))
    expect(neutral_line).toBe('+8 resistance')
    expect(neutral_line).not.toContain('neutral')
  })

  test('all 6 locales resolve the element-carrying resist template', () => {
    for (const locale of [EN, FR, DE, ES, JA, UK]) {
      const line = seed_effect_line(translator(locale), resist({ element: 'earth' }))
      expect(line).not.toContain('spells.')
      expect(line).not.toContain('{{')
    }
  })

  test.skipIf(!SPELLS_SEED_AVAILABLE)('the live corpus resist rows all render a named element', () => {
    const elements = ['Fire', 'Water', 'Earth', 'Air']
    const lines = fight_spells_data.spells.flatMap((spell) =>
      spell.levels.flatMap((level) =>
        (level.effects ?? [])
          .filter((effect) => effect.kind === 'ALTER_RESIST')
          .map((effect) => seed_effect_line(t_en, effect))
      )
    )
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(elements.some((element) => line.includes(element))).toBe(true)
  })
})
