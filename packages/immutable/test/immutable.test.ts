// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  chain_to_client_coordinate,
  client_to_chain_coordinate,
  characteristic_names,
  class_names,
  class_spell_shape_errors,
  class_spell_unlocks,
  craft_job_of,
  craft_max_ingredients,
  craft_required_level,
  craft_batch_limit,
  craft_xp_at_level,
  craft_xp_from_ingredient_count,
  dofus_weapon_damage_envelope,
  experience_curve,
  experience_progress,
  equipment_slot_accepts,
  equipment_categories,
  gatherable_catalog,
  gatherable_of,
  gather_time_ms,
  job_slugs,
  job_level_from_xp,
  is_weapon_category,
  item_budget_envelope,
  item_budget_standing,
  item_budget_stat_weight,
  item_budget_stat_weights,
  item_categories,
  item_is_stackable,
  rig_slots,
  level_from_xp,
  model_variant_identity,
  pet_max_feeds,
  protector_level_range,
  rune_effect,
  rune_unit_weight,
  rune_weight_scale,
  rune_max_apps,
  stat_names,
  weapon_categories,
  xp_for_level,
} from '../src/index.ts'
import { DOFUS_GEAR_POWER, DOFUS_WEAPON_POWER } from '../src/dofus_item_power_corpus.gen.ts'
import { DOFUS_MOB_GRADES } from '../src/dofus_mob_power_corpus.gen.ts'
import { dofus_mob_power_envelope, mob_power_cohort_of_role } from '../src/mob_power.ts'

describe('chain-mirrored experience curve', () => {
  test('spot values match experience.move at low, middle, and cap levels', () => {
    expect(experience_curve).toHaveLength(201)
    expect(job_level_from_xp(50)).toBe(2)
    expect(job_level_from_xp(581_687)).toBe(100)
    expect(xp_for_level(1)).toBe(0)
    expect(xp_for_level(2)).toBe(110)
    expect(xp_for_level(20)).toBe(171_000)
    expect(xp_for_level(50)).toBe(5_350_000)
    expect(xp_for_level(100)).toBe(95_886_000)
    expect(xp_for_level(190)).toBe(2_054_975_000)
    expect(xp_for_level(200)).toBe(7_407_232_000)
  })

  test('level lookup floors between thresholds and clamps at level 200', () => {
    expect(level_from_xp(0)).toBe(1)
    expect(level_from_xp(109)).toBe(1)
    expect(level_from_xp(110)).toBe(2)
    expect(level_from_xp(95_885_999)).toBe(99)
    expect(level_from_xp(95_886_000)).toBe(100)
    expect(level_from_xp(Number.MAX_SAFE_INTEGER)).toBe(200)
  })

  test('progress reports the current level slice and fills at the cap', () => {
    expect(experience_progress(380)).toEqual({ level: 2, into: 270, span: 540, percent: 50 })
    expect(experience_progress(7_407_232_000)).toEqual({ level: 200, into: 0, span: 0, percent: 100 })
  })
})

test('gather time mirrors the 12s to 2s chain root', () => {
  expect(gather_time_ms(1)).toBe(12_000)
  expect(gather_time_ms(100)).toBe(2_000)
  expect(gather_time_ms(200)).toBe(2_000)
})

