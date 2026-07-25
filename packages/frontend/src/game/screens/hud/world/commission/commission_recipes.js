// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The recipe DERIVATION for a commission — kept OUT of commission_logic.js so the pure greying tests import
// no heavy graph. REUSE: recipe + ingredient DATA come from the LIVE `/v1` crafting projection
// (`craft_recipes_for_job`, pages/encyclopedia/recipes.ts) — the SAME one home the JobsDrawer crafts from —
// so a commission lists exactly what the crafting tab crafts. Nothing here computes balance.
//
// Issue #800: this used to walk `craft_recipes` / `recipe_ingredients` from @aresrpg/sdk/jobs, i.e.
// packages/sdk/src/{items,recipes}.json, which this repo carries as `{}` BY CONSTRUCTION (the content
// boundary means content reaches the game only as published chain state). The artisan commission flow
// therefore had no craftable list and no bill of materials, ever — a guaranteed-empty read, not a stale one.

import { JOBS, JOB_CATEGORY, job_level_progress } from '@aresrpg/sdk/jobs'

import { craft_recipes_for_job } from '../../../../../pages/encyclopedia/recipes'

/**
 * @typedef {import('../../../../../pages/encyclopedia/recipes').CraftRecipeRow & {
 *   job_id: string, job_label: string, artisan_level: number
 * }} ArtisanRecipe
 */

/**
 * Every recipe an ARTISAN can craft: for each craft job, the live recipes whose CHAIN gate that artisan's
 * level in that job clears (`crafting.move` asserts `crafter_level >= required_level`, EUnderLevel — never
 * the output item's display level, a different number on real content). `jobs_xp` is the /v1 characters
 * `jobs` map (`{ [job_slug]: total_xp }`); the per-job level derives via `job_level_progress` (the
 * JobsDrawer's exact conversion). `recipes`/`items` are the `/v1/encyclopedia` envelope — absent (the read
 * has not landed) yields [], which the caller must render as LOADING, not as "no recipes".
 *
 * Gathering jobs craft nothing. De-duped by on-chain recipe id and sorted by gate then name. Each row
 * carries its own bill of materials (`ingredients`) — one walk, no second lookup and no second source.
 * @param {Record<string, number> | null | undefined} jobs_xp
 * @param {import('../../../../../rpc/views').RpcRecipe[] | null | undefined} recipes
 * @param {import('../../../../../rpc/views').RpcEncyclopediaItem[] | null | undefined} items
 * @returns {ArtisanRecipe[]}
 */
export function artisan_craftable_recipes(jobs_xp, recipes, items) {
  /** @type {ArtisanRecipe[]} */
  const out = []
  const seen = new Set()
  for (const [job_index, job] of JOBS.entries()) {
    if (job.category === JOB_CATEGORY.GATHERING) continue
    const level = job_level_progress(jobs_xp?.[job.id] ?? 0).level
    for (const recipe of craft_recipes_for_job(recipes, items, job_index)) {
      if (level < recipe.required_level || seen.has(recipe.recipe_id)) continue
      seen.add(recipe.recipe_id)
      out.push({ ...recipe, job_id: job.id, job_label: job.label, artisan_level: level })
    }
  }
  return out.sort((a, b) => a.required_level - b.required_level || a.name.localeCompare(b.name))
}
