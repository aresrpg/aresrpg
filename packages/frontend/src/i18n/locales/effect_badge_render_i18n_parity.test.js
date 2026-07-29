// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1487 — RENDERED I18N KEYS ARE A CLASS FAILURE.
//
// A missing status-effect translation is not harmless fallback copy: i18next returns its dotted key, which
// painted `spells.null` in the poison tooltip. Walk the complete status-kind vocabulary through the real badge
// projection in every shipped locale and reject ANY dotted key path in every visible string. The two poison
// fixtures also pin the actual wire shape: `element` is the nested effect's numeric element id; `source` is the
// caster's fighter id and must never be mistaken for a spell or translation id.

import { describe, expect, test } from 'bun:test'
import { STATUS_KINDS } from '@aresrpg/fight/statuses'

import { effect_badge_view } from '../../game/screens/hud/EffectBadges.jsx'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const RAW_KEY_PATH = /\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/i

const translator =
  (bundle) =>
  (key, params = {}) => {
    const value = key.split('.').reduce((node, leaf) => (node == null ? node : node[leaf]), bundle)
    if (typeof value !== 'string') return key
    return value.replace(/{{(\w+)}}/g, (_, name) => String(params[name] ?? ''))
  }

const status_row = (kind, element = 3) => ({
  id: `${kind}:0`,
  kind,
  remaining_turns: 2,
  element,
  value: 7,
  stat: 0,
  chance: 100,
  source: null,
})

const visible_strings = (view) =>
  [view.label, view.view.pre, view.view.value, view.view.post, view.view.meta].filter(
    (value) => typeof value === 'string'
  )

describe('#1487 rendered effect i18n parity', () => {
  test('the raw-key-path detector recognizes the class canary', () => {
    expect('2 spells.null damage per turn').toMatch(RAW_KEY_PATH)
    expect('spells.fx_apply_dot').toMatch(RAW_KEY_PATH)
  })

  test.each(LOCALES)('%s renders every status kind without a raw i18n key path', async (locale) => {
    const bundle = (await import(`./${locale}.json`)).default
    const t = translator(bundle)
    const rows = [...STATUS_KINDS.map((kind) => status_row(kind)), status_row(21, null)]

    for (const row of rows)
      for (const rendered of visible_strings(effect_badge_view(t, row))) {
        expect(`${locale}:${row.kind}:${rendered}`).not.toMatch(RAW_KEY_PATH)
        expect(rendered).not.toContain('null')
        expect(rendered).not.toContain('undefined')
      }
  })

  test.each(LOCALES)('%s preserves the poison element id and omits only an absent element clause', async (locale) => {
    const bundle = (await import(`./${locale}.json`)).default
    const t = translator(bundle)
    const with_element = effect_badge_view(t, status_row(21, 3)).label
    const without_element = effect_badge_view(t, status_row(21, null)).label

    expect(with_element).not.toBe(without_element)
    expect(with_element).not.toMatch(RAW_KEY_PATH)
    expect(without_element).not.toMatch(RAW_KEY_PATH)
  })
})
