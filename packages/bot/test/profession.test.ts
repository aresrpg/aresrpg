// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { validate_gameplay } from '../src/gameplay.ts'
import { fold_actor_inventory } from '../src/actor_inventory.ts'
import { profession_knowledge, acquisition_sources } from '../src/profession_catalog.ts'

import { profession_context, character, recipe, resource, other_input, item } from './helpers/profession_fixture.ts'

test('craft uses one canonical stack plan, excludes listings and rejects stale revisions', () => {
  const context = profession_context()
  const inputs = Object.entries(recipe.inputs).map(([item_type, amount], index) => item(item_type, amount, 30 + index))
  const snapshot = { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: inputs } }
  const payload = { character_id: character.id, output_type: recipe.output_type, attempts: 1 }
  const action = { kind: 'craft' as const, payload }
  const validated = validate_gameplay({ ...context, snapshot, command: { ...context.command, ...action } })
  expect(validated.kind).toBe('craft')
  if (validated.kind === 'craft') expect(validated.input.input_item_ids).toEqual(inputs.map(({ id }) => id))
  expect(() =>
    validate_gameplay({
      ...context,
      snapshot: { ...snapshot, observation_revision: 2 },
      command: { ...context.command, ...action },
    })
  ).toThrow('needs_resync')
  const listed = { ...snapshot, inventory: { ...snapshot.inventory, listings: [{ id: inputs[0]!.id }] as never } }
  expect(() => validate_gameplay({ ...context, snapshot: listed, command: { ...context.command, ...action } })).toThrow(
    'ingredients_required'
  )
})

test('inventory tombstones and versions prevent stale packets restoring spent resources', () => {
  const state = profession_context().snapshot.inventory!
  const first = item(resource.item_type, 1)
  const updated = fold_actor_inventory(state, { type: 'packet/item_updated', item: first })
  const removed = fold_actor_inventory(updated, { type: 'packet/item_removed', item: first.id, version: '2' })
  const stale = fold_actor_inventory(removed, { type: 'packet/item_updated', item: first })
  expect(stale.items.some(({ id }) => id === first.id)).toBe(false)
  const restored = fold_actor_inventory(stale, { type: 'packet/item_updated', item: { ...first, version: '3' } })
  expect(restored.items.find(({ id }) => id === first.id)?.version).toBe('3')
})

test('knowledge exposes real recipe and drop facts', () => {
  const context = profession_context()
  expect(acquisition_sources(other_input).drops.length).toBeGreaterThan(0)
  const knowledge = profession_knowledge(context.snapshot, [recipe.output_type])
  expect(knowledge.recipes.find(({ output_type }) => output_type === recipe.output_type)?.inputs).toEqual(recipe.inputs)
  expect(knowledge.zones[0]!.resources?.[0]?.item_type).toBe(resource.item_type)
})

test('ordinary observations omit static recipes; explicit index and selected details reuse the same catalogue', () => {
  const { snapshot } = profession_context()
  const ordinary = profession_knowledge(snapshot)
  expect(ordinary.recipes).toEqual([])
  expect(ordinary.recipe_outputs).toBeUndefined()
  const index = profession_knowledge(snapshot, [])
  expect(index.recipe_outputs).toContain(recipe.output_type)
  expect(index.recipes).toEqual([])
  const selected = profession_knowledge(snapshot, [recipe.output_type])
  expect(selected.recipes).toHaveLength(1)
  expect(selected.recipes[0]!.inputs).toEqual(recipe.inputs)
  expect(selected.characters).toEqual(ordinary.characters)
  expect(selected.zones).toEqual(ordinary.zones)
})
