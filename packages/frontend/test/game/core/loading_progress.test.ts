// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { loading_progress } from '../../../src/game/core/loading_progress.ts'
import type { WorldState } from '../../../src/game/core/world.ts'

const ready: WorldState = {
  engine: { state: 'ready', backend: 'webgpu' },
  render: {
    settled: true,
    mesh_queued: 0,
    mesh_active: 0,
    uploads_pending: 0,
    uploads_blocked: 0,
    retries_pending: 0,
    failed_chunks: 0,
    far_ready: true,
    sky_ready: true,
  },
  chunks: {
    resident: 10,
    total: 10,
    ready: 10,
    queued: 0,
    in_flight: 0,
    evicting: 0,
    failed: 0,
    quality: 'high',
    render_distance: 9,
    planning: 0,
  },
  displayed_chunks: 10,
}

test('failures and unplanned work cannot masquerade as completed loading', () => {
  expect(loading_progress(null)).toEqual({ stage: 'assets', fraction: null })
  expect(loading_progress({ ...ready, engine: { state: 'failed', backend: 'webgpu' } }).stage).toBe('failed')
  expect(loading_progress({ ...ready, engine: { state: 'initializing', backend: 'none' } }).stage).toBe('graphics')
  expect(loading_progress({ ...ready, chunks: { ...ready.chunks, planning: 4 } })).toEqual({
    stage: 'terrain',
    fraction: null,
  })
  expect(loading_progress({ ...ready, chunks: { ...ready.chunks, resident: 0 } }).stage).toBe('finishing')
})

test('terrain reports measured work and readiness waits for atmosphere and rendering', () => {
  expect(loading_progress({ ...ready, chunks: { ...ready.chunks, ready: 6, queued: 3, in_flight: 1 } })).toEqual({
    stage: 'terrain',
    fraction: 0.6,
  })
  expect(loading_progress({ ...ready, render: { ...ready.render, sky_ready: false } }).stage).toBe('sky')
  expect(loading_progress({ ...ready, render: { ...ready.render, settled: false, uploads_pending: 1 } }).stage).toBe(
    'finishing'
  )
  expect(loading_progress(ready).stage).toBe('ready')
})
