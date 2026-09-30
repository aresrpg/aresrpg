// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { gather_time_ms, job_xp_for_level } from '@aresrpg/immutable'

import { gather_progress_view, gathering_job } from '../../../src/game/hud/gather_progress.ts'
import { resource_node_id } from '../../../src/game/resource_nodes.ts'
import { resource_pack_id } from '../../../src/modules/world_spawns.ts'
import { reduce_automation } from '../../../src/modules/automation.ts'
import { reduce_app_state } from '../../../src/store.ts'
import { automation_fixture, key, resource, tick } from '../../modules/automation_fixture.ts'

test('aggregate progress retains the current root when the node disappears before its receipt', () => {
  const base = automation_fixture()
  const idle = {
    ...base,
    automation: { ...base.automation, run: null },
    session: {
      ...base.session,
      characters: base.session.characters.map((row) => ({
        ...row,
        jobs: { [resource.job]: String(job_xp_for_level(30)) },
      })),
    },
  }
  const started = reduce_automation(idle, {
    type: 'automation/collect_all',
    id: 'pack',
    node: resource_node_id(resource_pack_id(key, '1', 0), 0),
    pose: tick().pose,
  })
  expect(gathering_job(idle, idle.session.characters[0])).toBeNull()
  expect(gathering_job(started, started.session.characters[0])).toBe(resource.job)
  expect(gather_progress_view(started, 1_000)).toMatchObject({
    total: 2,
    completed: 0,
    percent: 0,
    remaining_seconds: Math.ceil((2 * gather_time_ms(30)) / 1_000),
  })
  const preparing = reduce_automation(started, tick())
  const pending = reduce_app_state(preparing, {
    type: 'world/gather_started',
    gathering: {
      attempt_id: 'one',
      character_id: 'alice',
      item_type: resource.item_type,
      protector: resource.protector,
      started_at_ms: 1_000,
      duration_ms: 10_000,
      ends_at_ms: 11_000,
      confirmed: false,
      authoritative: true,
      ambushed: false,
      quantity: null,
    },
  })
  const consumed = {
    ...pending,
    world: { ...pending.world, zones: { [key]: { ...pending.world.zones[key]!, res_taken: [1] } } },
  }
  expect(gather_progress_view(consumed, 6_000)).toMatchObject({ completed: 0, percent: 25 })
  const finished = reduce_app_state(consumed, {
    type: 'world/gather_finished',
    character_id: 'alice',
    attempt_id: 'one',
    ends_at_ms: 11_000,
  })
  expect(gathering_job(finished, finished.session.characters[0])).toBe(resource.job)
  expect(gather_progress_view(finished, 11_000)).toMatchObject({ completed: 1, percent: 50 })
})

test('job XP follows the active character and resets when automation stops', () => {
  const state = automation_fixture()
  const character = state.session.characters[0]!
  expect(gathering_job(state, character)).toBe(resource.job)
  expect(gathering_job(state, { ...character, id: 'other' })).toBeNull()
  expect(gathering_job(state, undefined)).toBeNull()
  const stopped = reduce_automation(state, { type: 'automation/stop', reason: 'stopped' })
  expect(gathering_job(stopped, character)).toBeNull()
})

test('manual gathering shows its profession until the gather finishes', () => {
  const base = automation_fixture()
  const idle = reduce_automation(base, { type: 'automation/stop', reason: 'stopped' })
  const character = idle.session.characters[0]!
  const pending = reduce_app_state(idle, {
    type: 'world/gather_started',
    gathering: {
      attempt_id: 'manual',
      character_id: character.id,
      item_type: resource.item_type,
      protector: resource.protector,
      started_at_ms: 1_000,
      duration_ms: 10_000,
      ends_at_ms: 11_000,
      confirmed: false,
      authoritative: true,
      ambushed: false,
      quantity: null,
    },
  })
  expect(gathering_job(pending, character)).toBe(resource.job)
  const finished = reduce_app_state(pending, {
    type: 'world/gather_finished',
    character_id: character.id,
    attempt_id: 'manual',
    ends_at_ms: 11_000,
  })
  expect(gathering_job(finished, character)).toBeNull()
})
