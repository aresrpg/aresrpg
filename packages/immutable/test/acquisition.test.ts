// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The balancing tools: acquisition time through the recipe graph, and the Dofus Retro power references.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  acquisition_average_seconds,
  acquisition_catalog,
  acquisition_estimator,
  acquisition_target_range,
  acquisition_target_status,
  best_recipe_for_job_progression,
  compare_recipe_progress,
  dofus_mob_power_envelope,
  dofus_weapon_damage_envelope,
  hero_power,
  item_acquisition,
  item_budget_envelope,
  item_budget_standing,
  item_budget_stat_weight,
  item_stat_center,
  recipe_progression_issues,
  unlocked_recipe_chains,
  type AcquisitionContent,
  type RecipeProgressionInput,
} from '../src/index.ts'
import { DOFUS_GEAR_POWER, DOFUS_WEAPON_POWER } from '../src/dofus_item_power_corpus.gen.ts'
import { DOFUS_MOB_GRADES } from '../src/dofus_mob_power_corpus.gen.ts'
import { mob_power_cohort_of_role } from '../src/mob_power.ts'

const wolf = Object.freeze({
  mob_type: 'wolf',
  family: 'canine',
  role: 'normal',
  level_min: 10,
  level_max: 20,
  hp: 100,
  resistances: Object.freeze({ earth: 32_768, fire: 32_768, water: 32_768, air: 32_768 }),
  loot: Object.freeze([Object.freeze({ item_type: 'fang', chance_bp: 5_000, min_qty: 1, max_qty: 1 })]),
})
const placed = (...mob_types: string[]) =>
  Object.freeze([{ cities: [], mobs: mob_types.map((mob_type) => ({ mob_type })), resources: [] }])
const content = Object.freeze({
  items: Object.freeze([
    Object.freeze({ item_type: 'fang', category: 'resource', level: 10 }),
    Object.freeze({ item_type: 'plate', category: 'resource', level: 10 }),
    Object.freeze({ item_type: 'hat', category: 'hat', level: 20 }),
  ]),
  recipes: Object.freeze([
    Object.freeze({ output_type: 'plate', inputs: Object.freeze({ fang: 2 }) }),
    Object.freeze({ output_type: 'hat', inputs: Object.freeze({ plate: 3 }) }),
  ]),
  mobs: Object.freeze([wolf]),
  worlds: placed('wolf'),
  dungeons: Object.freeze([]),
}) satisfies AcquisitionContent
const fastest = (variant: AcquisitionContent, item_type = 'fang') =>
  acquisition_catalog(variant)[item_type]?.best?.minimum_seconds

