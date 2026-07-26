// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1049 (second root cause) — THE CORPUS DIALECT. `spell_corpus.json` states a signed ALTER_STAT/ALTER_RESIST
// magnitude the way a designer authors it (`+20` strength, `−8` strength); the chain cannot, because
// `Effect.value` is a u64, so the mint CENTRES those two kinds at 32768 and `@aresrpg/sim`'s normalizer — whose
// other caller feeds it rows read straight off a minted MobTemplate — decodes that centering at its door.
//
// Handing the normalizer the authored dialect folded every alter row as its own 32768-complement: a
// `+20 Strength · 5 turns` buff became a `−32748 Strength` DEBUFF in every prediction the client runs, which is
// the "+20 strength never applies" half of the report. Measured against the live blob 2026-07-26: 906
// plain-positive and 6 negative alter rows across the 240 published spells, ZERO centered.
//
// Provenance for the rows below — assets.aresrpg.world/data/spell_corpus.json, captured 2026-07-26:
//   yajin_killers_calm  L1 effects[0] = { kind: 9, stat: 0,  value:  20, turns: 5, target_filter: 4 }
//   yogen_full_draw     L1 effects[0] = { kind: 9, stat: 8,  value: 110, turns: 2, target_filter: 4 }
//   ikari_martyrs_call  L1 effects[0] = { kind: 9, stat: 0,  value:  -8, turns: 3, target_filter: 1, flags: 12 }

import { describe, expect, test } from 'bun:test'

import { build_fight_spells } from './fight-spells-core.js'

const level = (effects) => ({
  min_char_level: 1,
  ap_cost: 3,
  range_min: 0,
  range_max: 5,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: true,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects,
  crit_effects: [],
})

const alter = (over) => ({
  kind: 9,
  element: 255,
  area_shape: 0,
  area_size: 0,
  chance: 100,
  stat: 0,
  flags: 0,
  phase: 0,
  ...over,
})

const CORPUS = [
  {
    id: 'yajin_killers_calm',
    classType: 'yajin',
    name: "Killer's Calm",
    unlock: 1,
    role: 'buff',
    levels: [level([alter({ value: 20, value_max: 20, target_filter: 4, turns: 5, stat: 0 })])],
  },
  {
    id: 'yogen_full_draw',
    classType: 'yogen',
    name: 'Full Draw',
    unlock: 1,
    role: 'buff',
    levels: [level([alter({ value: 110, value_max: 110, target_filter: 4, turns: 2, stat: 8 })])],
  },
  {
    id: 'ikari_martyrs_call',
    classType: 'ikari',
    name: "Martyr's Call",
    unlock: 1,
    role: 'debuff',
    levels: [level([alter({ value: -8, value_max: -8, target_filter: 1, turns: 3, stat: 0, flags: 12 })])],
  },
]

describe("#1049 the published corpus' authored alter rows reach the sim as their real delta", () => {
  const { spells, templates } = build_fight_spells(CORPUS)
  const effect_of = (id) => templates.get(id).levels[0].base_effects[0]

  test('a +20 Strength buff is a +20 BUFF, not a −32748 debuff', () => {
    const effect = effect_of('yajin_killers_calm')
    expect(effect.type).toBe('ADD')
    expect(effect.stat).toBe('strength')
    expect(effect.value).toBe(20)
  })

  test('a +110% damage buff keeps its magnitude', () => {
    const effect = effect_of('yogen_full_draw')
    expect(effect.type).toBe('ADD')
    expect(effect.stat).toBe('percent_damage')
    expect(effect.value).toBe(110)
  })

  test('an authored NEGATIVE alter row stays a debuff of its own magnitude', () => {
    const effect = effect_of('ikari_martyrs_call')
    expect(effect.type).toBe('REMOVE')
    expect(effect.stat).toBe('strength')
    expect(effect.value).toBe(8)
  })

  test('the DISPLAY projection still reads the authored signed magnitude — one home per fact', () => {
    const row = spells.find((spell) => spell.template_id === 'yajin_killers_calm')
    expect(row.levels[0].effects[0].base).toBe(20)
    expect(row.levels[0].effects[0].damageMin).toBe(20)
    const debuff = spells.find((spell) => spell.template_id === 'ikari_martyrs_call')
    expect(debuff.levels[0].effects[0].base).toBe(-8)
  })

  test('a NON-signed kind passes through untouched (only 9 and 11 ride centered)', () => {
    const { templates: plain } = build_fight_spells([
      {
        id: 'probe_reflect',
        classType: 'tokei',
        name: 'Backtick',
        unlock: 1,
        role: 'buff',
        levels: [level([alter({ kind: 25, value: 3, value_max: 3, target_filter: 4, turns: 3 })])],
      },
    ])
    expect(plain.get('probe_reflect').levels[0].base_effects[0].value).toBe(3)
  })
})
