// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'
import fr from '../../i18n/locales/fr.json'
import { project_spell_effect } from '../../game/screens/hud/fight-spells-core.js'

import { SpellDetail } from './classes_tab'

const EN_I18N = i18next.createInstance()
EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const FR_I18N = i18next.createInstance()
FR_I18N.init({
  lng: 'fr',
  resources: { fr: { translation: fr } },
  interpolation: { escapeValue: false },
})

const BASE_LEVEL = {
  min_char_level: 1,
  ap: 5,
  range: [1, 4],
  modifiable_range: false,
  line_of_sight: false,
  linear: false,
  free_cell: false,
  casts_per_turn: 2,
  casts_per_target: 1,
  cooldown: 0,
  crit_rate: 0,
  effects: [] as any[],
  crit_effects: [] as any[],
}

const level_fixture = (overrides: Record<string, unknown> = {}) => ({ ...BASE_LEVEL, ...overrides })

const render_spell = (level: Record<string, unknown>, locale: 'en' | 'fr' = 'en') =>
  renderToStaticMarkup(
    <I18nextProvider i18n={locale === 'fr' ? FR_I18N : EN_I18N}>
      <SpellDetail
        spell={{
          name: 'Display Fixture',
          name_key: 'display_fixture',
          unlock_level: 1,
          element: 'air',
          levels: [level],
        }}
      />
    </I18nextProvider>
  )

const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('SpellDetail damage magnitudes', () => {
  const ranged_damage = level_fixture({
    crit_rate: 40,
    effects: [
      {
        kind: 'DAMAGE',
        element: 'air',
        value: 991,
        base: 991,
        damageMin: 5,
        damageMax: 14,
        crit_base: 19,
        crit_effect: { kind: 'DAMAGE', element: 'air', damageMin: 15, damageMax: 24 },
        chance: 100,
        turns: 2,
      },
    ],
  })

  test('renders authoritative normal and critical ranges plus duration, never legacy midpoints', () => {
    const html = render_spell(ranged_damage)
    const text = visible_text(html)

    expect(text).toContain('5 to 14 Air damage')
    expect(text).toContain('2 turns')
    expect(text).toContain('crit 15 to 24')
    expect(text).not.toContain('crit 19')
    expect(text).not.toContain('991')
  })

  test('localizes an unequal range connector', () => {
    const text = visible_text(render_spell(ranged_damage, 'fr'))
    expect(text).toContain('5 à 14 dégâts Air')
    expect(text).toContain('crit 15 à 24')
  })

  test('renders equal normal bounds as one number', () => {
    const html = render_spell(
      level_fixture({
        effects: [{ kind: 'DAMAGE', element: 'air', base: 404, damageMin: 8, damageMax: 8, chance: 100 }],
      })
    )
    const text = visible_text(html)

    expect(text).toContain('8 Air damage')
    expect(text).not.toContain('8 to 8')
    expect(text).not.toContain('404')
  })

  test('never falls back to legacy midpoint fields when damage bounds are missing', () => {
    const text = visible_text(
      render_spell(
        level_fixture({
          crit_rate: 40,
          effects: [{ kind: 'DAMAGE', element: 'air', value: 10, base: 10, crit_base: 15, chance: 100 }],
        })
      )
    )

    expect(text).toContain('— Air damage')
    expect(text).not.toContain('10 Air damage')
    expect(text).not.toContain('crit 15')
  })
})

describe('SpellDetail targeting relevance', () => {
  test('range 0-0 identifies self-cast and mutes only the three meaningless targeting facts', () => {
    const html = render_spell(level_fixture({ range: [0, 0] }))

    expect(html).toContain('data-stat-chip="range"')
    expect(html).toContain('SELF-CAST')
    expect(html).toContain('data-targeting-relevance="irrelevant"')
    expect(html.match(/data-muted="true"/g)).toHaveLength(3)
    expect(html.match(/opacity-40/g)).toHaveLength(3)
    expect(visible_text(html).match(/—/g)).toHaveLength(3)
    expect(html).not.toContain('FREE AIM')
    expect(html).not.toContain('ANY (EMPTY OR OCCUPIED)')
    expect(html).not.toContain('NOT REQUIRED')
  })

  test('range 1-4 keeps all ordinary targeting facts active and visible', () => {
    const html = render_spell(level_fixture({ range: [1, 4] }))

    expect(html).toContain('1–4')
    expect(html).toContain('data-targeting-relevance="active"')
    expect(html).toContain('NOT REQUIRED')
    expect(html).toContain('ANY (EMPTY OR OCCUPIED)')
    expect(html).toContain('FREE AIM')
    expect(html).not.toContain('SELF-CAST')
    expect(html).not.toContain('data-muted="true"')
  })
})