describe('acquisition', () => {
  test('drops, quantities and craft failure fold through the recipe graph from Move loot basis points', () => {
    const estimates = acquisition_catalog(content)
    const fang = estimates.fang!.best!
    expect(fang.minimum_seconds).toBeLessThanOrEqual(fang.maximum_seconds)
    expect(estimates.plate!.craft!.minimum_seconds).toBeGreaterThan(fang.minimum_seconds * 2)
    expect(estimates.hat!.craft!.minimum_seconds).toBeGreaterThan(estimates.plate!.craft!.minimum_seconds * 3)
    expect(estimates.hat!.ingredients[0]?.quantity).toBe(3)
    expect(item_acquisition(content, 'hat')).toEqual(estimates.hat)
    expect(acquisition_estimator(content)('hat')).toEqual(estimates.hat)
    // move-math resolves 2 bp to 1 and 2 bp across the band: one 20-second fight for five drops.
    const rare = { ...content, mobs: [{ ...wolf, hp: 1, loot: [{ ...wolf.loot[0]!, chance_bp: 2 }] }] }
    expect(item_acquisition(rare, 'fang').best).toEqual({ minimum_seconds: 20_000, maximum_seconds: 40_000 })
    // Unplaced mobs drop nothing, and nothing crafted from their loot is reachable.
    const unplaced = acquisition_catalog({ ...content, worlds: [] })
    expect([unplaced.fang?.best, unplaced.hat?.craft]).toEqual([null, null])
  })

  test('bosses, archimobs, resistances and class area coverage change the farming time', () => {
    const boss = { ...content, mobs: [{ ...wolf, mob_type: 'boss', role: 'boss' }], worlds: placed('boss') }
    expect(fastest(boss)).toBeGreaterThan(fastest(content)!)
    // Resistances above and below the centre scale with the band and slow or speed the fight.
    const sturdy = { ...content, mobs: [{ ...wolf, hp: 50_000 }] }
    const resistant = { ...wolf.resistances, earth: 32_868, fire: 32_868, water: 32_868, air: 32_868 }
    const frail = { ...wolf.resistances, earth: 32_668, fire: 32_668, water: 32_668, air: 32_668 }
    expect(fastest({ ...sturdy, mobs: [{ ...sturdy.mobs[0]!, resistances: resistant }] })).toBeGreaterThan(
      fastest(sturdy)!
    )
    expect(fastest({ ...sturdy, mobs: [{ ...sturdy.mobs[0]!, resistances: frail }] })).toBeLessThan(fastest(sturdy)!)
    const eye = { item_type: 'archi_eye', category: 'resource', level: 20 }
    const archi = {
      ...wolf,
      mob_type: 'wolf_archi',
      role: 'archi',
      loot: [{ ...wolf.loot[0]!, item_type: 'archi_eye', chance_bp: 10_000 }],
    }
    expect(fastest({ ...content, items: [...content.items, eye], mobs: [wolf, archi] }, 'archi_eye')).toBeCloseTo(
      1_231.25
    )

    const caster = (classe: string, area_shape: number) => ({
      classe,
      unlock_level: 1,
      levels: [{ effects: [{ kind: 0, stat: 0, turns: 0, area_shape, area_size: 2 }] }],
    })
    const area = { ...content, spells: [caster('area_class', 6), caster('point_class', 0)] }
    expect(fastest(area)).toBeLessThan(fastest(content)!)
    expect(fastest({ ...content, spells: [caster('ring_class', 5), caster('line_class', 3)] })).toBeLessThan(
      fastest(content)!
    )
  })

  test('recipe chains unlock across professions by slots, and cycles never unlock', () => {
    const recipes: readonly RecipeProgressionInput[] = [
      { output_type: 'ring', job: 'JEWELER', inputs: { resin: 2, thread: 1 } },
      { output_type: 'resin', job: 'ALCHEMIST', inputs: { sap: 1, water: 1, powder: 1 } },
      { output_type: 'powder', job: 'MINER', inputs: { ore: 2, water: 1 } },
      { output_type: 'simple_ring', job: 'JEWELER', inputs: { sap: 2, thread: 1 } },
    ]
    expect([...unlocked_recipe_chains(recipes, { JEWELER: 8 })].sort()).toEqual(['powder', 'simple_ring'])
    expect([...unlocked_recipe_chains(recipes, { JEWELER: 8, ALCHEMIST: 10 })].sort()).toEqual([
      'powder',
      'resin',
      'ring',
      'simple_ring',
    ])
    expect(unlocked_recipe_chains(recipes, { JEWELER: 8 }).has('ring')).toBeFalse()
    const nested: readonly RecipeProgressionInput[] = [
      { output_type: 'pendant', job: 'JEWELER', inputs: { ring: 1, thread: 1 } },
      { output_type: 'ring', job: 'JEWELER', inputs: { resin: 1, thread: 1 } },
      { output_type: 'resin', job: 'JEWELER', inputs: { sap: 100, water: 10, ore: 30 } },
    ]
    expect(unlocked_recipe_chains(nested, { JEWELER: 9 }).size).toBe(0)
    expect([...unlocked_recipe_chains(nested.toReversed(), { JEWELER: 10 })].sort()).toEqual([
      'pendant',
      'resin',
      'ring',
    ])
    const cyclic: readonly RecipeProgressionInput[] = [
      { output_type: 'a', job: 'JEWELER', inputs: { b: 1, ore: 1 } },
      { output_type: 'b', job: 'ALCHEMIST', inputs: { a: 1, water: 1 } },
      { output_type: 'c', job: 'JEWELER', inputs: { a: 1, thread: 1 } },
      { output_type: 'loop', job: 'JEWELER', inputs: { loop: 1, thread: 1 } },
      { output_type: 'free', job: 'MINER', inputs: { ore: 1, water: 1 } },
    ]
    expect([...unlocked_recipe_chains(cyclic, { JEWELER: 100, ALCHEMIST: 100 })]).toEqual(['free'])

    expect(
      recipe_progression_issues(
        [
          { output_type: 'thread', inputs: { fiber: 1, dye: 1, water: 1 }, job: 'TAILOR' },
          { output_type: 'hat', inputs: { thread: 2, needle: 1 }, job: 'TAILOR' },
          { output_type: 'carved_head', inputs: { ore: 1, wood: 1, resin: 1, wool: 1 }, job: 'CARVER' },
          { output_type: 'hoe', inputs: { carved_head: 1, handle: 1 }, job: 'HANDYMAN' },
          { output_type: 'hammer', inputs: { ore: 1, handle: 1, leather: 1 }, job: 'HANDYMAN' },
          { output_type: 'machine', inputs: { ore: 1, wood: 1, resin: 1, leather: 1 }, job: 'HANDYMAN' },
        ],
        ['TAILOR', 'HANDYMAN']
      )
    ).toEqual([{ job: 'TAILOR', level: 1, slot_capacity: 2, reachable_recipe_count: 0 }])
  })

  test('the best recipe gives the most XP per acquisition second among feasible unlocked chains, ties stable', () => {
    const recipes: RecipeProgressionInput[] = [
      { output_type: 'slow_blade', inputs: { slow_ore: 2, handle: 1 }, job: 'FORGER' },
      { output_type: 'fast_blade', inputs: { fast_ore: 1, handle: 1 }, job: 'FORGER' },
      { output_type: 'alloy', inputs: { fast_ore: 1, coal: 1, water: 1 }, job: 'FORGER' },
      { output_type: 'blocked_blade', inputs: { alloy: 1, handle: 1 }, job: 'FORGER' },
      { output_type: 'carved_head', inputs: { wood: 1, resin: 1, hide: 1, water: 1 }, job: 'CARVER' },
      { output_type: 'cross_job_blade', inputs: { carved_head: 1, handle: 1 }, job: 'FORGER' },
    ]
    const seconds = new Map([
      ['slow_ore', 10],
      ['fast_ore', 1],
      ['handle', 1],
      ['coal', 1],
      ['water', 1],
      ['carved_head', 5],
    ])
    const input_seconds = (item_type: string): number | null => seconds.get(item_type) ?? null
    const best = (level: number, feasible?: (recipe: { output_type: string }) => boolean) =>
      best_recipe_for_job_progression(recipes, 'FORGER', level, input_seconds, feasible)?.output_type ?? null
    expect([best(1), best(10), best(100)]).toEqual(['fast_blade', 'alloy', null])
    // Live feasibility filters after full same-job chain reachability.
    const chain: RecipeProgressionInput[] = [
      { output_type: 'alloy', inputs: { ore: 1, coal: 1, water: 1 }, job: 'FORGER' },
      { output_type: 'blade', inputs: { alloy: 1, wood: 1 }, job: 'FORGER' },
      { output_type: 'plain', inputs: { ore: 1, wood: 1 }, job: 'FORGER' },
    ]
    const blade = (recipe: { output_type: string }) => recipe.output_type === 'blade'
    const pick = (level: number, feasible?: typeof blade) =>
      best_recipe_for_job_progression(chain, 'FORGER', level, () => 1, feasible)?.output_type ?? null
    expect([pick(1, blade), pick(10, blade), pick(100, blade), pick(1)]).toEqual([null, 'blade', null, 'plain'])

    const a = { output_type: 'a', xp: 10, acquisition_seconds: 2, xp_per_second: 5 }
    const b = { output_type: 'b', xp: 15, acquisition_seconds: 3, xp_per_second: 5 }
    expect([a, b].toSorted(compare_recipe_progress)).toEqual([b, a])
    expect(compare_recipe_progress(a, { ...a, output_type: 'z' })).toBeLessThan(0)

    const target = acquisition_target_range(content.items[2]!)
    expect(target).toEqual({ minimum_seconds: 1_200, maximum_seconds: 4_800 })
    expect(acquisition_target_range(content.items[0]!)).toEqual({ minimum_seconds: 75, maximum_seconds: 300 })
    expect(acquisition_average_seconds({ minimum_seconds: 1_500, maximum_seconds: 2_000 })).toBe(1_750)
    const statuses = [
      [1_500, 2_000],
      [100, 200],
      [5_000, 9_000],
    ].map(([minimum_seconds, maximum_seconds]) =>
      acquisition_target_status({ minimum_seconds: minimum_seconds!, maximum_seconds: maximum_seconds! }, target)
    )
    expect([...statuses, acquisition_target_status(null, target)]).toEqual(['within', 'below', 'above', 'unavailable'])
  })
})

