// LEVEL-UP UNLOCK MATH — the pure "what did I just unlock" computations for the two congrats cards
// (LevelUp.jsx = character, JobLevelUp.jsx = job). Every function is a pure transform over plain data
// (no I/O, no React) so the unlock logic is unit-tested in isolation (level_unlocks.test.js). Content +
// formulas are the @aresrpg/sdk/jobs SSOT (the SAME tables the JobsDrawer renders) and the chain's own
// gather-yield formula — nothing here invents a gain (honest-UI law: show only real unlocks).

import {
  GATHER_RESOURCES,
  craft_recipes,
  tier_to_level,
  get_job,
  JOB_CATEGORY,
} from '@aresrpg/sdk/jobs'

/**
 * CHARACTER — the worlds a level gain just made accessible. A world gates on-chain on `required_level`
 * (world.move `required_level` → zones.move join asserts `character level >= required_level`), so a world
 * is "newly unlocked" exactly when its `required_level` sits in the crossed band `(before, after]`. Sorted
 * by required_level ascending. Returns [] when nothing new opened (the card omits the row entirely).
 * @param {readonly { label: string, required_level: number }[]} worlds  every seeded world + its gate
 * @param {number} before  character level BEFORE the gain
 * @param {number} after   character level AFTER the gain
 * @returns {{ label: string, required_level: number }[]}
 */
export function worlds_unlocked_between(worlds, before, after) {
  if (after <= before) return []
  return (worlds ?? [])
    .filter(w => {
      const req = Number(w?.required_level ?? 0)
      return req > before && req <= after
    })
    .map(w => ({ label: String(w.label ?? ''), required_level: Number(w.required_level ?? 0) }))
    .sort((a, b) => a.required_level - b.required_level)
}

/**
 * JOB (gathering) — the gatherable resources a job level gain just unlocked. Each tier unlocks at
 * `tier_to_level(tier)`; a resource is newly available when that unlock level is in `(before, after]`.
 * Returns [] for a craft job (no gatherables) or when no tier crossed.
 * @param {string} job_id
 * @param {number} before  job level BEFORE the gain
 * @param {number} after   job level AFTER the gain
 * @returns {{ id: string, name: string, tier: number, icon: string, required_level: number }[]}
 */
export function resources_unlocked_between(job_id, before, after) {
  if (after <= before) return []
  const resources = GATHER_RESOURCES[job_id] ?? []
  return resources
    .map(r => ({ ...r, required_level: tier_to_level(r.tier) }))
    .filter(r => r.required_level > before && r.required_level <= after)
    .sort((a, b) => a.required_level - b.required_level)
}

/**
 * JOB (craft) — the recipes a job level gain just unlocked. A recipe unlocks when the job level reaches the
 * recipe item's own level (JobsDrawer gates `level >= recipe.level`), so it's newly unlocked when that level
 * is in `(before, after]`. Returns [] for a gathering job (craft_recipes is empty) or when none crossed.
 * @param {string} job_id
 * @param {number} before
 * @param {number} after
 * @returns {import('@aresrpg/sdk/jobs').CraftRecipe[]}
 */
export function recipes_unlocked_between(job_id, before, after) {
  if (after <= before) return []
  return craft_recipes(job_id)
    .filter(r => r.level > before && r.level <= after)
    .sort((a, b) => a.level - b.level)
}

/**
 * Chain-accurate gather yield at a given job level for a tier of `required` unlock level — mirrors
 * gathering.move `gather_yield`: `1 + (job_level − required) / YIELD_BONUS_DIV * YIELD_BOOST` with
 * YIELD_BONUS_DIV=5, YIELD_BOOST=1 (integer floor). The caller guarantees level >= required (a tier the
 * job has unlocked); `Math.max(0, …)` keeps it honest for a below-tier query. This is what the chain
 * actually MINTS per node — not the SDK's display range — so the card's "better harvests" claim is true.
 * @param {number} level
 * @param {number} required
 * @returns {number}
 */
export function gather_yield_at(level, required) {
  return 1 + Math.floor(Math.max(0, level - required) / 5)
}

/**
 * JOB (gathering) — did the per-node harvest yield actually grow over this level gain? The best (highest)
 * yield always sits on the base tier (required_level 1, always unlocked — the smaller the required level,
 * the larger `level − required`), so the base-tier yield is the honest representative of "better gather
 * amounts". Reports the improvement ONLY when the chain yield genuinely stepped up (every 5 levels above
 * the tier), never on a level that changed nothing.
 * @param {number} before  job level BEFORE the gain
 * @param {number} after   job level AFTER the gain
 * @returns {{ improved: boolean, amount: number, previous: number }}
 */
export function yield_improved_between(before, after) {
  const previous = gather_yield_at(before, 1)
  const amount = gather_yield_at(after, 1)
  return { improved: amount > previous, amount, previous }
}

/**
 * JOB — the full unlock bundle a job level gain surfaces, resolved by the job's category (gathering →
 * resources + yield; craft → recipes). One call the card renders; `has_any` is the "is there anything to
 * celebrate beyond the level number" flag. Pure — the card adds no logic.
 * @param {string} job_id
 * @param {number} before
 * @param {number} after
 * @returns {{
 *   is_gathering: boolean,
 *   resources: ReturnType<typeof resources_unlocked_between>,
 *   recipes: ReturnType<typeof recipes_unlocked_between>,
 *   yield: ReturnType<typeof yield_improved_between>,
 *   has_any: boolean,
 * }}
 */
export function job_unlocks(job_id, before, after) {
  const job = get_job(job_id)
  const is_gathering = job?.category === JOB_CATEGORY.GATHERING
  const resources = is_gathering ? resources_unlocked_between(job_id, before, after) : []
  const recipes = is_gathering ? [] : recipes_unlocked_between(job_id, before, after)
  const yield_gain = is_gathering
    ? yield_improved_between(before, after)
    : { improved: false, amount: 0, previous: 0 }
  return {
    is_gathering,
    resources,
    recipes,
    yield: yield_gain,
    has_any: resources.length > 0 || recipes.length > 0 || yield_gain.improved,
  }
}