describe('SpellDetail effect zones', () => {
  test('renders a localized shape and size in targeting when effect.zone is present', () => {
    const html = render_spell(
      level_fixture({
        effects: [
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'circle', size: 2 } },
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'cross', size: 3 } },
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'line', size: 4 } },
        ],
      })
    )

    expect(html).toContain('data-stat-chip="effect-zone"')
    expect(html).toContain('AREA OF EFFECT')
    expect(html).toContain('CIRCLE 2')
    expect(html).toContain('CROSS 3')
    expect(html).toContain('LINE 4')
  })

  test('keeps the targeting zone line hidden without effect.zone', () => {
    const html = render_spell(
      level_fixture({
        effects: [{ kind: 'HEAL', base: 7, chance: 100, area_shape: 'CIRCLE', area_size: 2 }],
      })
    )

    expect(html).not.toContain('data-stat-chip="effect-zone"')
    expect(html).not.toContain('AREA OF EFFECT')
    expect(html).not.toContain('data-aoe-grid')
    expect(visible_text(html)).toContain('CIRCLE 2')
  })

  // RED-FIRST: a zone of size 0 is exactly the one target cell (never real AoE), so the
  // chip must not appear at all — mirrors the seed-effect-line.js `is_area_effect` fix for the per-effect line.
  test('suppresses a single-cell zone (size 0) — never "CIRCLE 0"', () => {
    const html = render_spell(
      level_fixture({
        effects: [
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'circle', size: 0 } },
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'point', size: 0 } },
        ],
      })
    )

    expect(html).not.toContain('data-stat-chip="effect-zone"')
    expect(html).not.toContain('AREA OF EFFECT')
    expect(html).not.toContain('CIRCLE 0')
  })

  test('a real (size > 0) zone still prints alongside a suppressed size-0 one — size-gated, not shape-gated', () => {
    const html = render_spell(
      level_fixture({
        effects: [
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'circle', size: 0 } },
          { kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'ring', size: 3 } },
        ],
      })
    )

    expect(html).toContain('data-stat-chip="effect-zone"')
    expect(html).toContain('RING 3')
    expect(html).not.toContain('CIRCLE 0')
  })

  test('ALLMAP prints even at size 0 — the one shape independent of size', () => {
    const html = render_spell(
      level_fixture({
        effects: [{ kind: 'HEAL', base: 7, chance: 100, zone: { shape: 'allmap', size: 0 } }],
      })
    )

    expect(html).toContain('data-stat-chip="effect-zone"')
    expect(html).toContain('ENTIRE BOARD')
  })
})

describe('SpellDetail AoE cell patterns', () => {
  test('a CROSS 1 effect renders the exact canonical five-cell pattern, relative to the caster', () => {
    const html = render_spell(
      level_fixture({
        effects: [project_spell_effect({ kind: 5, value: 7, chance: 100, area_shape: 2, area_size: 1 })],
      })
    )
    const rendered_cells = new Set([...html.matchAll(/data-aoe-cell="([^"]+)"/g)].map((match) => match[1]))

    expect(rendered_cells).toEqual(new Set(['0,-1', '-1,0', '0,0', '1,0', '0,1']))
    expect(html).toContain('data-aoe-grid="true"')
    expect(html).toContain('data-aoe-caster="-1,0"')
    expect(visible_text(html)).not.toContain('CROSS 1')
  })

  test('an effect without an AoE renders no mini-grid', () => {
    const html = render_spell(
      level_fixture({
        effects: [project_spell_effect({ kind: 5, value: 7, chance: 100, area_shape: 0, area_size: 0 })],
      })
    )

    expect(html).not.toContain('data-aoe-grid')
    expect(html).not.toContain('data-aoe-cell')
  })

  test('a shape whose canonical footprint is only one cell is not promoted to an AoE grid', () => {
    const html = render_spell(
      level_fixture({
        effects: [project_spell_effect({ kind: 5, value: 7, chance: 100, area_shape: 7, area_size: 1 })],
      })
    )

    expect(html).not.toContain('data-aoe-grid')
    expect(visible_text(html)).toContain('CONE 1')
  })
})