describe('immutable vocabularies', () => {
  test('maps the unsigned chain center to the client origin without losing fractional live movement', () => {
    expect(chain_to_client_coordinate(50_000)).toBe(0)
    expect(chain_to_client_coordinate(50_012.25)).toBe(12.25)
    expect(client_to_chain_coordinate(-12.25)).toBe(49_987.75)
  })

  test('the job roster contains exactly the chain-backed 11 slugs', () => {
    expect(job_slugs).toHaveLength(11)
    expect(new Set(job_slugs).size).toBe(11)
    expect(job_slugs.slice(0, 3)).toEqual(['FARMER', 'HERBALIST', 'MINER'])
  })

  test('the immutable gatherable catalog owns job, tier, protector, and rare identity', () => {
    expect(gatherable_catalog).toHaveLength(33)
    expect(new Set(gatherable_catalog.map(({ item_type }) => item_type)).size).toBe(33)
    expect(
      ['FARMER', 'HERBALIST', 'MINER'].map((job) =>
        gatherable_catalog.filter((row) => row.job === job).map(({ tier }) => tier)
      )
    ).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ])
    expect(gatherable_of('wheat')).toEqual({
      item_type: 'wheat',
      job: 'FARMER',
      tier: 1,
      protector: 'protector_wheat_bricheton',
      rare_item_type: 'golden_wheat',
    })
    expect(gatherable_of('golden_wheat')).toBeNull()
  })

  test('protector levels use fixed introductory bands then follow resource level', () => {
    expect(protector_level_range(1, 80)).toEqual({ level_min: 1, level_max: 5 })
    expect(protector_level_range(2, 80)).toEqual({ level_min: 8, level_max: 12 })
    expect(protector_level_range(3, 80)).toEqual({ level_min: 15, level_max: 25 })
    expect(protector_level_range(4, 30)).toEqual({ level_min: 20, level_max: 40 })
    expect(protector_level_range(11, 75)).toEqual({ level_min: 65, level_max: 85 })
  })

  test('model variants use an explicit separator without confusing underscores in exact models', () => {
    const models = ['aragne', 'cro', 'cro_wani']
    expect(model_variant_identity('aragne__fire', models)).toEqual({ basename: 'aragne', variant: 'fire' })
    expect(model_variant_identity('cro_wani__white', models)).toEqual({ basename: 'cro_wani', variant: 'white' })
    expect(model_variant_identity('cro_wani', models)).toEqual({ basename: 'cro_wani', variant: null })
    expect(model_variant_identity('cro_wani_white', models)).toBeNull()
    expect(model_variant_identity('missing__fire', models)).toBeNull()
  })

  test('craft requirements mirror the Move ingredient-count formula', () => {
    expect(craft_max_ingredients).toBe(8)
    expect([2, 3, 4, 5, 6, 7, 8].map(craft_required_level)).toEqual([1, 10, 20, 40, 60, 80, 100])
  })

  test('base craft XP depends only on distinct ingredient slots', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(craft_xp_from_ingredient_count)).toEqual([10, 25, 50, 100, 250, 500, 1000])
  })

  test('obsolete recipes stop granting XP at Retro slot boundaries', () => {
    expect(craft_xp_at_level(2, 59)).toBe(10)
    expect(craft_xp_at_level(2, 60)).toBe(0)
    expect(craft_xp_at_level(3, 79)).toBe(25)
    expect(craft_xp_at_level(3, 80)).toBe(0)
    expect(craft_xp_at_level(4, 99)).toBe(50)
    expect(craft_xp_at_level(4, 100)).toBe(0)
    expect(craft_xp_at_level(5, 100)).toBe(100)
  })

  test('pet power mirrors the Move feed cap', () => {
    expect(pet_max_feeds).toBe(60)
  })

  test('class and stat vocabularies preserve their Move source order', () => {
    expect(class_names).toHaveLength(12)
    expect(class_names[0]).toBe('shugo')
    expect(class_names.at(-1)).toBe('shusen')
    expect(stat_names).toHaveLength(15)
    expect(stat_names.slice(0, 6)).toEqual([...characteristic_names])
  })

  test('item categories own the one weapon vocabulary used by equipment', () => {
    expect(new Set(item_categories).size).toBe(item_categories.length)
    expect(item_categories.slice(0, equipment_categories.length)).toEqual([...equipment_categories])
    expect(item_categories.filter(is_weapon_category)).toEqual([...weapon_categories])
    expect(weapon_categories.every((category) => equipment_slot_accepts('weapon', category))).toBe(true)
    expect(rig_slots).toContain('tool')
    expect(equipment_slot_accepts('tool', 'tool_miner')).toBe(true)
    expect(equipment_slot_accepts('weapon', 'hat')).toBe(false)
    expect(item_categories).not.toContain('pet_food')
    expect(item_is_stackable('pet_food')).toBe(false)
    expect(item_categories).toContain('rune')
    expect(item_is_stackable('rune')).toBe(true)
    expect(item_is_stackable('key')).toBe(true)
  })

  test('craft professions derive from strict item categories and preserve authored fallback categories', () => {
    expect(craft_job_of('hat')).toBe('TAILOR')
    expect(craft_job_of('spear')).toBe('CARVER')
    expect(craft_job_of('sword')).toBe('FORGER')
    expect(craft_job_of('key')).toBe('HANDYMAN')
    expect(craft_job_of('consumable')).toBeNull()
    expect(craft_job_of('resource')).toBeNull()
  })

  test('craft professions match every Move category branch', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../move-math/sources/content_rules.move'), 'utf8')
    const body = source.match(/public fun craft_job_of[\s\S]*?\n}/)?.[0]
    expect(body).toBeDefined()
    const move_jobs = new Map<string, string>()
    for (const branch of body!.matchAll(/(?:if|else if) \((.*?)\) option::some\(b"([A-Z_]+)"/gs))
      for (const category of branch[1]!.matchAll(/b"([a-z_]+)"/g)) move_jobs.set(category[1]!, branch[2]!)

    expect(item_categories.map((category) => [category, craft_job_of(category)] as const)).toEqual(
      item_categories.map((category) => [category, move_jobs.get(category) ?? null] as const)
    )
  })
})

