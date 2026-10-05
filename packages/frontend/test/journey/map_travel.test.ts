// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const ready = () => {
  const initial = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const connected = reduce_app_state(reduce_app_state(initial, { type: 'auth/connecting' }), {
    type: 'auth/connected',
    session: { address: 'owner' } as never,
  })
  const loaded = reduce_app_state(connected, {
    type: 'journey/loaded',
    identity: connected.journey.identity!,
    generation: connected.journey.generation,
    completed: ['welcome'],
  })
  return {
    ...loaded,
    session: {
      ...loaded.session,
      link_status: 'ready' as const,
      roster_loaded: true,
      selected_character_id: 'hero',
      characters: [
        { id: 'hero', world: 'nauvis', checkpoint_world: 'nauvis', custody: 'kiosk', equipment: [] },
      ] as never,
    },
  }
}

test('opening the map and choosing a destination do not complete the quest; arrival does once', () => {
  const opened = reduce_app_state(ready(), { type: 'dialog/open', dialog: 'world_map' })
  expect(opened.journey.completed).toEqual(['welcome'])
  const moving = reduce_app_state(opened, {
    type: 'run_to/position',
    world: 'nauvis',
    x: 50010,
    z: 50010,
    source: 'map',
  })
  expect(moving.journey.completed).toEqual(['welcome'])
  const arrived = reduce_app_state(moving, { type: 'run_to/stopped', reason: 'arrived' })
  expect(arrived.run_to.run).toBeNull()
  expect(arrived.journey.completed).toContain('map_travel')
  expect(arrived.journey.celebrations).toEqual(['map_travel'])
  expect(reduce_app_state(arrived, { type: 'run_to/stopped', reason: 'arrived' }).journey).toBe(arrived.journey)
})

test.each(['manual', 'blocked', 'inactive'] as const)('a %s stop never completes map travel', (reason) => {
  const moving = reduce_app_state(ready(), {
    type: 'run_to/position',
    world: 'nauvis',
    x: 50010,
    z: 50010,
    source: 'map',
  })
  expect(reduce_app_state(moving, { type: 'run_to/stopped', reason }).journey.completed).toEqual(['welcome'])
})

test.each([undefined, 'automation'] as const)('other travel source %s does not teach the map', (source) => {
  const moving = reduce_app_state(ready(), { type: 'run_to/position', world: 'nauvis', x: 50010, z: 50010, source })
  expect(reduce_app_state(moving, { type: 'run_to/stopped', reason: 'arrived' }).journey.completed).toEqual(['welcome'])
})

test('rejected destinations and switched characters cannot complete the quest', () => {
  const rejected = reduce_app_state(ready(), { type: 'run_to/position', world: 'other', x: 1, z: 1, source: 'map' })
  expect(reduce_app_state(rejected, { type: 'run_to/stopped', reason: 'arrived' }).journey.completed).toEqual([
    'welcome',
  ])
  const moving = reduce_app_state(ready(), {
    type: 'run_to/position',
    world: 'nauvis',
    x: 50010,
    z: 50010,
    source: 'map',
  })
  const switched = { ...moving, session: { ...moving.session, selected_character_id: 'other' } }
  expect(reduce_app_state(switched, { type: 'run_to/stopped', reason: 'arrived' }).journey.completed).toEqual([
    'welcome',
  ])
})
