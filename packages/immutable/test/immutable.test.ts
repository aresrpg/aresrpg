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
  craft_job_of,
  craft_required_level,
  craft_xp_from_ingredient_count,
  experience_curve,
  equipment_slot_accepts,
  equipment_categories,
  job_slugs,
  job_level_from_xp,
  is_weapon_category,
  item_budget_envelope,
  item_budget_stat_weight,
  item_budget_stat_weights,
  item_categories,
  item_is_stackable,
  rig_slots,
  level_from_xp,
  pet_max_feeds,
  rune_effect,
  rune_max_apps,
  stat_names,
  weapon_categories,
  xp_for_level,
} from '../src/index.ts'

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
})

describe('immutable vocabularies', () => {
  test('maps the unsigned chain center to the client origin without losing fractional live movement', () => {
    expect(chain_to_client_coordinate(50_000)).toBe(0)
    expect(chain_to_client_coordinate(50_012.25)).toBe(12.25)
    expect(client_to_chain_coordinate(-12.25)).toBe(49_987.75)
  })

  test('the job roster contains exactly the chain-backed 15 slugs', () => {
    expect(job_slugs).toHaveLength(15)
    expect(new Set(job_slugs).size).toBe(15)
    expect(job_slugs.slice(0, 3)).toEqual(['FARMER', 'HERBALIST', 'MINER'])
  })

  test('craft requirements mirror the Move ingredient-count formula', () => {
    expect(craft_required_level(2)).toBe(1)
    expect(craft_required_level(3)).toBe(14)
    expect(craft_required_level(10)).toBe(100)
  })

  test('craft XP depends only on distinct ingredient slots', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map(craft_xp_from_ingredient_count)).toEqual([
      10, 25, 50, 100, 250, 500, 1000, 1000, 1000,
    ])
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
    expect(equipment_slot_accepts('weapon', 'helmet')).toBe(false)
    expect(item_categories).not.toContain('pet_food')
    expect(item_is_stackable('pet_food')).toBe(false)
    expect(item_categories).toContain('rune')
    expect(item_is_stackable('rune')).toBe(true)
  })

  test('craft professions derive from strict item categories and preserve authored fallback categories', () => {
    expect(craft_job_of('helmet')).toBe('ARMORSMITH')
    expect(craft_job_of('staff')).toBe('STAFF_CARVER')
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

describe('Dofus donor-fitted gear budget', () => {
  test('preserves the fitted growth, certified medians, and donor variance from level one', () => {
    expect(item_budget_envelope(1)).toEqual({ median: 2, p10: 1, p90: 5, hard_max: 12 })
    expect(item_budget_envelope(80)).toEqual({ median: 663, p10: 412, p90: 1453, hard_max: 3341 })
    expect(item_budget_envelope(105)).toEqual({ median: 945, p10: 587, p90: 2071, hard_max: 4763 })
    expect(item_budget_envelope(195)).toEqual({ median: 2083, p10: 1294, p90: 4351, hard_max: 7490 })
  })

  test('uses the fixed gear-budget weights, including premium stats', () => {
    expect(Object.keys(item_budget_stat_weights).toSorted()).toEqual([...stat_names].toSorted())
    expect(item_budget_stat_weight('vitality', 50)).toBe(50)
    expect(item_budget_stat_weight('action', 1)).toBe(100)
    expect(item_budget_stat_weight('unknown_future_stat', 7)).toBe(7)
  })
})

describe('Move rune catalog mirror', () => {
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
