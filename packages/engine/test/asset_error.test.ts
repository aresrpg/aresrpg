// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { missing_asset_error, terrain_failure } from '../src/asset_error.ts'
import { read_worker_error, worker_error } from '../src/worker_reply.ts'

test('missing city assets retain their machine-readable reason across worker boundaries', () => {
  const reply = structuredClone(worker_error(missing_asset_error('Generated city artifact failed to load: 404')))
  expect(reply).toEqual({ error: 'Generated city artifact failed to load: 404', missing_asset: true })
  expect(terrain_failure(read_worker_error(reply)).code).toBe('asset_missing')
  expect(terrain_failure(new Error('Terrain planning failed', { cause: read_worker_error(reply) })).code).toBe(
    'asset_missing'
  )
})

test('ordinary terrain failures never become missing assets based on message wording', () => {
  const error = new Error('Generated city artifact failed to load: 404')
  const reply = worker_error(error)
  expect(reply).toEqual({ error: error.message })
  expect(terrain_failure(read_worker_error(reply)).code).toBe('terrain_failed')
  expect(terrain_failure(new Error('GPU failure')).code).toBe('terrain_failed')
  expect(terrain_failure(read_worker_error({ error: 'missing', missing_asset: 'true' } as never)).code).toBe(
    'terrain_failed'
  )
})
