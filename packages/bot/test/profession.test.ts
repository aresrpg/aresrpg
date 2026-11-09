// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { validate_profession_plan, next_profession_action } from '../src/profession_plan.ts'
import { validate_gameplay } from '../src/gameplay.ts'
import { fold_actor_inventory } from '../src/actor_inventory.ts'
import { profession_knowledge, acquisition_sources } from '../src/profession_catalog.ts'

import {
  profession_context,
  plan,
  character,
  recipe,
  resource,
  other_input,
  item,
} from './helpers/profession_fixture.ts'

test('static validator rejects code, unknown jobs/recipes, mismatched jobs and expired or unbounded plans', () => {
  for (const patch of [
    { script: 'arbitrary' },
    { job: 'UNKNOWN' },
    { recipe_output: 'missing' },
    { job: 'FORGER' },
    { max_actions: 0 },
    { max_actions: Infinity },
    { deadline_ms: 1 },
    { gather_item_types: ['missing'] },
  ]) {
    const result = validate_profession_plan({ ...plan, ...patch }, 63000)
    expect(result.valid).toBe(false)
    expect(result.static.errors[0]).toHaveProperty('remedy')
    expect(result.simulation.status).toBe('not_run')
  }
  const result = validate_profession_plan(plan, 63000)
  expect(result).toMatchObject({
    valid: true,
    live: { status: 'not_checked' },
    limits: { max_actions: plan.max_actions, automatic_combat: false, purchases: false },
  })
})

test('live validation distinguishes tool, ingredient, travel and protector requirements without writes', () => {
  const context = profession_context()
  expect(validate_profession_plan(plan, 63000, context).live.next?.action?.kind).toBe('gather')
  expect(
    next_profession_action(plan, {
      ...context,
      snapshot: { ...context.snapshot, characters: [{ ...character, equipment: [] }] },
    }).issue?.code
  ).toBe('gathering_tool_required')
  expect(
    next_profession_action(plan, {
      ...context,
      snapshot: { ...context.snapshot, characters: [{ ...character, at_ms: 999999 }] },
    }).state
  ).toBe('waiting')
  expect(
    next_profession_action(plan, {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: [
          {
            ...character,
            ambush: { protector: resource.protector, x: 50000, z: 50000, scalar: 100, board_seed: '1', hp: '10' },
          },
        ],
      },
    }).issue?.code
  ).toBe('combat_required')
  const no_resources = {
    ...context,
    snapshot: {
      ...context.snapshot,
      inventory: { ...context.snapshot.inventory!, items: [item(resource.item_type, 100)] },
    },
  }
  const blocked = next_profession_action(plan, no_resources)
  expect(blocked).toMatchObject({ state: 'awaiting_ai', issue: { code: 'acquisition_required' } })
  expect(blocked.progress.missing).toContainEqual({ item_type: other_input, quantity: recipe.inputs[other_input]! })
  expect(acquisition_sources(other_input).drops.length).toBeGreaterThan(0)
})

test('craft uses one canonical stack plan, excludes listings and rejects stale revisions', () => {
  const context = profession_context()
  const inputs = Object.entries(recipe.inputs).map(([item_type, amount], index) => item(item_type, amount, 30 + index))
  const snapshot = { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: inputs } }
  const action = next_profession_action(plan, { ...context, snapshot }).action!
  expect(action.kind).toBe('craft')
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

test('completion requires actual projected profession XP and knowledge exposes real recipe/drop facts', () => {
  const context = profession_context()
  const snapshot = {
    ...context.snapshot,
    characters: [{ ...character, jobs: { [plan.job]: String(job_xp_for_level(plan.target_level)) } }],
  }
  expect(next_profession_action(plan, { ...context, snapshot }).state).toBe('completed')
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
