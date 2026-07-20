// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SDK-backed recipe derivation for a commission — kept OUT of commission_logic.js so the pure greying tests
// import no heavy graph. REUSE: recipe + ingredient DATA come straight from @aresrpg/sdk/jobs
// (`craft_recipes` / `recipe_ingredients` / `job_level_progress`) — the SAME SSOT the JobsDrawer renders — so
// a commission lists exactly what the crafting tab crafts. Nothing here computes balance.

import { JOBS, JOB_CATEGORY, craft_recipes, recipe_ingredients, job_level_progress } from '@aresrpg/sdk/jobs'

/**
 * @typedef {import('@aresrpg/sdk/jobs').CraftRecipe & {
 *   job_id: string, job_label: string, artisan_level: number
 * }} ArtisanRecipe
 */

/**
 * Every recipe an ARTISAN can craft: for each craft job, the recipes at/below the artisan's level in that
 * job. `jobs_xp` is the /v1 characters `jobs` map (`{ [job_slug]: total_xp }` — the shape landed today); the
 * per-job level derives via `job_level_progress` (the JobsDrawer's exact conversion). Gathering jobs craft
 * nothing. De-duped by recipe id (a recipe belongs to one job) and sorted by level then name.
 * @param {Record<string, number> | null | undefined} jobs_xp
 * @returns {ArtisanRecipe[]}
 */
export function artisan_craftable_recipes(jobs_xp) {
  /** @type {ArtisanRecipe[]} */
  const out = []
  const seen = new Set()
  for (const job of JOBS) {
    if (job.category === JOB_CATEGORY.GATHERING) continue
    const level = job_level_progress(jobs_xp?.[job.id] ?? 0).level
    for (const recipe of craft_recipes(job.id)) {
      if (level < recipe.level || seen.has(recipe.id)) continue
      seen.add(recipe.id)
      out.push({ ...recipe, job_id: job.id, job_label: job.label, artisan_level: level })
    }
  }
  return out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

/** The bill of materials for a recipe id — a thin re-export so views import one commission module. */
export { recipe_ingredients }
