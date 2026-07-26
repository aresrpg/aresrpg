// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#951) — the served spell tooltip rendered `− Earth damage · crit 5`: the EFFECTS block with no
// damage in it, exactly where a player reads what a spell does. The corpus wire row carries its magnitude as
// `value` / `value_max`; every display surface reads `damageMin` / `damageMax` (seed_effect_value, the one
// grammar behind the tooltip, the grimoire and the encyclopedia). Nothing mapped the two, so `seed_effect_value`
// took its "no honest bounds" em-dash branch on EVERY magnitude row — and the crit meta fell back to the single
// `crit_base` number, which is the reported `crit 5` with no range beside it.
//
// This drives the REAL projection (build_fight_spells, the door fight-spells.js loads the corpus through) over
// CAPTURED WIRE BYTES (spell_corpus_wire.fixture.json — published rows, provenance in the file), so it is an
// oracle rather than an echo of the code under test: hand-written rows carrying damageMin/damageMax would have
// stayed green through the entire defect, which is precisely how it shipped.

import { describe, expect, test } from 'bun:test'

import WIRE from '../../../simulator/spell_corpus_wire.fixture.json'
import { build_fight_spells } from './fight-spells-core.js'
import { seed_effect_line, seed_effect_parts } from './seed-effect-line.js'

/** Echo the key + params so a missing i18n key or an empty branch is visible in the assertion. */
const t_stub = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key

const { spells } = build_fight_spells(WIRE.rows)
const magnitude_kinds = new Set(['DAMAGE', 'HEAL', 'APPLY_DOT', 'LIFE_STEAL', 'PUNISHMENT', 'CASTER_DAMAGE'])
const magnitude_effects = spells.flatMap((spell) =>
  spell.levels.flatMap((level) => (level.effects ?? []).filter((fx) => magnitude_kinds.has(fx.kind)))
)

describe('#951 — every effect row carries its numbers', () => {
  test('the fixture is the wire shape the defect lived in (value / value_max, no damageMin)', () => {
    const raw = WIRE.rows[0].levels[0].effects[0]
    expect(raw.value).toBeGreaterThan(0)
    expect(raw.value_max).toBeGreaterThan(raw.value)
    expect('damageMin' in raw).toBe(false)
  })

  test('the projection maps the authored band onto the bounds every display surface reads', () => {
    expect(magnitude_effects.length).toBeGreaterThan(0)
    for (const fx of magnitude_effects) {
      expect(fx.damageMin).toBeGreaterThan(0)
      expect(fx.damageMax).toBeGreaterThanOrEqual(fx.damageMin)
    }
  })

  test('no magnitude row renders the em-dash "no bounds" fallback — the reported blank line', () => {
    for (const fx of magnitude_effects) {
      const parts = seed_effect_parts(t_stub, fx)
      expect(parts.value).not.toBe('—')
      expect(parts.value).toMatch(/\d/)
    }
  })

  test('the first captured DAMAGE row reads its min−max range, and its crit reads a range too', () => {
    const fx = spells[0].levels[0].effects.find((effect) => effect.kind === 'DAMAGE')
    const raw = WIRE.rows[0].levels[0].effects[0]
    const raw_crit = WIRE.rows[0].levels[0].crit_effects[0]
    expect(seed_effect_line(t_stub, fx)).toContain(`${raw.value} entity.range_to ${raw.value_max}`)
    // the meta suffix's crit was a bare `crit_base` number (`crit 5`) whenever the crit row had no bounds
    expect(seed_effect_parts(t_stub, fx).meta).toContain(`${raw_crit.value} entity.range_to ${raw_crit.value_max}`)
  })

  test('a row with no authored value keeps the honest em dash instead of inventing a 0−0 band', () => {
    const [flagged] = build_fight_spells([
      {
        id: 'x_flagless',
        classType: 'senshi',
        name: 'Flagless',
        unlock: 1,
        levels: [{ effects: [{ kind: 0, element: 2 }], crit_effects: [] }],
      },
    ]).spells
    const fx = flagged.levels[0].effects[0]
    expect('damageMin' in fx).toBe(false)
    expect(seed_effect_parts(t_stub, fx).value).toBe('—')
  })
})