test('craft batch caps follow output object cost', () => {
  expect(craft_batch_limit('resource')).toBe(1_000)
  expect(craft_batch_limit('hat')).toBe(1)
  const math = readFileSync(resolve(import.meta.dir, '../../move-math/sources/craft_batch.move'), 'utf8')
  const game = readFileSync(resolve(import.meta.dir, '../../move/sources/crafting.move'), 'utf8')
  expect(math).toContain('MAX_STACKABLE_ATTEMPTS: u16 = 1_000')
  expect(math).toContain('MAX_UNIQUE_ATTEMPTS: u16 = 1')
  expect(game).toContain('craft_batch::shape(')
})

describe('Dofus Retro item power', () => {
  test('ships the complete anonymous projection extracted from the official client', () => {
    expect(Object.values(DOFUS_GEAR_POWER).flat()).toHaveLength(900)
    expect(Object.values(DOFUS_WEAPON_POWER).flat()).toHaveLength(353)
  })

  test('uses nearby real Retro donors instead of a fitted level curve', () => {
    expect(item_budget_envelope(1, 'tool_farmer')).toMatchObject({
      median: 3.75,
      p10: 1,
      p90: 14,
      corpus_max: 138,
      sample_count: 141,
    })
    expect(item_budget_envelope(60, 'tool_farmer')).toMatchObject({
      median: 120,
      p10: 32.5,
      p90: 230,
      corpus_max: 400,
      sample_count: 141,
    })
  })

  test('positions an authored maximum against donor maximums from that same cohort', () => {
    expect(item_budget_standing(10, 'hat', 80)).toEqual({
      percentile: 98,
      exact_level_power_donors: 1,
    })
  })

  test('unsupported Retro stats cannot stretch an Ares comparison cohort', () => {
    expect(DOFUS_GEAR_POWER.hat).not.toContainEqual([20, 25_000])
    expect(item_budget_envelope(10, 'hat').corpus_max).toBe(80)
  })

  test('uses the exact shared Retro rune weights', () => {
    expect(Object.keys(item_budget_stat_weights).toSorted()).toEqual([...stat_names].toSorted())
    expect(item_budget_stat_weight('vitality', 50)).toBe(12.5)
    expect(item_budget_stat_weight('wisdom', 60)).toBe(180)
    expect(item_budget_stat_weight('action', 1)).toBe(100)
    expect(item_budget_stat_weight('critical', 1)).toBe(30)
    expect(item_budget_stat_weight('earth_resistance', 1)).toBe(4)
    expect(item_budget_stat_weight('unknown_future_stat', 7)).toBe(7)
  })

  test('keeps weapon output separate and compares damage per AP by family', () => {
    expect(dofus_weapon_damage_envelope(50, 'sword')).toEqual({
      average_p10: 2.3,
      average_median: 3.9,
      average_p90: 6.1,
      average_max: 9.75,
      maximum_p10: 3.1,
      maximum_median: 4.8,
      maximum_p90: 8.33,
      maximum_max: 14,
      sample_count: 21,
      level_min: 40,
      level_max: 60,
    })
  })
})

