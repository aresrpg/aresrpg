// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { automation_clock, automation_command, reduce_automation } from '../../src/modules/automation.ts'
import { resource_node_id } from '../../src/game/resource_nodes.ts'
import { resource_pack_id } from '../../src/modules/world_spawns.ts'
import { reduce_app_state, type AppState } from '../../src/store.ts'

import { automation_fixture, key, resource, tick } from './automation_fixture.ts'

const node = resource_node_id(resource_pack_id(key, '1', 0), 0)
const idle = (level = 30): AppState => {
  const state = automation_fixture()
  return {
    ...state,
    journey: { ...state.journey, completed: [] },
    automation: { ...state.automation, run: null },
    chain_clock: { chain_ms: 100_000, received_ms: 1_000 },
    session: {
      ...state.session,
      characters: state.session.characters.map((row) => ({
        ...row,
        jobs: { [resource.job]: String(job_xp_for_level(level)) },
      })),
    },
  }
}
const start = (state = idle()) =>
  reduce_automation(state, { type: 'automation/collect_all', id: 'pack-run', node, pose: tick().pose })

test('collect all unlocks at job level 30 independently of journey completion', () => {
  expect(start(idle(29)).automation.run).toBeNull()
  expect(start().automation.run?.scope.type).toBe('pack')
  expect(start().automation.run?.step.type).toBe('inspecting')
})

test('collect all requires the tool and a live nearby pose', () => {
  const state = idle()
  const untooled = {
    ...state,
    session: { ...state.session, characters: state.session.characters.map((row) => ({ ...row, equipment: [] })) },
  }
  expect(start(untooled).automation.run).toBeNull()
  const far = reduce_automation(state, {
    type: 'automation/collect_all',
    id: 'pack-run',
    node,
    pose: { ...tick().pose!, x: 100 },
  })
  expect(far.automation.run).toBeNull()
})

test('collect all stops immediately on a confirmed protector and never forfeits', () => {
  const inspecting = start()
  const gathering = reduce_automation(inspecting, tick())
  expect(automation_command(gathering, inspecting)).toEqual({ type: 'world/gather', node })
  const started = reduce_app_state(gathering, {
    type: 'world/gather_started',
    gathering: {
      attempt_id: 'one',
      character_id: 'alice',
      item_type: resource.item_type,
      protector: resource.protector,
      started_at_ms: 1,
      duration_ms: 100,
      ends_at_ms: 101,
      confirmed: false,
      authoritative: false,
      ambushed: false,
      quantity: null,
    },
  })
  const ambushed = reduce_app_state(started, {
    type: 'world/gather_confirmed',
    attempt_id: 'one',
    character_id: 'alice',
    quantity: 2,
    ambushed: true,
    fallback_ends_at_ms: 101,
  })
  expect(ambushed.automation.run).toBeNull()
  expect(automation_command(ambushed, started)).toBeNull()
  expect(reduce_automation(ambushed, tick()).automation.run).toBeNull()
})

test('a depleted or replaced cluster finishes instead of visiting another pack', () => {
  const running = start()
  const planning: AppState = {
    ...running,
    automation: { ...running.automation, run: { ...running.automation.run!, step: { type: 'planning' } } },
  }
  const depleted = {
    ...planning,
    world: { ...planning.world, zones: { [key]: { ...planning.world.zones[key]!, res_taken: [2] } } },
  }
  expect(reduce_automation(depleted, tick()).automation.run).toBeNull()
  const replaced = {
    ...planning,
    world: { ...planning.world, zones: { [key]: { ...planning.world.zones[key]!, seed: 'new' } } },
  }
  expect(reduce_automation(replaced, tick()).automation.run).toBeNull()
})

test('an authoritative protector projection stops before the receipt arrives', () => {
  const state = start()
  const ambushed = {
    ...state,
    session: {
      ...state.session,
      characters: state.session.characters.map((row) => ({
        ...row,
        active_fight: { id: 'protector', seat: 0 },
        custody: 'fight' as const,
      })),
    },
  }
  expect(reduce_automation(ambushed, tick()).automation.run).toBeNull()
})

