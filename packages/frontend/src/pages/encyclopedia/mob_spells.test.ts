// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { seed_effect_parts } from '../../game/screens/hud/seed-effect-line.js'
import en from '../../i18n/locales/en.json'

import { mob_spell_views } from './mob_spells'
import { WORLD_CORPUS, mob_corpus_of, has_world_corpus } from './world_corpus'

const EN = i18next.createInstance()
await EN.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = (key: string, params?: object) => EN.t(key, params as never) as string

// The corpus authors BOTH the numeric Move kind and its human `op` — that pairing is the oracle for the
// decoder's kind table (no vendored-enum drift can survive it). ops observed in the live corpus.
const OP_TO_KIND: Record<string, string> = {
  damage: 'DAMAGE',
  percent_life_damage: 'PERCENT_LIFE',
  life_steal: 'LIFE_STEAL',
  heal: 'HEAL',
  remove_points: 'REMOVE_POINTS',
  alter_stat: 'ALTER_STAT',
  steal_stat: 'STEAL_STAT',
  alter_resist: 'ALTER_RESIST',
  push: 'PUSH',
  pull: 'PULL',
  teleport: 'TELEPORT',
  swap_positions: 'SWAP',
  place_glyph: 'PLACE_GLYPH',
  apply_dot: 'APPLY_DOT',
  reduce_damage: 'REDUCE_DAMAGE',
  reflect_damage: 'REFLECT_DAMAGE',
  dispel: 'DISPEL',
}

const living_mob_names = () => [...new Set(WORLD_CORPUS.worlds.flatMap((world) => world.mobs.map((mob) => mob.name)))]

// RUNTIME BLOB (#196): the world corpus loads from a published asset-host blob at boot (load_world_corpus),
// never fetched in a headless unit test — world_corpus's mob facts degrade to empty here (issue #106).
describe('mob corpus facts (xp + spell kit)', () => {
  test.skipIf(!has_world_corpus())(
    'every living mob template resolves authored facts with a real xp and a non-empty kit',
    () => {
      const names = living_mob_names()
      expect(names.length).toBeGreaterThan(0)
      for (const name of names) {
        const facts = mob_corpus_of(name)
        if (!facts) throw new Error(`no authored facts for mob ${name}`)
        expect(facts.xp).toBeGreaterThan(0)
        expect(facts.spells.length).toBeGreaterThan(0)
      }
    }
  )

  test('an unknown template id resolves to an honest gap, never fabricated facts', () => {
    expect(mob_corpus_of('0xdead')).toBeUndefined()
    expect(mob_corpus_of(null)).toBeUndefined()
  })
})

describe('mob spell decode', () => {
  test.skipIf(!has_world_corpus())(
    'decodes the whole live corpus: kinds match the authored op pairing, wording never leaks a canary or a raw key',
    () => {
      let effects_checked = 0
      for (const name of living_mob_names()) {
        const facts = mob_corpus_of(name)
        const views = mob_spell_views(facts?.spells)
        expect(views.length).toBeGreaterThan(0)
        for (const [spell_index, view] of views.entries()) {
          expect(view.ap).toBeGreaterThan(0)
          expect(view.range[0]).toBeLessThanOrEqual(view.range[1])
          for (const [effect_index, fx] of view.effects.entries()) {
            effects_checked += 1
            const authored = facts!.spells[spell_index].effects![effect_index]
            const expected_kind = OP_TO_KIND[authored.op ?? '']
            if (!expected_kind) throw new Error(`unmapped authored op '${authored.op}' on mob ${name}`)
            expect(fx.kind).toBe(expected_kind)
            const parts = seed_effect_parts(t as never, fx)
            const line = `${parts.pre}${parts.value ?? ''}${parts.post}${parts.meta ?? ''}`
            expect(parts.pre.startsWith('? ')).toBe(false)
            expect(line.includes('spells.fx_')).toBe(false)
            expect(line.includes('stat.')).toBe(false)
            // seed_effect_value's missing-range placeholder must be unreachable for a decoded mob effect
            expect(line.includes('—')).toBe(false)
          }
        }
      }
      expect(effects_checked).toBeGreaterThan(400)
    }
  )

  test('mirrors the mint defaults and merges the same-kind crit effect into crit_base', () => {
    const [view] = mob_spell_views([
      {
        ap: 3,
        rmin: 1,
        rmax: 5,
        cd: 2,
        crit: 20,
        effects: [{ kind: 0, op: 'damage', element: 'earth', base: 10, area_shape: 1, area_size: 2 }],
        crit_effects: [{ kind: 0, op: 'damage', element: 'earth', base: 18 }],
      },
    ])
    expect(view).toEqual({
      ap: 3,
      range: [1, 5],
      modifiable_range: false,
      cooldown: 2,
      crit_rate: 20,
      line_of_sight: true,
      effects: [
        {
          kind: 'DAMAGE',
          element: 'earth',
          base: 10,
          damageMin: 10,
          damageMax: 10,
          chance: 100,
          turns: 0,
          area_shape: 'CIRCLE',
          area_size: 2,
          crit_base: 18,
        },
      ],
    })
    // seeder defaults (spellLevel): ap 4 / range 1-4 / cd 0 / los true / crit 0
    const [defaults] = mob_spell_views([{ effects: [{ kind: 14, op: 'teleport' }] }])
    expect(defaults).toEqual({
      ap: 4,
      range: [1, 4],
      modifiable_range: false,
      cooldown: 0,
      crit_rate: 0,
      line_of_sight: true,
      effects: [{ kind: 'TELEPORT', base: 0, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }],
    })
  })
})
