// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import {
  build_spell_state_registry,
  resolve_spell_description,
  resolve_spell_state,
  spell_state_name_resolver,
} from '../src/game/data/spell-text.js'
import { build_fight_spells } from '../src/game/screens/hud/fight-spells-core.js'
import { effect_badge_view } from '../src/game/screens/hud/EffectBadges.jsx'
import { SpellHoverTip } from '../src/game/screens/hud/spell-hover-tip.jsx'
import { SpellDetail } from '../src/pages/encyclopedia/classes_tab'
import de from '../src/i18n/locales/de.json'
import en from '../src/i18n/locales/en.json'
import es from '../src/i18n/locales/es.json'
import fr from '../src/i18n/locales/fr.json'
import ja from '../src/i18n/locales/ja.json'
import uk from '../src/i18n/locales/uk.json'

const FIXTURE_PATH = new URL('./fixtures/spell-corpus-20260801a.sample.json', import.meta.url)
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH)
const fixture = JSON.parse(FIXTURE_BYTES.toString())
const { rows } = fixture
const [blood_toll_row] = rows

const locale_rows = [
  ['en', en],
  ['fr', fr],
  ['de', de],
  ['es', es],
  ['ja', ja],
  ['uk', uk],
] as const

const i18n_for = (locale: string, resources: object) => {
  const i18n = i18next.createInstance()
  i18n.init({
    lng: locale,
    resources: { [locale]: { translation: resources } },
    interpolation: { escapeValue: false },
  })
  return i18n
}

const localized = (row: any, locale: string, field: 'description' | 'name' | 'felt') =>
  locale === 'en' ? row[field] : row.i18n[locale][field]

const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('#1439 20260801a captured corpus fixture', () => {
  test('pins the exact decoded fixture bytes and provenance', () => {
    expect(createHash('sha256').update(FIXTURE_BYTES).digest('hex')).toBe(
      '9388e378e084728bca0f366d66eb12331ec8358de44c9e38332be974b93fe9c1'
    )
    expect(fixture._doc).toMatchObject({
      version: '20260801a',
      sha256: '2c46048b0d73a2dd73c2e0879c3a419be8aebf6f9e8f3ae0147cfbf9cf07e1fb',
      captured: '2026-08-01',
    })
    expect(rows.map((row: any) => row.id)).toEqual([
      'ikari_blood_toll',
      'ikari_fester',
      'ikari_drowning_toll',
      'iyashi_selfless_word',
      'tokei_smear',
    ])
  })
})

describe('#1439 L2 corpus-carried spell state registry', () => {
  const registry = build_spell_state_registry(rows)
  const blood_toll = blood_toll_row.states.find((state: any) => state.id === 788)

  test('dedupes per-applier rows by id into the exact six-state registry', () => {
    expect([...registry.keys()]).toEqual(['776', '788', '40', '42', '50', '39'])
    expect(new Set([...registry.keys()])).toEqual(new Set(['39', '40', '42', '50', '776', '788']))
    expect(registry.size).toBe(6)
  })

  test.each(locale_rows)('%s resolves a state reference to its corpus name and felt line', (locale) => {
    expect(resolve_spell_state(registry, 788, locale)).toEqual({
      id: 788,
      slug: 'blood_toll',
      name: localized(blood_toll, locale, 'name'),
      felt: localized(blood_toll, locale, 'felt'),
    })
  })

  test.each(locale_rows)('%s active-fight state rows render the name and never the id', (locale, resources) => {
    const i18n = i18n_for(locale, resources)
    const t = i18n.t.bind(i18n)
    const resolve_state_name = spell_state_name_resolver(rows, locale)
    const badge = effect_badge_view(t, { kind: 22, value: 788, remaining_turns: 2 }, { locale, resolve_state_name })

    expect(badge.label).toContain(localized(blood_toll, locale, 'name'))
    expect(badge.label).not.toContain('788')
  })

  test('an unknown reference stays unresolved instead of echoing its wire id', () => {
    expect(resolve_spell_state(registry, 1439, 'en')).toBeNull()
  })
})

describe('#1439 L3 per-spell corpus descriptions', () => {
  const blood_toll = blood_toll_row

  test.each(locale_rows)('%s follows its corpus locale path', (locale) => {
    expect(resolve_spell_description(blood_toll, locale)).toBe(localized(blood_toll, locale, 'description'))
  })

  test('falls back locale -> EN -> a key-visible error state, never blank', () => {
    expect(resolve_spell_description({ ...blood_toll, i18n: { ...blood_toll.i18n, fr: {} } }, 'fr')).toBe(
      blood_toll.description
    )
    expect(
      resolve_spell_description(
        { id: blood_toll.id, description_key: blood_toll.description_key, description: '', i18n: {} },
        'en'
      )
    ).toBe(`[${blood_toll.description_key}]`)
    expect(resolve_spell_description({}, 'en')).toBe('[spell.unknown.description]')
  })
})

describe('#1439 spell surfaces consume corpus text and named states', () => {
  const blood_toll = build_fight_spells(rows).spells.find((spell: any) => spell.template_id === 'ikari_blood_toll')

  test.each(locale_rows)(
    '%s encyclopedia and fight hover show corpus text without raw state ids',
    (locale, resources) => {
      const i18n = i18n_for(locale, resources)
      const t = i18n.t.bind(i18n)
      const encyclopedia = visible_text(
        renderToStaticMarkup(
          <I18nextProvider i18n={i18n}>
            <SpellDetail spell={blood_toll} />
          </I18nextProvider>
        )
      )
      const hover = visible_text(
        renderToStaticMarkup(<SpellHoverTip t={t} locale={locale} name={blood_toll.name} spell={blood_toll} />)
      )
      const state_788 = rows[0].states.find((state: any) => state.id === 788)
      const state_776 = rows[0].states.find((state: any) => state.id === 776)

      for (const text of [encyclopedia, hover]) {
        expect(text).toContain(localized(rows[0], locale, 'description'))
        expect(text).toContain(localized(state_788, locale, 'name'))
        expect(text).toContain(localized(state_776, locale, 'name'))
        expect(text).not.toMatch(/\b(?:776|788)\b/u)
      }
      expect(hover).toContain(localized(state_788, locale, 'felt'))
      expect(hover).toContain(localized(state_776, locale, 'felt'))
    }
  )

  test('the grimoire detail is wired to corpus descriptions and locale-aware state lines', () => {
    const source = readFileSync(new URL('../src/game/screens/hud/Spellbook.jsx', import.meta.url), 'utf8')

    expect(source).toContain('const description = resolve_spell_description(row, locale)')
    expect(source).toContain('view={seed_effect_parts(t, fx, { locale })}')
    expect(source).not.toContain("chain_copy(t, row.name_key, '_desc')")
  })

  test('a projected spell missing text shows its key-visible state on both homes', () => {
    const [missing] = build_fight_spells([
      { ...rows[0], description: '', i18n: {}, description_key: 'spell.missing_fixture.desc' },
    ]).spells
    const i18n = i18n_for('en', en)
    const t = i18n.t.bind(i18n)
    const encyclopedia = visible_text(
      renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <SpellDetail spell={missing} />
        </I18nextProvider>
      )
    )
    const hover = visible_text(
      renderToStaticMarkup(<SpellHoverTip t={t} locale="en" name={missing.name} spell={missing} />)
    )

    expect(encyclopedia).toContain('[spell.missing_fixture.desc]')
    expect(hover).toContain('[spell.missing_fixture.desc]')
  })
})
