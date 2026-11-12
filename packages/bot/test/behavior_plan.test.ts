// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun, type BehaviorScript } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'

import { profession_context, character, resource, recipe, item } from './helpers/profession_fixture.ts'

const run_for = (script: BehaviorScript): BehaviorRun => ({
  id: 'run',
  bot_id: 'bot',
  grant_id: 'grant',
  lane_key: 'lane',
  fingerprint: 'fixture',
  script: parse_behavior_script(script),
  revision: 1,
  memory: empty_behavior_memory(),
  pending_node: null,
  activation: null,
  consumed_command_id: null,
  status: 'active',
  actions_started: 0,
  last_command_id: null,
  created_at: 0,
})
const objective: BehaviorScript = {
  version: '1',
  objective: { title: 'Authored gather and craft branches' },
  tree: {
    type: 'selector',
    children: [
      {
        type: 'sequence',
        children: [
          {
            type: 'condition',
            condition: { fact: { type: 'level', character_id: character.id }, op: 'gte', value: 30 },
          },
          { type: 'complete' },
        ],
      },
      {
        type: 'sequence',
        children: [
          {
            type: 'condition',
            condition: {
              fact: { type: 'quantity', character_id: character.id, key: resource.item_type },
              op: 'lt',
              value: recipe.inputs[resource.item_type]!,
            },
          },
          {
            type: 'action',
            action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
          },
        ],
      },
      {
        type: 'action',
        action: {
          type: 'call',
          kind: 'craft',
          payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
        },
      },
    ],
  },
}
test('authored conditions select gathering, crafting and explicit objective completion from current state', () => {
  const run = run_for(objective)
  const context = profession_context()
  expect(next_behavior_action(run, null, context).action?.kind).toBe('gather')
  const inventory = context.snapshot.inventory!
  const supplied = {
    ...context,
    snapshot: {
      ...context.snapshot,
      inventory: {
        ...inventory,
        items: [...inventory.items, item(resource.item_type, recipe.inputs[resource.item_type]!)],
      },
    },
  }
  expect(next_behavior_action(run, null, supplied).action?.kind).toBe('craft')
  const done = { ...context, snapshot: { ...context.snapshot, characters: [{ ...character, level: 30 }] } }
  expect(next_behavior_action(run, null, done).state).toBe('completed')
  const missing = { ...context, snapshot: { ...context.snapshot, inventory: { ...inventory, loaded: false } } }
  expect(next_behavior_action(run, null, missing).state).toBe('waiting')
})
test('a completed observation leaf still advances a fresh paginated market sweep', () => {
  const observation = {
    kind: 'offers' as const,
    category: 'resource' as const,
    request: 1,
    item_type: resource.item_type,
  }
  const run = run_for({
    version: '1',
    objective: { title: 'Inspect market' },
    tree: {
      type: 'sequence',
      children: [{ type: 'action', action: { type: 'observe_market', observation } }, { type: 'wait' }],
    },
  })
  const context = profession_context()
  const inventory = {
    ...context.snapshot.inventory!,
    market: {
      observation,
      next_cursor: 'page-two',
      listings: [],
      pages: [{ cursor: '', next_cursor: 'page-two', ids: [] }],
      complete: false,
    },
  }
  const next = next_behavior_action({ ...run, observation, memory: { completed: ['root/0'], selected: {} } }, null, {
    ...context,
    snapshot: { ...context.snapshot, inventory },
  })
  expect(next.record.observation).toMatchObject({ cursor: 'page-two' })
})