describe('Dofus Retro power references', () => {
  test('item power compares authored gear with nearby real donors in the shared rune-weight unit', () => {
    expect(Object.values(DOFUS_GEAR_POWER).flat()).toHaveLength(900)
    expect(Object.values(DOFUS_WEAPON_POWER).flat()).toHaveLength(415)
    expect(Object.keys(DOFUS_WEAPON_POWER)).toEqual(['bow', 'staff', 'daggers', 'sword', 'hammer'])
    // Official item 1363, Bâton Tont'Ata: level 40, 79 rune power, 16–30 earth.
    expect(DOFUS_WEAPON_POWER.staff).toContainEqual([40, 7_900, 230, 300])
    expect(item_budget_envelope(1, 'tool_farmer')).toMatchObject({
      median: 3.75,
      p10: 1,
      p90: 14,
      corpus_max: 138,
      sample_count: 141,
    })
    expect(item_budget_envelope(60, 'tool_farmer')).toMatchObject({ median: 120, p10: 32.5, p90: 230, corpus_max: 400 })
    expect(item_budget_standing(10, 'hat', 80)).toEqual({ percentile: 98, exact_level_power_donors: 1 })
    // Unsupported Retro stats cannot stretch an Ares cohort.
    expect(DOFUS_GEAR_POWER.hat).not.toContainEqual([20, 25_000])
    expect(item_budget_envelope(10, 'hat').corpus_max).toBe(80)
    const weights = [
      ['vitality', 50, 12.5],
      ['wisdom', 60, 180],
      ['action', 1, 100],
      ['critical', 1, 30],
      ['earth_resistance', 1, 4],
      ['unknown_future_stat', 7, 7],
    ] as const
    for (const [stat, maximum, weighted] of weights) expect(item_budget_stat_weight(stat, maximum)).toBe(weighted)
    expect(dofus_weapon_damage_envelope(50, 'sword', 5)).toEqual({
      donor_family: 'sword',
      average_p10: 4.6,
      average_median: 7.8,
      average_p90: 12.2,
      average_max: 19.5,
      maximum_p10: 6.2,
      maximum_median: 9.6,
      maximum_p90: 16.66,
      maximum_max: 28,
      sample_count: 21,
      level_min: 40,
      level_max: 60,
    })
    expect([item_budget_envelope(30, 'spear').comparison, item_budget_envelope(30, 'axe').comparison]).toEqual([
      'staff',
      'hammer',
    ])
    expect(dofus_weapon_damage_envelope(30, 'spear', 4)?.donor_family).toBe('staff')
  })

  test('a hero’s power weighs each rolled stat of its equipped items by its rune weight', () => {
    type SeedItem = Readonly<{ item_type: string; stats?: Readonly<{ max: Readonly<Record<string, number>> }> }>
    const seed_items = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../../seed/content/items.json'), 'utf8')
    ) as readonly SeedItem[]
    const { max } = seed_items.find((item) => item.item_type === 'theban_scrapblade')!.stats!
    const best_roll = {
      stats: Object.fromEntries(Object.entries(max).map(([stat, value]) => [stat, item_stat_center + value])),
    }
    // Theban Scrapblade at its best roll: wisdom 3 (rune weight 3) and intelligence 10 (rune weight 1).
    expect(hero_power([best_roll])).toBe(19)
    // A second item adds its own: vitality weighs a quarter, action points one hundred.
    const ring = { stats: { vitality: item_stat_center + 10, action: item_stat_center + 1 } }
    expect(hero_power([best_roll, ring])).toBe(19 + 3 + 100)
    // A negative roll lowers the power; a bare hero or gear without a roll has none.
    expect(hero_power([{ stats: { strength: item_stat_center - 4, wisdom: item_stat_center + 2 } }])).toBe(2)
    expect([hero_power([]), hero_power([{}, { stats: {} }])]).toEqual([0, 0])
  })

  test('mob power keeps the official grade corpus and reads nearby grades by authored role', () => {
    expect(DOFUS_MOB_GRADES).toHaveLength(4_067)
    const cohorts = [0, 1, 2, 3].map((cohort) => DOFUS_MOB_GRADES.filter((grade) => grade[8] === cohort).length)
    expect(cohorts).toEqual([2_289, 1_418, 285, 75])
    expect(
      DOFUS_MOB_GRADES.every(([level, hp, ap, mp]) => level >= 1 && level <= 255 && hp > 0 && ap >= 0 && mp >= 0)
    ).toBeTrue()
    expect(DOFUS_MOB_GRADES.filter((grade) => grade[9] >= 0 && grade[10] >= 0)).toHaveLength(3_662)
    expect(dofus_mob_power_envelope(40)).toMatchObject({
      cohort: 'regular',
      sample_count: 58,
      level_min: 40,
      level_max: 40,
      hp: { average: 343, p25: 313, median: 350, p75: 350, p90: 400 },
      ap: { median: 7 },
      mp: { median: 5 },
    })
    expect(dofus_mob_power_envelope(40, 'archi').hp).toEqual({
      average: 687,
      p25: 600,
      median: 700,
      p75: 765,
      p90: 800,
    })
    expect([mob_power_cohort_of_role('protector'), mob_power_cohort_of_role('boss')]).toEqual(['regular', 'boss'])
    // Protectors are measured against ordinary monsters of their own level.
    expect(dofus_mob_power_envelope(3, 'protector')).toMatchObject({
      requested_cohort: 'regular',
      level_min: 3,
      damage: { average: 9 },
    })
    expect(dofus_mob_power_envelope(10, 'protector')).toMatchObject({
      cohort: 'regular',
      level_max: 10,
      hp: { average: 73 },
      xp: { average: 1_365 },
      damage: { average: 22 },
    })
  })
})
