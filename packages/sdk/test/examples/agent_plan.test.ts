// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { travel_proof_ready } from '@aresrpg/protocol'

import { earliest_travel_ms, recipe_plan } from '../../examples/agent_plan.ts'

const character = {
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50_000,
  z: 50_000,
  at_ms: 10_000,
  pet: false,
  equipment: [],
}

describe('agent travel planning', () => {
  test('refuses missing world evidence and unresolved obligations', () => {
    expect(earliest_travel_ms({ ...character, checkpoint_world: 'other' }, character)).toBeNull()
    expect(earliest_travel_ms({ ...character, at_ms: undefined }, character)).toBeNull()
    expect(earliest_travel_ms({ ...character, dungeon_run: { dungeon: 'test', room: 0 } }, character)).toBeNull()
    expect(earliest_travel_ms(character, { x: 100_000, z: 0 })).toBeNull()
  })

  test('honors future roots and rounds diagonal travel to the first legal millisecond', () => {
    expect(earliest_travel_ms(character, character)).toBe(10_000)
    const target = { x: 50_001, z: 50_001 }
    const deadline = earliest_travel_ms(character, target)!
    expect(deadline).toBe(10_174)
    const input = {
      from_x: character.x,
      from_z: character.z,
      from_ms: character.at_ms,
      pet_at_start: false,
      to_x: target.x,
      to_z: target.z,
      pet_now: false,
    }
    expect(travel_proof_ready({ ...input, now_ms: deadline - 1 })).toBe(false)
    expect(travel_proof_ready({ ...input, now_ms: deadline })).toBe(true)
  })

  test('a newly equipped pet cannot retroactively speed up a leg', () => {
    const equipment = [{ slot: 'pet', id: 'pet', name: 'Pet', item_type: 'pet', category: 'pet', level: 1, amount: 1 }]
    const target = { x: 50_100, z: 50_000 }
    const ordinary = earliest_travel_ms(character, target)
    expect(earliest_travel_ms({ ...character, equipment }, target)).toBe(ordinary)
    expect(earliest_travel_ms({ ...character, equipment, pet: true }, target)).toBeLessThan(ordinary!)
  })
})

describe('offline recipe example', () => {
  test('refuses invented outputs and impossible batch sizes', () => {
    expect(() => recipe_plan('invented_potion', 10)).toThrow('No authored recipe')
    expect(() => recipe_plan('recall_potion', 0)).toThrow('Job level')
    expect(() => recipe_plan('recall_potion', 10, 1001)).toThrow('attempts')
  })

  test('shows the early recall-potion gate and quantities for attempts, not guaranteed outputs', () => {
    expect(recipe_plan('recall_potion', 1)).toMatchObject({ eligible: false, required_level: 10, job: 'ALCHEMIST' })
    const plan = recipe_plan('recall_potion', 10, 5)
    expect(plan.eligible).toBe(true)
    expect(plan.ingredients.map(({ item_type, quantity }) => ({ item_type, quantity }))).toEqual([
      { item_type: 'tree_resin', quantity: 5 },
      { item_type: 'green_mushroom', quantity: 25 },
      { item_type: 'water', quantity: 5 },
    ])
    expect(plan.ingredients.find(({ item_type }) => item_type === 'water')!.sources.drops.length).toBeGreaterThan(0)
  })
})
