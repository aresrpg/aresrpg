// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The recipe DERIVATION (artisan_craftable_recipes) over the LIVE /v1 crafting corpus: the per-job level
// FILTER against the chain gate, the gathering-job exclusion, the recipe-id de-dupe, and the gate→name sort.
// Kept separate from commission_logic.test.js (the greying core) so that suite stays dependency-light.
//
// Issue #800 — this used to walk `craft_recipes(job.id)` from @aresrpg/sdk/jobs, i.e.
// packages/sdk/src/{items,recipes}.json, which this repo carries as `{}` BY CONSTRUCTION (the content
// boundary). The artisan commission view therefore had no craftable list and no bill of materials, ever,
// no matter how much crafting content was live on chain — the suite below could only assert it by SKIPPING
// its own subject. It now reads the same `/v1` projection the Jobs drawer crafts from.
//
// Model note: job_level_progress FLOORS at level 1, so every CRAFT job is level 1 even with zero xp — a
// brand-new artisan can already craft the gate-1 recipe set. Gathering jobs craft nothing at any level.

import { describe, expect, it } from 'bun:test'
import { JOBS, JOB_CATEGORY, job_xp_for_level } from '@aresrpg/sdk/jobs'

import { artisan_craftable_recipes } from './commission_recipes.js'

const CRAFT_JOB_INDEX = JOBS.findIndex(j => j.category !== JOB_CATEGORY.GATHERING)
const CRAFT_JOB = JOBS[CRAFT_JOB_INDEX]
const OTHER_CRAFT_INDEX = JOBS.findIndex((j, i) => j.category !== JOB_CATEGORY.GATHERING && i !== CRAFT_JOB_INDEX)
const GATHER_JOB_INDEX = JOBS.findIndex(j => j.category === JOB_CATEGORY.GATHERING)

/** A live `/v1` recipe row (the RpcRecipe wire shape, verbatim). */
const recipe = (recipe_id, required_job, required_level, output_template_id) => ({
  recipe_id,
  output_template_id,
  output_quantity: 1,
  required_job,
  required_level,
  craft_xp: 100,
  inputs: [{ template_id: '0xtpl_ingot', quantity: 2 }],
})

// The gate and the OUTPUT LEVEL differ on every row on purpose: `crafting.move` asserts
// `crafter_level >= required_level` (EUnderLevel), so an artisan filter keyed off the item level is wrong.
const LIVE_RECIPES = [
  recipe('0xrecipe_gate1', CRAFT_JOB_INDEX, 1, '0xtpl_gate1'),
  recipe('0xrecipe_gate40', CRAFT_JOB_INDEX, 40, '0xtpl_gate40'),
  recipe('0xrecipe_other_gate1', OTHER_CRAFT_INDEX, 1, '0xtpl_other_gate1'),
  recipe('0xrecipe_gather', GATHER_JOB_INDEX, 1, '0xtpl_gather'),
]
const item = (template_id, name, level) => ({
  template_id,
  item_type: template_id.replace('0xtpl_', ''),
  name,
  description: null,
  level,
  category: 'resource',
  supply: 0,
  last_sale_mist: null,
})
const LIVE_ITEMS = [
  item('0xtpl_gate1', 'Apprentice Buckler', 90),
  item('0xtpl_gate40', 'Aldermarch Warplate', 12),
  item('0xtpl_other_gate1', 'Beechwood Haft', 30),
  item('0xtpl_gather', 'Gatherable Nonsense', 5),
  item('0xtpl_ingot', 'Iron Ingot', 1),
]

describe('artisan_craftable_recipes (live /v1 derivation, #800)', () => {
  it('an empty store lists nothing; the SAME artisan over the served corpus lists their rows', () => {
    // The empty→populated transition IS the bug: the bundled root could only ever be the left half.
    expect(artisan_craftable_recipes({}, [], [])).toEqual([])
    expect(artisan_craftable_recipes({}, undefined, undefined)).toEqual([])
    expect(artisan_craftable_recipes({}, LIVE_RECIPES, LIVE_ITEMS).map(r => r.recipe_id)).toEqual([
      '0xrecipe_gate1',
      '0xrecipe_other_gate1',
    ])
  })

  it('a level-1 artisan (no xp) already crafts the gate-1 recipe set', () => {
    const rows = artisan_craftable_recipes({}, LIVE_RECIPES, LIVE_ITEMS)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.required_level).toBeLessThanOrEqual(1)
  })

  it('gathering jobs contribute nothing — maxing them adds no recipe beyond the craft floor', () => {
    const base = artisan_craftable_recipes({}, LIVE_RECIPES, LIVE_ITEMS)
    const with_gather = artisan_craftable_recipes(
      { [JOBS[GATHER_JOB_INDEX].id]: job_xp_for_level(100) },
      LIVE_RECIPES,
      LIVE_ITEMS
    )
    expect(with_gather.map(r => r.recipe_id).sort()).toEqual(base.map(r => r.recipe_id).sort())
  })

  it('a higher craft-job level widens that job’s list, gated by the CHAIN level not the item level', () => {
    const low = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(1) }, LIVE_RECIPES, LIVE_ITEMS)
    const high = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(40) }, LIVE_RECIPES, LIVE_ITEMS)
    expect(high.length).toBeGreaterThan(low.length)
    // The gate-40 row outputs a LEVEL-12 item: an item-level filter would have listed it at level 1.
    expect(low.map(r => r.recipe_id)).not.toContain('0xrecipe_gate40')
    expect(high.map(r => r.recipe_id)).toContain('0xrecipe_gate40')
    for (const r of high) expect(r.required_level).toBeLessThanOrEqual(r.artisan_level)
  })

  it('carries the bill of materials ON the row — no second lookup, no second source', () => {
    const [row] = artisan_craftable_recipes({}, LIVE_RECIPES, LIVE_ITEMS)
    expect(row.ingredients).toEqual([
      { id: 'ingot', template_id: '0xtpl_ingot', qty: 2, name: 'Iron Ingot', level: 1 },
    ])
  })

  it('de-dupes by recipe id, sorts by gate then name, and stamps each row with its job level', () => {
    const rows = artisan_craftable_recipes({ [CRAFT_JOB.id]: job_xp_for_level(40) }, LIVE_RECIPES, LIVE_ITEMS)
    const ids = rows.map(r => r.recipe_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]
      const b = rows[i]
      expect(a.required_level < b.required_level || (a.required_level === b.required_level && a.name.localeCompare(b.name) <= 0)).toBe(true)
    }
    // The leveled job's OWN recipes carry its level (other jobs default to the level-1 floor).
    for (const r of rows.filter(r => r.job_id === CRAFT_JOB.id)) expect(r.artisan_level).toBe(40)
  })
})
