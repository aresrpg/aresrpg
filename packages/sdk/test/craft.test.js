// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Crafting math + affordability — the shared SSOT both the server (queue timer enforcement) and the
// client (toast estimate + ingredient GREEN/ORANGE rows) consume. The duration lerp is pure integer
// math, so the client's estimate must equal the server's wall-clock enforcement exactly.

import { test, expect } from 'bun:test'

import {
  craft_duration_ms,
  craft_affordability,
  craft_job_for_category,
  craft_success_percent,
  craft_success_rate_bp,
  job_for_recipe,
  CRAFT_MS_AT_MIN_LEVEL,
  CRAFT_MS_AT_MAX_LEVEL,
  CRAFT_SUCCESS_BP_AT_LEVEL_1,
  CRAFT_SUCCESS_BP_CAP,
  JOB_MAX_LEVEL,
  recipe_ingredients,
  craft_recipes,
} from '../src/jobs.js'
import ITEMS_DATA from '../src/items.json' with { type: 'json' }

// MISSING-ARTIFACT (#96): packages/sdk/src/items.json ships as an empty `{}` placeholder in this public
// repo — the real item catalog is authored+transformed by the content pipeline (private repo,
// item_catalog_transform). craft_recipes()/recipe_ingredients() resolve through items.json, so tests
// asserting real seeded recipes cannot hold against an empty catalog.
const ITEMS_CATALOG_AVAILABLE = Object.keys(ITEMS_DATA).length > 0

test('craft_duration_ms hits the designed endpoints: 1.0s @ lvl1, 0.1s @ max', () => {
  expect(craft_duration_ms(1)).toBe(CRAFT_MS_AT_MIN_LEVEL)
  expect(craft_duration_ms(JOB_MAX_LEVEL)).toBe(CRAFT_MS_AT_MAX_LEVEL)
})

test('craft_duration_ms is monotonically faster as level rises', () => {
  let prev = Infinity
  for (let lvl = 1; lvl <= JOB_MAX_LEVEL; lvl++) {
    const ms = craft_duration_ms(lvl)
    expect(ms).toBeLessThanOrEqual(prev)
    expect(Number.isInteger(ms)).toBe(true)
    prev = ms
  }
})

test('craft_duration_ms clamps out-of-range levels', () => {
  expect(craft_duration_ms(0)).toBe(CRAFT_MS_AT_MIN_LEVEL)
  expect(craft_duration_ms(-5)).toBe(CRAFT_MS_AT_MIN_LEVEL)
  expect(craft_duration_ms(9999)).toBe(CRAFT_MS_AT_MAX_LEVEL)
})

test('craft_duration_ms is deterministic (same input -> same output)', () => {
  for (const lvl of [1, 7, 33, 50, 88, 100])
    expect(craft_duration_ms(lvl)).toBe(craft_duration_ms(lvl))
})

test.skipIf(!ITEMS_CATALOG_AVAILABLE)('craft_affordability marks rows enough/short and flags affordability for the count', () => {
  // pick a real seeded recipe with at least one ingredient
  const [recipe_id] = craft_recipes('sword_smith')
    .map(r => r.id)
    .filter(id => recipe_ingredients(id).length > 0)
  expect(recipe_id).toBeTruthy()
  const ings = recipe_ingredients(recipe_id)
  const [first] = ings

  // own exactly enough of the first ingredient for 1 craft, none of the rest -> short overall
  const owned = { [first.id]: first.qty }
  const one = craft_affordability(recipe_id, owned, 1)
  expect(one).not.toBeNull()
  expect(one.rows.find(r => r.id === first.id).enough).toBe(true)
  if (ings.length > 1) expect(one.affordable).toBe(false)

  // own >= all ingredients for 2 crafts -> affordable
  const rich = Object.fromEntries(ings.map(({ id, qty }) => [id, qty * 2]))
  const two = craft_affordability(recipe_id, rich, 2)
  expect(two.affordable).toBe(true)
  // doubling the count doubles the need
  const need_one = craft_affordability(recipe_id, rich, 1).rows[0].need
  expect(two.rows[0].need).toBe(need_one * 2)
})

test('craft_affordability returns null for an item with no seeded recipe', () => {
  expect(craft_affordability('__definitely_not_a_recipe__', {}, 1)).toBeNull()
})

test('craft_job_for_category resolves a covering craft job (and null for an uncovered category)', () => {
  expect(craft_job_for_category('sword')?.id).toBe('sword_smith')
  expect(craft_job_for_category('resource')).toBeNull()
})

