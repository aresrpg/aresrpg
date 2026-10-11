// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { unlocked_recipe_chains, type RecipeProgressionInput } from '../src/acquisition.ts'

const recipes = Object.freeze<RecipeProgressionInput[]>([
  { output_type: 'ring', job: 'JEWELER', inputs: { resin: 2, thread: 1 } },
  { output_type: 'resin', job: 'ALCHEMIST', inputs: { sap: 1, water: 1, powder: 1 } },
  { output_type: 'powder', job: 'MINER', inputs: { ore: 2, water: 1 } },
  { output_type: 'simple_ring', job: 'JEWELER', inputs: { sap: 2, thread: 1 } },
])

test('an unlocked final recipe still needs the intermediate levels across every profession', () => {
  expect([...unlocked_recipe_chains(recipes, { JEWELER: 8 })].sort()).toEqual(['powder', 'simple_ring'])
  expect([...unlocked_recipe_chains(recipes, { JEWELER: 8, ALCHEMIST: 10 })].sort()).toEqual([
    'powder',
    'resin',
    'ring',
    'simple_ring',
  ])
  // Reusing the same content for another character must not retain the previous unlocks.
  expect(unlocked_recipe_chains(recipes, { JEWELER: 8 }).has('ring')).toBe(false)
})

test('nested same-job chains use ingredient slots, not quantities or input ordering', () => {
  const chain: readonly RecipeProgressionInput[] = [
    { output_type: 'pendant', job: 'JEWELER', inputs: { ring: 1, thread: 1 } },
    { output_type: 'ring', job: 'JEWELER', inputs: { resin: 1, thread: 1 } },
    { output_type: 'resin', job: 'JEWELER', inputs: { sap: 100, water: 10, ore: 30 } },
  ]
  expect(unlocked_recipe_chains(chain, { JEWELER: 9 }).size).toBe(0)
  expect([...unlocked_recipe_chains(chain, { JEWELER: 10 })].sort()).toEqual(['pendant', 'resin', 'ring'])
  expect([...unlocked_recipe_chains(chain.toReversed(), { JEWELER: 10 })].sort()).toEqual(['pendant', 'resin', 'ring'])
})

test('cycles and their consumers stay unavailable without preventing independent recipes', () => {
  const chain: readonly RecipeProgressionInput[] = [
    { output_type: 'a', job: 'JEWELER', inputs: { b: 1, ore: 1 } },
    { output_type: 'b', job: 'ALCHEMIST', inputs: { a: 1, water: 1 } },
    { output_type: 'c', job: 'JEWELER', inputs: { a: 1, thread: 1 } },
    { output_type: 'loop', job: 'JEWELER', inputs: { loop: 1, thread: 1 } },
    { output_type: 'free', job: 'MINER', inputs: { ore: 1, water: 1 } },
  ]
  expect([...unlocked_recipe_chains(chain, { JEWELER: 100, ALCHEMIST: 100 })]).toEqual(['free'])
})
