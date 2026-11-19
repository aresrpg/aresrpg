// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { gatherable_catalog, job_xp_for_level } from '@aresrpg/immutable'
import { worlds_source } from '@aresrpg/engine/data'
import { bind_strategy } from '@aresrpg/protocol/strategies'

import { select_profession } from '../src/behavior_profession.ts'
import { validate_gameplay } from '../src/gameplay.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import items from '../../../seed/content/items.json'

import { profession_context, character, item, recipe, resource, other_input } from './helpers/profession_fixture.ts'

const action = { type: 'profession', character_id: character.id, world: 'fixture', order: 'best_progress' } as const

test('profession chooses actual feasible XP craft, reevaluates inventory and does not swallow craft races', () => {
  const context = profession_context()
  const ready = {
    ...context,
    snapshot: {
      ...context.snapshot,
      inventory: {
        ...context.snapshot.inventory!,
        items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index)),
      },
    },
  }
  const selected = select_profession(action, ready)
  expect(selected).toMatchObject({ status: 'action', action: { kind: 'craft' } })
  if (selected.status !== 'action') throw new Error('expected craft')
  expect(validate_gameplay({ ...ready, command: { ...ready.command, ...selected.action } }).kind).toBe('craft')
  expect(() => validate_gameplay({ ...context, command: { ...context.command, ...selected.action } })).toThrow(
    'ingredients_required'
  )
  expect(select_profession(action, context)).toMatchObject({ status: 'action', action: { kind: 'gather' } })
  expect(() =>
    select_profession(action, {
      ...ready,
      snapshot: { ...ready.snapshot, inventory: { ...ready.snapshot.inventory, trades: null } },
    })
  ).toThrow('inventory_unavailable')
})

test('every gathering job selects its available tool, then harvests after equipment observation; absent tool blocks exploration', () => {
  for (const job of ['FARMER', 'HERBALIST', 'MINER']) {
    const context = profession_context()
    const resource = gatherable_catalog.find((row) => row.job === job && row.tier === 1)!
    const source = items.find((row) => row.category === `tool_${job.toLowerCase()}` && row.level <= character.level)!
    const tool = { ...item(source.item_type, 1), category: source.category, level: source.level }
    const zone = context.snapshot.zones['fixture:97:97']!
    const ready = {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: [{ ...character, equipment: [] }],
        inventory: { ...context.snapshot.inventory!, items: [tool] },
        zones: {
          'fixture:97:97': {
            ...zone,
            spawns: {
              ...zone.spawns!,
              resources: [{ index: 0, x: character.x!, z: character.z!, item_type: resource.item_type, nodes: 2 }],
            },
          },
        },
      },
    }
    const equip = select_profession(action, ready)
    expect(equip).toMatchObject({
      status: 'action',
      action: { kind: 'equip_item', payload: { item_id: tool.id, slot: 'tool' } },
    })
    if (equip.status !== 'action') throw new Error('expected equip')
    expect(validate_gameplay({ ...ready, command: { ...ready.command, ...equip.action } }).kind).toBe('equip_item')
    const equipped = {
      ...ready,
      snapshot: {
        ...ready.snapshot,
        characters: [{ ...character, equipment: [{ ...tool, slot: 'tool' }] }],
        inventory: { ...ready.snapshot.inventory, items: [] },
      },
    }
    const gather = select_profession(action, equipped)
    expect(gather).toMatchObject({
      status: 'action',
      action: { kind: 'gather', payload: { item_type: resource.item_type } },
    })
    if (gather.status !== 'action') throw new Error('expected gather')
    expect(validate_gameplay({ ...equipped, command: { ...equipped.command, ...gather.action } }).kind).toBe('gather')
    expect(() =>
      select_profession(action, {
        ...ready,
        snapshot: { ...ready.snapshot, inventory: { ...ready.snapshot.inventory, items: [] } },
      })
    ).toThrow('tool_unavailable')
  }
})

test('selected strategy goes from exhausted patches to onward discovery and never falls through an uncertain inventory', () => {
  const context = profession_context()
  const { world } = worlds_source[0]!
  const zone = context.snapshot.zones['fixture:97:97']!
  const snapshot = {
    ...context.snapshot,
    characters: [{ ...character, world, checkpoint_world: world }],
    zones: {
      [`${world}:97:97`]: {
        ...zone,
        zone: { ...zone.zone, world, res_taken: [20] },
        spawns: { ...zone.spawns!, world, resources: [] },
      },
    },
    tracked_zones: {
      [character.id]: {
        ...context.snapshot.tracked_zones[character.id]!,
        world,
        zones: [
          { zx: 97, zz: 97 },
          { zx: 96, zz: 97 },
        ],
      },
    },
  }
  const run: BehaviorRun = {
    id: 'run',
    bot_id: 'bot',
    grant_id: 'grant',
    lane_key: 'lane',
    character_id: context.snapshot.characters[0]!.id,
    fingerprint: 'fixture',
    script: parse_behavior_script(
      bind_strategy('gather_craft', { character: character.id, title: 'Gather', area: { world } })
    ),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
  }
  expect(next_behavior_action(run, null, { ...context, snapshot })).toMatchObject({
    state: 'action',
    action: { kind: 'world_search', payload: { world, x: 49408 } },
  })
  expect(
    next_behavior_action(run, null, {
      ...context,
      snapshot: { ...snapshot, inventory: { ...snapshot.inventory!, loaded: false } },
    })
  ).toMatchObject({ state: 'waiting', issue: 'inventory_unavailable', action: undefined })
  const leveled = {
    ...context,
    snapshot: {
      ...context.snapshot,
      characters: [{ ...character, jobs: { [resource.job]: String(job_xp_for_level(100)) } }],
      inventory: { ...context.snapshot.inventory!, items: [item(other_input, 100)] },
    },
  }
  expect(select_profession(action, leveled).status).toBe('action')
})

test('profession candidates never spend listed, traded or unversioned ingredients', () => {
  const context = profession_context()
  const inputs = Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index))
  const inventory = { ...context.snapshot.inventory!, items: inputs }
  for (const excluded of [
    { ...inventory, listings: inputs.map(({ id }) => ({ id })) as never },
    { ...inventory, trades: [{ caps_a: inputs.map(({ id }) => ({ object: id })), caps_b: [] }] as never },
  ])
    expect(
      select_profession(action, { ...context, snapshot: { ...context.snapshot, inventory: excluded } })
    ).toMatchObject({ status: 'action', action: { kind: 'gather' } })
  expect(() =>
    select_profession(action, {
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: { ...inventory, items: inputs.map((row) => ({ ...row, version: undefined })) },
      },
    })
  ).toThrow('inventory_unavailable')
})
