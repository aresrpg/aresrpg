// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit proof for the level-up UNLOCK MATH (level_unlocks.js) — the "what did I just unlock" core both
// congrats cards render. Pure functions over the @aresrpg/sdk/jobs SSOT + the chain gather-yield formula;
// no mocks (nothing to stub — the bun mock.module hazard is avoided entirely by keeping the core pure).

import { describe, expect, test } from 'bun:test'
import { craft_recipes, tier_to_level } from '@aresrpg/sdk/jobs'

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

describe('recipes_unlocked_between — recipes a craft job level gain opened (filter logic vs the SSOT)', () => {
  test('returns exactly the job recipes whose unlock level is in (before, after], sorted by level', () => {
    const job = 'armorsmith'
    const before = 1
    const after = 30
    const expected = craft_recipes(job)
      .filter(r => r.level > before && r.level <= after)
      .sort((a, b) => a.level - b.level)
      .map(r => r.id)
    expect(recipes_unlocked_between(job, before, after).map(r => r.id)).toEqual(expected)
  })

  test('every returned recipe genuinely sits inside the crossed band', () => {
    for (const r of recipes_unlocked_between('armorsmith', 5, 40)) {
      expect(r.level).toBeGreaterThan(5)
      expect(r.level).toBeLessThanOrEqual(40)
    }
  })

  test('a gathering job has no recipes', () => {
    expect(recipes_unlocked_between('miner', 1, 100)).toEqual([])
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
  test('gathering job: resources + yield, never recipes', () => {
    const u = job_unlocks('miner', 9, 11)
    expect(u.is_gathering).toBe(true)
    expect(u.recipes).toEqual([])
    expect(u.resources.map(r => r.name)).toEqual(['Quartz']) // tier2 at 10 is in (9,11]
    expect(u.yield.improved).toBe(true) // yield steps 2→3 at level 11
    expect(u.has_any).toBe(true)
  })

  test('craft job: recipes only, no resources / yield', () => {
    const u = job_unlocks('armorsmith', 1, 30)
    expect(u.is_gathering).toBe(false)
    expect(u.resources).toEqual([])
    expect(u.yield.improved).toBe(false)
    expect(u.recipes).toEqual(recipes_unlocked_between('armorsmith', 1, 30))
  })

  test('has_any is false when a level gain opened nothing concrete', () => {
    // miner 12→13: no tier crossed (next is tier3 at 20), yield step is at 16 not 13
    expect(job_unlocks('miner', 12, 13).has_any).toBe(false)
  })
})
