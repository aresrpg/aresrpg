// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure greying / stock logic. Imports ONLY commission_logic.js — the SDK-free core — so
// the suite is headless-safe, fast, and never couples to the content seed. The SDK-backed derivation
// (commission_recipes.js) is exercised at runtime in the harness, not here.

import { describe, expect, it } from 'bun:test'

import {
  recipe_success_chance,
  owned_from_items,
  commission_recipe_row,
  missing_summary,
  platform_cut_mist,
  artisan_net_mist,
} from './commission_logic.js'

describe('recipe_success_chance (data-driven, 100 default)', () => {
  it('defaults to 100 when the recipe carries no rate (chain truth: craft always succeeds)', () => {
    expect(recipe_success_chance({})).toBe(100)
    expect(recipe_success_chance(null)).toBe(100)
    expect(recipe_success_chance(undefined)).toBe(100)
  })
  it('surfaces an explicit rate, clamped to 0..100', () => {
    expect(recipe_success_chance({ success_chance: 65 })).toBe(65)
    expect(recipe_success_chance({ success_chance: 140 })).toBe(100)
    expect(recipe_success_chance({ success_chance: -5 })).toBe(0)
    expect(recipe_success_chance({ success_chance: 0 })).toBe(0)
  })
})

describe('owned_from_items (bag → owned map, JobsDrawer idiom)', () => {
  it('sums stack amounts per template slug', () => {
    const owned = owned_from_items([
      { item_type: 'oak_log', amount: 3 },
      { item_type: 'oak_log', amount: 2 },
      { item_type: 'iron', amount: 1 },
      { item_type: 'flint' }, // no amount → counts as 1
    ])
    expect(owned).toEqual({ oak_log: 5, iron: 1, flint: 1 })
  })
  it('is empty for missing input and skips items with no item_type', () => {
    expect(owned_from_items(null)).toEqual({})
    expect(owned_from_items(undefined)).toEqual({})
    expect(owned_from_items([{ amount: 4 }])).toEqual({})
  })
})

describe('commission_recipe_row (the greying / stock check)', () => {
  const recipe = { id: 'iron_sword', name: 'Iron Sword', level: 10 }
  const ingredients = [
    { id: 'oak_log', name: 'Oak Log', qty: 3, level: 1, icon: 'oak_log', quality: 'common' },
    { id: 'iron', name: 'Iron', qty: 2, level: 1, icon: 'iron', quality: 'common' },
  ]

  it('is CRAFTABLE (not greyed) when the customer holds every ingredient', () => {
    const row = commission_recipe_row(recipe, ingredients, { oak_log: 3, iron: 2 })
    expect(row.craftable).toBe(true)
    expect(row.has_ingredients).toBe(true)
    expect(row.missing).toEqual([])
    // over-supply is still craftable
    expect(commission_recipe_row(recipe, ingredients, { oak_log: 9, iron: 9 }).craftable).toBe(true)
  })

  it('is GREYED with a single-ingredient missing list when one is short', () => {
    const row = commission_recipe_row(recipe, ingredients, { oak_log: 1, iron: 2 })
    expect(row.craftable).toBe(false)
    expect(row.missing).toEqual([{ id: 'oak_log', name: 'Oak Log', short: 2 }])
    expect(missing_summary(row.missing)).toBe('Oak Log ×2')
  })

  it('greys and lists ALL missing ingredients when the customer holds none', () => {
    const row = commission_recipe_row(recipe, ingredients, {})
    expect(row.craftable).toBe(false)
    expect(missing_summary(row.missing)).toBe('Oak Log ×3, Iron ×2')
  })

  it('surfaces the required artisan level and success chance on the row', () => {
    const row = commission_recipe_row({ ...recipe, success_chance: 80 }, ingredients, { oak_log: 3, iron: 2 })
    expect(row.required_level).toBe(10)
    expect(row.success_chance).toBe(80)
    // per-ingredient have/need for the bill display
    expect(row.bill.map((b) => `${b.have}/${b.need}`)).toEqual(['3/3', '2/2'])
  })

  it('treats an un-seeded recipe (empty bill) as NOT craftable — never silently free', () => {
    const row = commission_recipe_row(recipe, [], { oak_log: 99 })
    expect(row.seeded).toBe(false)
    expect(row.craftable).toBe(false)
    expect(row.missing).toEqual([])
  })
})

describe('missing_summary', () => {
  it('joins name ×short pairs, empty for nothing missing', () => {
    expect(missing_summary([])).toBe('')
    expect(missing_summary(null)).toBe('')
    expect(missing_summary([{ name: 'Iron', short: 1 }, { name: 'Coal', short: 4 }])).toBe('Iron ×1, Coal ×4')
  })
})

describe('platform_cut_mist / artisan_net_mist (10% floor split, mirrors commission.move platform_cut_of)', () => {
  it('the 0.1 SUI floor edge: cut 0.01 SUI, net 0.09 SUI', () => {
    const amount = 100_000_000 // 0.1 SUI
    expect(platform_cut_mist(amount)).toBe(10_000_000) // 0.01 SUI
    expect(artisan_net_mist(amount)).toBe(90_000_000) // 0.09 SUI
  })

  it('dust amounts: sub-10-mist cuts floor to ZERO (the artisan takes the whole dust)', () => {
    expect(platform_cut_mist(1)).toBe(0)
    expect(artisan_net_mist(1)).toBe(1)
    expect(platform_cut_mist(9)).toBe(0)
    expect(artisan_net_mist(9)).toBe(9)
    // first mist where the floor bites
    expect(platform_cut_mist(10)).toBe(1)
    expect(artisan_net_mist(10)).toBe(9)
  })

  it('a non-round amount floors in the platform\'s favor (never rounds up)', () => {
    expect(platform_cut_mist(1_234_567)).toBe(123_456)
    expect(artisan_net_mist(1_234_567)).toBe(1_111_111)
  })

  it('big amounts: exact 10% when evenly divisible', () => {
    const amount = 1_000_000_000_000 // 1,000 SUI
    expect(platform_cut_mist(amount)).toBe(100_000_000_000) // 100 SUI
    expect(artisan_net_mist(amount)).toBe(900_000_000_000) // 900 SUI
  })

  it('cut + net always reconstitutes the gross amount exactly', () => {
    for (const amount of [0, 1, 9, 10, 100_000_000, 1_234_567, 1_000_000_000_000]) {
      expect(platform_cut_mist(amount) + artisan_net_mist(amount)).toBe(amount)
    }
  })

  it('defensive: non-finite / missing input never throws, treats as zero', () => {
    expect(platform_cut_mist(undefined)).toBe(0)
    expect(platform_cut_mist(null)).toBe(0)
    expect(platform_cut_mist(NaN)).toBe(0)
    expect(artisan_net_mist(undefined)).toBe(0)
  })
})
