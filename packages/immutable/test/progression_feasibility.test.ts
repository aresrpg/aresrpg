// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { best_recipe_for_job_progression, compare_recipe_progress } from '../src/acquisition.ts'

test('live feasibility filters candidates after full same-job chain reachability and leaves legacy ranking unchanged', () => {
  const recipes = [
    { output_type: 'alloy', inputs: { ore: 1, coal: 1, water: 1 }, job: 'FORGER' },
    { output_type: 'blade', inputs: { alloy: 1, wood: 1 }, job: 'FORGER' },
    { output_type: 'plain', inputs: { ore: 1, wood: 1 }, job: 'FORGER' },
  ]
  const feasible = (recipe: { output_type: string }) => recipe.output_type === 'blade'
  expect(best_recipe_for_job_progression(recipes, 'FORGER', 1, () => 1, feasible)).toBeNull()
  expect(best_recipe_for_job_progression(recipes, 'FORGER', 10, () => 1, feasible)?.output_type).toBe('blade')
  expect(best_recipe_for_job_progression(recipes, 'FORGER', 100, () => 1, feasible)).toBeNull()
  expect(best_recipe_for_job_progression(recipes, 'FORGER', 1, () => 1)?.output_type).toBe('plain')
})

test('cross-job ordering reuses the exact recommendation comparator with stable ties', () => {
  const a = { output_type: 'a', xp: 10, acquisition_seconds: 2, xp_per_second: 5 }
  const b = { output_type: 'b', xp: 15, acquisition_seconds: 3, xp_per_second: 5 }
  expect([a, b].toSorted(compare_recipe_progress)).toEqual([b, a])
  expect(compare_recipe_progress(a, { ...a, output_type: 'z' })).toBeLessThan(0)
})
