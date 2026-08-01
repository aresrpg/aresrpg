// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1439 CONDITION 1 — THE LIVE EFFECT-LINE PROSE IS SIX-LOCALE COMPLETE, OR IT IS RED.
//
// `seed_effect_parts` is the ONE renderer of spell-effect prose (grimoire, encyclopedia class page, the
// in-fight readout — all through `core_parts`). Its player-facing vocabulary is invisible to
// scripts/i18n_coverage.mjs: the stat/point names arrive as `t(view.key)` (a variable), the element and AoE
// labels as `t(\`spells.el_${…}\`)` / `t(\`encyclopedia.aoe_shape.${…}\`)` template literals — exactly the
// class that gate declares non-blocking and MANUAL AUDIT. This file is that audit, mechanized: every arm of
// `core_parts`, every STAT_*/POINT_* id it can name, every element, every AoE shape and every meta clause,
// driven through the real projection against the SHIPPED locale bundles in all six languages.
//
// The bar is the #1487 bar: a missing translation is not harmless fallback copy — i18next renders the dotted
// key, which is how `spells.null` once painted itself into a tooltip. Any raw key path in any visible string,
// in any locale, is a class failure here.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { TF_NOT_ENEMY, TF_ONLY_CASTER } from '@aresrpg/sim/spell_effect'

import de from '../../../../src/i18n/locales/de.json'
import en from '../../../../src/i18n/locales/en.json'
import es from '../../../../src/i18n/locales/es.json'
import fr from '../../../../src/i18n/locales/fr.json'
import ja from '../../../../src/i18n/locales/ja.json'
import uk from '../../../../src/i18n/locales/uk.json'

import { seed_effect_parts, seed_effect_line } from '../../../../src/game/screens/hud/seed-effect-line.js'

const BUNDLES = { de, en, es, fr, ja, uk }
const LOCALES = Object.keys(BUNDLES).sort()
const RAW_KEY_PATH = /\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/i

/** The shipped lookup chain: CLDR plural suffix for the locale, then the base key, then i18next's own
 * missing-key behaviour (the dotted key renders) — so a gap surfaces as the canary instead of silence. */
const translator = (locale) => (key, params = {}) => {
  const lookup = (k) => k.split('.').reduce((node, leaf) => (node == null ? node : node[leaf]), BUNDLES[locale])
  const plural = params.count != null ? new Intl.PluralRules(locale).select(params.count) : null
  const value = (plural != null ? lookup(`${key}_${plural}`) : undefined) ?? lookup(key)
  if (typeof value !== 'string') return key
  return value.replace(/{{(\w+)}}/g, (_, name) => String(params[name] ?? ''))
}

// The kind universe read from `core_parts` itself — a new arm joins this sweep the day it is written, and a
// deleted arm leaves it. The extractor self-test below keeps a blind regex from making the gate trivially green.
const SOURCE = readFileSync(new URL('../../../../src/game/screens/hud/seed-effect-line.js', import.meta.url), 'utf8')
const KINDS = [...SOURCE.matchAll(/^\s*case '([A-Z_]+)':/gm)].map(([, kind]) => kind)

const ELEMENTS = ['fire', 'water', 'earth', 'air', 'neutral', undefined]
const STAT_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99, undefined]
const SHAPES = ['POINT', 'CIRCLE', 'CROSS', 'LINE', 'TBAR', 'RING', 'ALLMAP', 'CONE']

const base_fx = (kind) => ({
  kind,
  element: 'earth',
  base: 7,
  damageMin: 5,
  damageMax: 9,
  chance: 100,
  turns: 2,
  stat: 0,
  area_shape: 'POINT',
  area_size: 0,
})

/** Every branch `core_parts` + `meta_of` can take for one kind — varied one axis at a time, never a product. */
const variants = (kind) => [
  ...ELEMENTS.map((element) => ({ ...base_fx(kind), element })),
  ...STAT_IDS.map((stat) => ({ ...base_fx(kind), stat })),
  ...SHAPES.map((area_shape) => ({ ...base_fx(kind), area_shape, area_size: 2 })),
  ...SHAPES.map((area_shape) => ({ ...base_fx(kind), area_shape, area_size: 0 })),
  { ...base_fx(kind), base: -7 }, // the penalty phrasings (sign discriminator)
  { ...base_fx(kind), base: 0 }, // DAMAGE_REDIRECT's full-redirect sentence arm
  ...[0, 1, 2, 3, 5].map((turns) => ({ ...base_fx(kind), turns })), // every CLDR plural category uk/fr/en reach
  { ...base_fx(kind), chance: 50 }, // proc-chance clause
  { ...base_fx(kind), target_filter: TF_ONLY_CASTER },
  { ...base_fx(kind), target_filter: TF_NOT_ENEMY },
  { ...base_fx(kind), crit_base: 19, crit_effect: { kind, element: 'earth', damageMin: 15, damageMax: 24 } },
  { ...base_fx(kind), damageMin: undefined, damageMax: undefined }, // the em-dash fallback
  { ...base_fx(kind), state_id: 788 }, // APPLY_STATE with a resolvable reference
]

const visible = (parts) => [parts.pre, parts.value, parts.post, parts.meta].filter((s) => typeof s === 'string')

describe('#1439 condition 1 — the live effect-line vocabulary resolves in all six locales', () => {
  test('the detectors recognize their canaries (a blind gate would be a lie)', () => {
    expect('2 spells.null damage per turn').toMatch(RAW_KEY_PATH)
    expect('encyclopedia.aoe_shape.circle').toMatch(RAW_KEY_PATH)
    expect('Become invisible').not.toMatch(RAW_KEY_PATH)
    // the kind extractor must actually see core_parts' arms
    expect(KINDS.length).toBeGreaterThanOrEqual(30)
    for (const kind of ['DAMAGE', 'HEAL', 'ALTER_STAT', 'APPLY_STATE', 'INVISIBILITY', 'STEAL_POINTS'])
      expect(KINDS).toContain(kind)
    // …and an unmapped kind must still reach the loud canary, not a silent blank
    expect(seed_effect_parts(translator('en'), base_fx('NOT_A_KIND')).pre).toBe('? NOT_A_KIND')
  })

  test.each(LOCALES)('%s renders every core_parts arm without a raw i18n key path', (locale) => {
    const t = translator(locale)
    for (const kind of KINDS)
      for (const fx of variants(kind)) {
        const parts = seed_effect_parts(t, fx, { locale, resolve_state_name: () => 'Ember Brand' })
        for (const rendered of visible(parts)) {
          expect(`${locale}/${kind}: ${rendered}`).not.toMatch(RAW_KEY_PATH)
          expect(`${locale}/${kind}: ${rendered}`).not.toContain('undefined')
          expect(`${locale}/${kind}: ${rendered}`).not.toContain('null')
        }
        expect(`${locale}/${kind}`).toBe(parts.pre.startsWith('? ') ? `? ${kind}` : `${locale}/${kind}`)
        expect(seed_effect_line(t, fx, { locale, resolve_state_name: () => 'Ember Brand' }).length).toBeGreaterThan(0)
      }
  })

  test.each(LOCALES)('%s names the APPLY_STATE fallback rather than leaking its key', (locale) => {
    const t = translator(locale)
    const unresolved = seed_effect_parts(t, base_fx('APPLY_STATE'), { locale })
    expect(unresolved.pre).not.toMatch(RAW_KEY_PATH)
    expect(unresolved.pre.length).toBeGreaterThan(0)
  })
})