test('leaving interaction range or switching character cancels the finite run', () => {
  const state = start()
  expect(reduce_automation(state, { ...tick(), pose: { ...tick().pose!, x: 100 } }).automation.run).toBeNull()
  const roster = {
    ...state,
    session: {
      ...state.session,
      characters: [...state.session.characters, { ...state.session.characters[0]!, id: 'bob' }],
    },
  }
  const switched = reduce_app_state(roster, { type: 'character/select', character_id: 'bob' })
  expect(switched.automation.run).toBeNull()
})

test('finite collection waits for an observed chain deadline, even when the estimate passes it', () => {
  const state = start()
  expect(automation_clock(state, 2_000)).toBe(100_000)
  const rooted = {
    ...state,
    session: { ...state.session, characters: state.session.characters.map((row) => ({ ...row, at_ms: 100_500 })) },
  }
  const early = reduce_automation(rooted, { ...tick(2_000), world_ms: automation_clock(rooted, 2_000) })
  expect(early.automation.run?.step.type).toBe('inspecting')
  expect(automation_command(early, rooted)).toBeNull()
  const observed = { ...rooted, chain_clock: { chain_ms: 100_501, received_ms: 2_000 } }
  expect(
    reduce_automation(observed, { ...tick(2_000), world_ms: automation_clock(observed, 2_000) }).automation.run?.step
      .type
  ).toBe('gathering')
  expect(automation_clock(state, 20_000)).toBeNull()
})

test('receipt and node consumption cannot advance before the new character checkpoint is projected', () => {
  let state = reduce_automation(start(), tick())
  state = reduce_app_state(state, {
    type: 'world/gather_started',
    gathering: {
      attempt_id: 'projection',
      character_id: 'alice',
      item_type: resource.item_type,
      protector: resource.protector,
      started_at_ms: 1,
      duration_ms: 100,
      ends_at_ms: 101,
      confirmed: false,
      authoritative: false,
      ambushed: false,
      quantity: null,
    },
  })
  state = reduce_app_state(state, {
    type: 'world/gather_confirmed',
    attempt_id: 'projection',
    character_id: 'alice',
    quantity: 2,
    ambushed: false,
    fallback_ends_at_ms: 101,
  })
  state = reduce_app_state(state, {
    type: 'world/gather_finished',
    attempt_id: 'projection',
    character_id: 'alice',
    ends_at_ms: 101,
  })
  state = { ...state, world: { ...state.world, zones: { [key]: { ...state.world.zones[key]!, res_taken: [1] } } } }
  expect(reduce_automation(state, tick()).automation.run?.step.type).toBe('gathering')
  const updated = {
    ...state,
    session: { ...state.session, characters: state.session.characters.map((row) => ({ ...row, at_ms: 102 })) },
  }
  expect(reduce_automation(updated, tick()).automation.run?.step.type).toBe('planning')
})

test('a changed resource identity stops the finite plan instead of replanning forever', () => {
  const state = start()
  const changed: AppState = {
    ...state,
    automation: { ...state.automation, run: { ...state.automation.run!, step: { type: 'planning' } } },
    world: {
      ...state.world,
      spawns: {
        [key]: {
          mobs: [],
          resources: [{ ...state.world.spawns[key]!.resources[0]!, item_type: 'different-resource' }],
        },
      },
    },
  }
  expect(reduce_automation(changed, tick()).automation.run).toBeNull()
})

test('Collect All selects its own resource rather than the automation panel previous choice', () => {
  const state = idle()
  const running = start({ ...state, automation: { ...state.automation, item_type: 'different-resource' } })
  expect(running.automation.item_type).toBe(resource.item_type)
  expect(reduce_automation(running, tick()).automation.run?.step.type).toBe('gathering')
})

test('changing pages preserves Collect All while explicit movement still cancels it', () => {
  const state = start()
  const elsewhere = reduce_app_state(state, { type: 'page/open', page: 'marketplace' })
  expect(elsewhere.automation.run).toBe(state.automation.run)
  expect(reduce_automation(elsewhere, tick()).automation.run?.step.type).toBe('gathering')
  const moving = reduce_app_state(state, { type: 'run_to/position', world: 'nauvis', x: 50_030, z: 50_000 })
  expect(moving.automation.run).toBeNull()
})
