// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit proof for the level-up UNLOCK MATH (level_unlocks.js) — the "what did I just unlock" core both
// congrats cards render. Pure functions over the @aresrpg/sdk/jobs job/gather SSOT, the LIVE /v1 crafting
// corpus, and the chain gather-yield formula; no mocks (nothing to stub — the bun mock.module hazard is
// avoided entirely by keeping the core pure).

import { describe, expect, test } from 'bun:test'
import { JOBS, tier_to_level } from '@aresrpg/sdk/jobs'

import { craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'

import {
  worlds_unlocked_between,
  resources_unlocked_between,
  recipes_unlocked_between,
  gather_yield_at,
  yield_improved_between,
  job_unlocks,
} from './level_unlocks.js'

describe('worlds_unlocked_between — worlds whose join gate the level gain crossed', () => {
  const worlds = [
    { label: 'Testlands', required_level: 1 },
    { label: 'Ashen Vale', required_level: 20 },
    { label: 'Frostspire', required_level: 20 },
    { label: 'Emberdeep', required_level: 50 },
  ]

  test('a gain into the band opens exactly the worlds gated inside it (sorted by gate)', () => {
    expect(worlds_unlocked_between(worlds, 19, 20)).toEqual([
      { label: 'Ashen Vale', required_level: 20 },
      { label: 'Frostspire', required_level: 20 },
    ])
  })

  test('a multi-level jump can open several tiers of worlds at once', () => {
    expect(worlds_unlocked_between(worlds, 1, 50).map(w => w.label)).toEqual([
      'Ashen Vale',
      'Frostspire',
      'Emberdeep',
    ])
  })

  test('a world already accessible before the gain is NOT re-announced', () => {
    expect(worlds_unlocked_between(worlds, 20, 21)).toEqual([])
    // Testlands (gate 1) never re-opens on any later level-up
    expect(worlds_unlocked_between(worlds, 30, 60).some(w => w.label === 'Testlands')).toBe(false)
  })

  test('no gain / empty list → no worlds (row omitted)', () => {
    expect(worlds_unlocked_between(worlds, 20, 20)).toEqual([])
    expect(worlds_unlocked_between([], 1, 100)).toEqual([])
    expect(worlds_unlocked_between(undefined, 1, 100)).toEqual([])
  })
})

describe('resources_unlocked_between — gatherables a job level gain opened', () => {
  test('crossing a tier unlock level surfaces that tier resource (miner tier-2 at level 10)', () => {
    const opened = resources_unlocked_between('miner', 9, 10)
    expect(opened.map(r => r.name)).toEqual(['Quartz']) // tier 2 → tier_to_level(2)=10
    expect(opened[0].required_level).toBe(tier_to_level(2))
  })

  test('the base tier (unlock level 1) opens on the very first level', () => {
    expect(resources_unlocked_between('farmer', 0, 1).map(r => r.name)).toEqual(['Wheat'])
  })

  test('a multi-level jump opens every tier crossed, in gate order', () => {
    // miner: tier2 (10) + tier3 (20) both inside (9, 20]
    expect(resources_unlocked_between('miner', 9, 20).map(r => r.tier)).toEqual([2, 3])
  })

  test('no tier crossed → nothing; a craft job never has gatherables', () => {
    expect(resources_unlocked_between('miner', 10, 15)).toEqual([])
    expect(resources_unlocked_between('armorsmith', 1, 100)).toEqual([])
  })
})

// Issue #800 — the panel used to resolve its unlock list through `craft_recipes(job_id)`, the bundled seed
// catalog (packages/sdk/src/{items,recipes}.json), which this repo carries as `{}` BY CONSTRUCTION (the
// content boundary): a job level-up could never announce a recipe, no matter how much crafting content was
// live on chain. It now derives from the SAME live `/v1` projection the Jobs drawer crafts from.
//
// CAPTURED PROVENANCE: the verbatim live armorsmith rows JobsDrawer.test.jsx pins (read from rpc-redis
// 2026-07-25). The two levels differ ON PURPOSE — knowledge gate 26, output item level 151 — because the
// chain gates on `required_level` (`crafting.move`, EUnderLevel) and the old panel gated on the item level.
const ARMORSMITH = JOBS.findIndex(j => j.id === 'armorsmith')
const LIVE_RECIPES = [
  {
    recipe_id: '0xrecipe_feathergilt_visor_crown',
    output_template_id: '0xtpl_feathergilt_visor_crown',
    output_quantity: 1,
    required_job: ARMORSMITH,
    required_level: 26,
    craft_xp: 3448,
    inputs: [{ template_id: '0xtpl_diadem_lattice_crown', quantity: 3 }],
  },
  {
    recipe_id: '0xrecipe_hearthplate_vest',
    output_template_id: '0xtpl_hearthplate_vest',
    output_quantity: 1,
    required_job: ARMORSMITH,
    required_level: 8,
    craft_xp: 410,
    inputs: [{ template_id: '0xtpl_diadem_lattice_crown', quantity: 1 }],
  },
]
const LIVE_ITEMS = [
  {
    template_id: '0xtpl_feathergilt_visor_crown',
    item_type: 'feathergilt_visor_of_silent_court_crown',
    name: 'Feathergilt Visor Crown',
    description: null,
    level: 151,
    category: 'helmet',
    supply: 0,
    last_sale_mist: null,
  },
  {
    template_id: '0xtpl_hearthplate_vest',
    item_type: 'hearthplate_vest',
    name: 'Hearthplate Vest',
    description: null,
    level: 60,
    category: 'chest',
    supply: 0,
    last_sale_mist: null,
  },
  {
    template_id: '0xtpl_diadem_lattice_crown',
    item_type: 'diadem_lattice_crown',
    name: 'Diadem Lattice Crown',
    description: null,
    level: 173,
    category: 'resource',
    supply: 0,
    last_sale_mist: null,
  },
]
const LIVE_ROWS = craft_recipes_for_job(LIVE_RECIPES, LIVE_ITEMS, ARMORSMITH)

describe('recipes_unlocked_between — recipes a craft job level gain opened (live /v1 rows, #800)', () => {
  test('an empty store announces nothing; the SAME gain over the served corpus announces its rows', () => {
    // The empty→populated transition is the whole bug: the bundled root could only ever be the left half.
    expect(recipes_unlocked_between([], 1, 30)).toEqual([])
    expect(recipes_unlocked_between(undefined, 1, 30)).toEqual([])
    expect(recipes_unlocked_between(LIVE_ROWS, 1, 30).map(r => r.recipe_id)).toEqual([
      '0xrecipe_hearthplate_vest',
      '0xrecipe_feathergilt_visor_crown',
    ])
  })

  test('the gate is the CHAIN required_level, never the output item level', () => {
    // The 26-gate recipe outputs a level-151 item: gating on the item level would announce it at 151 (or
    // never), and the chain would have accepted the craft from 26.
    expect(recipes_unlocked_between(LIVE_ROWS, 25, 26).map(r => r.recipe_id)).toEqual([
      '0xrecipe_feathergilt_visor_crown',
    ])
    expect(recipes_unlocked_between(LIVE_ROWS, 150, 151)).toEqual([])
  })

  test('every returned recipe genuinely sits inside the crossed band, sorted by gate', () => {
    const opened = recipes_unlocked_between(LIVE_ROWS, 5, 40)
    expect(opened.map(r => r.required_level)).toEqual([8, 26])
    for (const r of opened) {
      expect(r.required_level).toBeGreaterThan(5)
      expect(r.required_level).toBeLessThanOrEqual(40)
    }
  })

  test('no gain announces nothing', () => {
    expect(recipes_unlocked_between(LIVE_ROWS, 30, 30)).toEqual([])
  })
})

describe('gather_yield_at — chain gather-yield formula (1 + floor((level-required)/5))', () => {
  test('steps up every 5 levels above the tier required level', () => {
    expect(gather_yield_at(1, 1)).toBe(1)
    expect(gather_yield_at(5, 1)).toBe(1)
    expect(gather_yield_at(6, 1)).toBe(2)
    expect(gather_yield_at(10, 1)).toBe(2)
    expect(gather_yield_at(11, 1)).toBe(3)
  })

  test('never underflows below the tier (defensive max 0)', () => {
    expect(gather_yield_at(1, 10)).toBe(1)
  })
})

describe('yield_improved_between — did the per-node harvest actually grow', () => {
  test('true exactly on a 5-level step, reporting the new amount', () => {
    expect(yield_improved_between(5, 6)).toEqual({ improved: true, amount: 2, previous: 1 })
    expect(yield_improved_between(10, 11)).toEqual({ improved: true, amount: 3, previous: 2 })
  })

  test('false on a level that changed nothing (honest — no fake gain)', () => {
    expect(yield_improved_between(6, 7).improved).toBe(false)
    expect(yield_improved_between(1, 5).improved).toBe(false)
  })
})

describe('job_unlocks — the bundle the card renders, split by job category', () => {
  test('gathering job: resources + yield, never recipes (and never a recipe fetch)', () => {
    const u = job_unlocks('miner', 9, 11, { recipes: LIVE_ROWS, loading: true })
    expect(u.is_gathering).toBe(true)
    expect(u.recipes).toEqual([])
    expect(u.recipes_loading).toBe(false)
    expect(u.resources.map(r => r.name)).toEqual(['Quartz']) // tier2 at 10 is in (9,11]
    expect(u.yield.improved).toBe(true) // yield steps 2→3 at level 11
    expect(u.has_any).toBe(true)
  })

  test('craft job: recipes only, no resources / yield', () => {
    const u = job_unlocks('armorsmith', 1, 30, { recipes: LIVE_ROWS })
    expect(u.is_gathering).toBe(false)
    expect(u.resources).toEqual([])
    expect(u.yield.improved).toBe(false)
    expect(u.recipes).toEqual(recipes_unlocked_between(LIVE_ROWS, 1, 30))
  })

  test('an in-flight projection reads as LOADING, never as "this level unlocked nothing"', () => {
    // Cache law: absence is not emptiness. Omitting the section while the read is in flight tells the
    // player their level-up opened no recipe — a claim nothing has established yet.
    const u = job_unlocks('armorsmith', 1, 30, { recipes: [], loading: true })
    expect(u.recipes).toEqual([])
    expect(u.recipes_loading).toBe(true)
    expect(u.has_any).toBe(true)
  })

  test('has_any is false when a level gain opened nothing concrete', () => {
    // miner 12→13: no tier crossed (next is tier3 at 20), yield step is at 16 not 13
    expect(job_unlocks('miner', 12, 13).has_any).toBe(false)
    // A craft job whose settled corpus opened nothing in the band — settled, not in flight.
    expect(job_unlocks('armorsmith', 30, 40, { recipes: LIVE_ROWS }).has_any).toBe(false)
  })
})
