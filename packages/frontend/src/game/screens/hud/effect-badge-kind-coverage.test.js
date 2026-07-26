// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1049 — AN UNRENDERED STATUS KIND IS IMPOSSIBLE BY CONSTRUCTION.
//
// Every surface that shows a fighter's active effects (the turn card's EffectBadges, the board-hover
// TooltipCard's ActiveEffectRows) derives from ONE projection: `engine_view` fighter `effects`, the fold's
// per-fighter status home. `packages/fight/src/statuses.js` owns the ONE universe of chain kinds that home can
// hold — `STATUS_KINDS` — and this gate walks it: each kind must produce a real localized badge line, never
// `seed_effect_parts`' loud `? KIND` canary and never an untranslated key.
//
// The gate is the ticket's actual ask: a status kind added to the vocabulary with no render arm goes RED here
// instead of painting `? 38` on a player's turn card. Seven wave-12 retro kinds (32 · 34 · 35 · 36 · 37 · 38 ·
// 39) were exactly that gap — recordable statuses with no name in `kind_names` and no arm in `core_parts`.

import { describe, expect, test } from 'bun:test'
import { STATUS_KINDS } from '@aresrpg/fight/statuses'

import en from '../../../i18n/locales/en.json'

import { effect_badge_view } from './EffectBadges.jsx'

const LOCALES = ['en', 'fr', 'es', 'de', 'ja', 'uk']

/** The real i18n read: resolve `spells.fx_x` out of the shipped locale bundle, interpolating `{{value}}`. */
const translator = (bundle) => (key, params = {}) => {
  const value = key.split('.').reduce((node, leaf) => (node == null ? node : node[leaf]), bundle)
  if (typeof value !== 'string') return key
  return value.replace(/{{(\w+)}}/g, (_, name) => String(params[name] ?? ''))
}

/** A plausible live status row for `kind` — a positive magnitude, a real duration, a concrete stat/element. */
const status_row = (kind) => ({
  id: `${kind}:0`,
  kind,
  remaining_turns: 2,
  element: 2,
  value: 7,
  stat: 0,
  chance: 100,
  source: 0,
})

describe('#1049 every status kind the fold can hold owns a badge arm', () => {
  test('STATUS_KINDS is the ONE universe and is non-empty', () => {
    expect(STATUS_KINDS.length).toBeGreaterThan(0)
    // The kinds the live reports named: GIVE/REMOVE_POINTS · ALTER_STAT · REFLECT_DAMAGE · INVISIBILITY.
    for (const kind of [6, 7, 9, 25, 27]) expect(STATUS_KINDS).toContain(kind)
  })

  for (const kind of STATUS_KINDS)
    test(`kind ${kind} renders a real line, never the '? KIND' canary`, () => {
      const view = effect_badge_view(translator(en), status_row(kind))
      expect(view.label.startsWith('? ')).toBe(false)
      expect(view.view.pre.startsWith('? ')).toBe(false)
      // A rendered line always says SOMETHING beyond its duration suffix.
      expect(`${view.view.pre}${view.view.value ?? ''}${view.view.post}`.trim().length).toBeGreaterThan(0)
      // …and never leaks a raw i18n key.
      expect(view.label).not.toContain('spells.fx_')
    })

  test('every badge arm resolves in ALL SIX locales — no untranslated fallback anywhere', async () => {
    const bundles = Object.fromEntries(
      await Promise.all(
        LOCALES.map(async (locale) => [locale, (await import(`../../../i18n/locales/${locale}.json`)).default])
      )
    )
    for (const locale of LOCALES)
      for (const kind of STATUS_KINDS) {
        const label = effect_badge_view(translator(bundles[locale]), status_row(kind)).label
        expect(`${locale}:${kind}:${label}`).not.toContain('spells.fx_')
        expect(`${locale}:${kind}:${label}`).not.toContain('? ')
      }
  })
})
