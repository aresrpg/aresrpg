// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { EngineStatus } from '@aresrpg/engine'

import { load_game_settings, RENDER_DISTANCE_MIN } from '../../src/game/core/settings.ts'
import { create_app, reduce_app_state, type AppState } from '../../src/store.ts'

const initial = () => {
  const app = create_app()
  app.initialize(load_game_settings('high', null, null))
  return app.store.getState()
}
const status = (state: AppState, value: EngineStatus) =>
  reduce_app_state(state, { type: 'engine/status', status: value })

test('device loss retries minimum settings once, then grid, then stops', () => {
  const first = status(initial(), { state: 'failed', backend: 'webgpu', issue: { code: 'webgpu_device_lost' } })
  expect(first.engine).toMatchObject({ state: 'initializing', recovery: 'minimum' })
  expect(first.settings).toMatchObject({ quality: 'low', render_distance: RENDER_DISTANCE_MIN })
  const ready = status(first, { state: 'ready', backend: 'webgpu' })
  expect(ready.engine.recovery).toBe('minimum')
  const second = status(ready, { state: 'failed', backend: 'webgpu', issue: { code: 'terrain_failed' } })
  expect(second.engine).toMatchObject({ state: 'initializing', recovery: 'grid' })
  const third = status(second, { state: 'failed', backend: 'none', issue: { code: 'graphics_unavailable' } })
  expect(third.engine).toMatchObject({ state: 'failed', recovery: 'grid' })
})

test('missing world content never reduces graphics or retries', () => {
  const before = initial()
  const after = status(before, { state: 'failed', backend: 'none', issue: { code: 'world_unavailable' } })
  expect(after.engine).toMatchObject({ state: 'failed', recovery: 'none' })
  expect(after.settings).toBe(before.settings)
})

test('an already running grid failure is terminal', () => {
  const before = initial()
  const after = status(before, { state: 'failed', backend: 'grid', issue: { code: 'graphics_unavailable' } })
  expect(after.engine.state).toBe('failed')
  expect(after.settings).toBe(before.settings)
})

test('minimum recovery does not enlarge the low quality default radius', () => {
  expect(RENDER_DISTANCE_MIN).toBe(3)
})
