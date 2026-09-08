// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { feeding_gate, initial_feeding, reduce_feeding } from '../../src/characters/pet_feeding.ts'

const food = { id: 'food', item_type: 'gilded_pet_food', name: 'Food' }

test('selection is separate from confirmation and a pending feed ignores repeated gestures', () => {
  expect(reduce_feeding(initial_feeding, { type: 'confirm', food })).toBe(initial_feeding)
  const selected = reduce_feeding(initial_feeding, { type: 'select', food_id: food.id })
  expect(selected.phase).toBe('selecting')
  const pending = reduce_feeding(selected, { type: 'confirm', food })
  expect(pending.phase).toBe('pending')
  expect(reduce_feeding(pending, { type: 'confirm', food })).toBe(pending)
  expect(reduce_feeding(pending, { type: 'select', food_id: 'another' })).toBe(pending)
})

test('only a confirmed receipt starts celebration and stale completions cannot replay it', () => {
  expect(reduce_feeding(initial_feeding, { type: 'succeeded' })).toBe(initial_feeding)
  const selected = reduce_feeding(initial_feeding, { type: 'select', food_id: food.id })
  const pending = reduce_feeding(selected, { type: 'confirm', food })
  const failed = reduce_feeding(pending, { type: 'failed', error: 'Rejected' })
  expect(failed).toMatchObject({ phase: 'selecting', selected_id: food.id, error: 'Rejected', food: null })
  const thrown = reduce_feeding(pending, { type: 'succeeded' })
  expect(thrown).toMatchObject({ phase: 'throwing', food })
  const happy = reduce_feeding(thrown, { type: 'landed' })
  expect(happy.phase).toBe('celebrating')
  const done = reduce_feeding(happy, { type: 'finished' })
  expect(reduce_feeding(done, { type: 'succeeded' })).toBe(done)
  expect(reduce_feeding(done, { type: 'failed', error: 'Late' })).toBe(done)
})

test('feeding respects current ownership, maximum power and the UTC day', () => {
  const pet = {
    id: 'pet',
    item_type: 'siluri',
    name: 'Siluri',
    category: 'pet',
    amount: 1,
    level: 1,
    kiosk: 'kiosk',
    pet_power: 30,
    pet_last_day: 4,
  }
  expect(feeding_gate(undefined, false, 5)).toBe('feed_unavailable')
  expect(feeding_gate(pet, true, 5)).toBe('feed_unavailable')
  expect(feeding_gate({ ...pet, pet_power: 60 }, false, 5)).toBe('feed_full')
  expect(feeding_gate(pet, false, 4)).toBe('feed_already_today')
  expect(feeding_gate(pet, false, 5)).toBeNull()
})
