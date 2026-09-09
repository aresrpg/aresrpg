// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { chain_deadline_reached, chain_now } from '../../src/modules/chain_clock.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const initial = () =>
  initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })

test('placement follows sampled chain time, regardless of a device wall clock ahead or behind', () => {
  const state = reduce_app_state(initial(), { type: 'clock/observed', chain_ms: 1_000, received_ms: 100 })
  expect(chain_now(state.chain_clock, 1_100)).toBe(2_000)
  expect(chain_deadline_reached(state.chain_clock, 61_000n, 1_100)).toBeFalse()
  expect(chain_now(null, 1_100)).toBeNull()
})

test('interpolation cannot force-start while the chain is stalled before the deadline', () => {
  const clock = { chain_ms: 60_500, received_ms: 100 }
  expect(chain_now(clock, 1_100)).toBe(61_500)
  expect(chain_deadline_reached(clock, 61_000n, 1_100)).toBeFalse()
  expect(chain_deadline_reached({ ...clock, chain_ms: 61_000 }, 61_000n, 1_100)).toBeTrue()
  expect(chain_deadline_reached({ ...clock, chain_ms: 61_000 }, 61_000n, 20_000)).toBeFalse()
})

test('stale samples cannot rewind the clock or keep a stalled heartbeat fresh', () => {
  const state = reduce_app_state(initial(), { type: 'clock/observed', chain_ms: 61_000, received_ms: 100 })
  const repeated = reduce_app_state(state, { type: 'clock/observed', chain_ms: 61_000, received_ms: 20_000 })
  const old = reduce_app_state(state, { type: 'clock/observed', chain_ms: 60_000, received_ms: 20_000 })
  expect(repeated).toBe(state)
  expect(old).toBe(state)
  expect(chain_now(repeated.chain_clock, 20_000)).toBeNull()
  expect(chain_now(state.chain_clock, 99)).toBeNull()
})

test('disconnects and invalid heartbeat timestamps clear the clock', () => {
  const state = reduce_app_state(initial(), { type: 'clock/observed', chain_ms: 61_000, received_ms: 100 })
  expect(reduce_app_state(state, { type: 'link/failed', error: 'connection lost' }).chain_clock).toBeNull()
  expect(reduce_app_state(state, { type: 'auth/disconnected' }).chain_clock).toBeNull()
  for (const chain_ms of [null, 0, -1, NaN, Infinity])
    expect(reduce_app_state(state, { type: 'clock/observed', chain_ms, received_ms: 100 }).chain_clock).toBeNull()
})