// ── Consumable/utility jobs (alchemist/baker/handyman) — they have NO ItemCategory coverage in Job.java,
// so their recipes come from the explicit recipe->job map (job_crafts.json). These lock in c044/c045: the
// 3 jobs were DEAD (craft_recipes returned []) before the map + the handyman covers fix.
test.skipIf(!ITEMS_CATALOG_AVAILABLE)('the consumable/utility jobs now expose their real recipes (were empty)', () => {
  for (const job of ['alchemist', 'baker', 'handyman']) {
    const recipes = craft_recipes(job)
    expect(recipes.length).toBeGreaterThan(0)
    // every listed recipe is a real seeded item with a name + a level
    for (const r of recipes) {
      expect(typeof r.name).toBe('string')
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.level).toBeGreaterThanOrEqual(1)
    }
  }
})

test('handyman covers the real gathering-tool categories (Job.java runeCategories)', () => {
  // tools = TOOL_HERBALIST/TOOL_PAYSAN/TOOL_MINER (not the non-existent 'tool' string).
  expect(craft_job_for_category('tool_herbalist')?.id).toBe('handyman')
  expect(craft_job_for_category('tool_paysan')?.id).toBe('handyman')
  expect(craft_job_for_category('tool_miner')?.id).toBe('handyman')
})

test('job_for_recipe resolves a recipe to its OWNING job (explicit map first, then category)', () => {
  // explicit recipe->job map: consumable/resource products a category alone cannot disambiguate
  expect(job_for_recipe('minor_healing_brew', 'consumable')?.id).toBe(
    'alchemist',
  )
  expect(job_for_recipe('barley_bread', 'consumable')?.id).toBe('baker')
  expect(job_for_recipe('phacochere_key', 'consumable')?.id).toBe('handyman')
  // category fall-through for gear/weapon jobs (no explicit entry)
  expect(job_for_recipe('__any_longsword__', 'longsword')?.id).toBe(
    'sword_smith',
  )
  // un-owned (gathering-only / drop-only): null
  expect(job_for_recipe('__not_a_recipe__', 'resource')).toBeNull()
  expect(job_for_recipe('__not_a_recipe__')).toBeNull()
})

test.skipIf(!ITEMS_CATALOG_AVAILABLE)('every explicitly-mapped recipe is listed by exactly its owning job', () => {
  // round-trip: a consumable product appears in its job's craft_recipes and not the other consumable jobs.
  const owner = job_for_recipe('minor_healing_brew', 'consumable')?.id
  expect(owner).toBe('alchemist')
  const ids = id => new Set(craft_recipes(id).map(r => r.id))
  expect(ids('alchemist').has('minor_healing_brew')).toBe(true)
  expect(ids('baker').has('minor_healing_brew')).toBe(false)
  expect(ids('handyman').has('minor_healing_brew')).toBe(false)
})

// The success roll (#2034) — the mirror of crafting.move's y91, which `y20` compares a u64 in [0,9999]
// against. It lived in the frontend until #2052; its y21/y92 siblings were already here.
test('craft_success_rate_bp: 50% at job level 1, +0.5%/level, capped at 99%', () => {
  // crafting.move:409 — y91(level) = min(9900, 5000 + (level-1) * 50) basis points.
  expect(craft_success_rate_bp(1)).toBe(CRAFT_SUCCESS_BP_AT_LEVEL_1)
  expect(craft_success_rate_bp(1)).toBe(5000)
  expect(craft_success_rate_bp(2)).toBe(5050)
  expect(craft_success_rate_bp(50)).toBe(7450)
  expect(craft_success_rate_bp(99)).toBe(9900)
  expect(craft_success_rate_bp(100)).toBe(CRAFT_SUCCESS_BP_CAP)
})

test('craft_success_rate_bp: a level below 1 or an unreadable level clamps to the level-1 floor', () => {
  expect(craft_success_rate_bp(0)).toBe(5000)
  expect(craft_success_rate_bp(-3)).toBe(5000)
  expect(craft_success_rate_bp(Number.NaN)).toBe(5000)
})

test('craft_success_percent keeps the half-point step the chain actually rolls', () => {
  expect(craft_success_percent(1)).toBe(50)
  expect(craft_success_percent(2)).toBe(50.5)
  expect(craft_success_percent(100)).toBe(99)
})