describe('Dofus Retro mob power', () => {
  test('keeps the anonymous official grade corpus and its four cohorts intact', () => {
    expect(DOFUS_MOB_GRADES).toHaveLength(4_067)
    expect(
      Object.fromEntries(
        [0, 1, 2, 3].map((cohort) => [
          cohort,
          DOFUS_MOB_GRADES.filter(([, , , , , , , , candidate]) => candidate === cohort).length,
        ])
      )
    ).toEqual({ 0: 2_289, 1: 1_418, 2: 285, 3: 75 })
    expect(
      DOFUS_MOB_GRADES.every(([level, hp, ap, mp]) => level >= 1 && level <= 255 && hp > 0 && ap >= 0 && mp >= 0)
    ).toBeTrue()
    expect(DOFUS_MOB_GRADES.filter(([, , , , , , , , , xp, damage]) => xp >= 0 && damage >= 0)).toHaveLength(3_662)
  })

  test('uses nearby real grades and the authored role cohort', () => {
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
    expect(mob_power_cohort_of_role('protector')).toBe('regular')
    expect(mob_power_cohort_of_role('boss')).toBe('boss')
  })

  test('uses ordinary same-level monsters for protector references', () => {
    expect(dofus_mob_power_envelope(3, 'protector')).toMatchObject({
      requested_cohort: 'regular',
      cohort: 'regular',
      level_min: 3,
      level_max: 3,
      damage: { average: 9 },
    })
    expect(dofus_mob_power_envelope(10, 'protector')).toMatchObject({
      requested_cohort: 'regular',
      cohort: 'regular',
      level_min: 10,
      level_max: 10,
      hp: { average: 73 },
      xp: { average: 1_365 },
      damage: { average: 22 },
    })
  })
})

describe('Move rune catalog mirror', () => {
  test('mirrors the exact Retro unit weights and scale', () => {
    expect(rune_weight_scale).toBe(20)
    expect(stat_names.map(rune_unit_weight)).toEqual([0.25, 3, 1, 1, 1, 1, 51, 90, 100, 30, 20, 4, 4, 4, 4])
    const source = readFileSync(resolve(import.meta.dir, '../../move-math/sources/rune_catalog.move'), 'utf8')
    const move_scale = Number(/const WEIGHT_SCALE: u64 = (\d+)/u.exec(source)?.[1])
    const move_weights = /const UNIT_WEIGHTS: vector<u64> = vector\[([^\]]+)\]/u
      .exec(source)?.[1]
      ?.split(',')
      .map((value) => Number(value.trim().replaceAll('_', '')))

    expect(move_scale).toBe(rune_weight_scale)
    expect(move_weights).toEqual(stat_names.map((stat) => rune_unit_weight(stat) * rune_weight_scale))
  })

  test('projects every Move tier amount without a second frontend table', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../move-math/sources/rune_catalog.move'), 'utf8')
    const move_amounts = (name: string): readonly number[] => {
      const body = new RegExp(`const ${name}: vector<u64> = vector\\[([^\\]]+)\\]`).exec(source)?.[1]
      expect(body).toBeDefined()
      return body!.split(',').map((value) => Number(value.trim()))
    }

    for (const [tier, constant] of [
      ['ba', 'BA_AMOUNT'],
      ['pa', 'PA_AMOUNT'],
      ['ra', 'RA_AMOUNT'],
    ] as const)
      expect(stat_names.map((stat) => rune_effect(`rune_${stat}_${tier}`)?.amount ?? 0)).toEqual(move_amounts(constant))

    expect(rune_effect('rune_strength_ra')).toEqual({ stat: 'strength', tier: 'ra', amount: 10 })
    expect(rune_effect('rune_range_pa')).toBeNull()
  })

  test('mirrors the Move per-item application caps exactly', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../move-math/sources/rune_catalog.move'), 'utf8')
    const body = /const MAX_APPS: vector<u64> = vector\[([^\]]+)\]/.exec(source)?.[1]
    expect(body).toBeDefined()
    const move_caps = body!.split(',').map((value) => Number(value.trim()))
    expect(stat_names.map((stat) => rune_max_apps(stat))).toEqual(move_caps)
  })
})

describe('the class spell law', () => {
  const ladder_for = (classe: string) =>
    class_spell_unlocks.map((unlock_level, i) => ({ name: `${classe}_${i}`, classe, unlock_level }))
  const full_corpus = () => class_names.flatMap((classe) => ladder_for(classe))

  test('the exact ladder for every class passes', () => {
    expect(class_spell_shape_errors(full_corpus())).toEqual([])
  })

  test('an extra spell, a missing slot, or a duplicated level each name their class', () => {
    const extra = [...full_corpus(), { name: 'one_too_many', classe: 'senshi', unlock_level: 50 }]
    expect(class_spell_shape_errors(extra)).toEqual(['senshi has 21 spells; the law is exactly 20'])

    const swapped = full_corpus().map((spell) => (spell.name === 'mori_3' ? { ...spell, unlock_level: 90 } : spell))
    expect(class_spell_shape_errors(swapped)).toEqual([
      'mori breaks the unlock ladder — too many at level 90; none at level 3',
    ])
  })
})
