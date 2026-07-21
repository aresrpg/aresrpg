// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK-backed recipe DERIVATION (artisan_craftable_recipes) over the real @aresrpg/sdk/jobs content: the
// per-job level FILTER, the gathering-job exclusion, the recipe-id de-dupe, and the level→name sort. Kept
// separate from commission_logic.test.js (the SDK-free greying core) so that suite stays dependency-light.
//
// Model note: job_level_progress FLOORS at level 1, so every CRAFT job is level 1 even with zero xp — a
// brand-new artisan can already craft the level-1 recipe set. Gathering jobs craft nothing at any level.

import { describe, expect, it } from 'bun:test'
import { JOBS, JOB_CATEGORY, job_xp_for_level } from '@aresrpg/sdk/jobs'

import { artisan_craftable_recipes } from './commission_recipes.js'
import { ITEMS_CATALOG_AVAILABLE } from '../../../../../test_helpers/items_fixture.js'

const CRAFT_JOB = JOBS.find(j => j.category !== JOB_CATEGORY.GATHERING)

// MISSING-ARTIFACT (#117): craft_recipes/recipe_ingredients resolve through the empty items.json
// placeholder — see test_helpers/items_fixture.js.
describe('artisan_craftable_recipes (SDK-backed derivation)', () => {
  it.skipIf(!ITEMS_CATALOG_AVAILABLE)('a level-1 artisan (no xp) already crafts the level-1 recipe set', () => {
    const rows = artisan_craftable_recipes({})
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.level).toBeLessThanOrEqual(1)
  })

  it('gathering jobs contribute nothing — maxing them adds no recipe beyond the craft floor', () => {
    const base = artisan_craftable_recipes({})
    const with_gather = artisan_craftable_recipes({
      farmer: job_xp_for_level(100),
      miner: job_xp_for_level(100),
    })
    expect(with_gather.map(r => r.id).sort()).toEqual(base.map(r => r.id).sort())
  })

  it.skipIf(!ITEMS_CATALOG_AVAILABLE)('a higher craft-job level widens that job’s recipe list; every row is unlockable at its job level', () => {
    const low = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(1) })
    const high = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(100) })
    expect(high.length).toBeGreaterThan(low.length)
    for (const r of high) expect(r.level).toBeLessThanOrEqual(r.artisan_level)
  })

  it('de-dupes by recipe id, sorts by level then name, and stamps each row with its job level', () => {
    const rows = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(100) })
    const ids = rows.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length) // no duplicate recipe ids
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]
      const b = rows[i]
      expect(a.level < b.level || (a.level === b.level && a.name.localeCompare(b.name) <= 0)).toBe(true)
    }
    // The leveled job's OWN recipes carry its level (other jobs default to the level-1 floor).
    for (const r of rows.filter(r => r.job_id === CRAFT_JOB.id)) expect(r.artisan_level).toBe(100)
  })
})
