// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { with_timeout } from './with_timeout'

// Regression: the marketplace + runeforge (scribe) loaders spun forever on a slow/hung personal-kiosk sweep.
// with_timeout is the never-infinite guarantee — a read MUST always terminate (load_roster.js).
describe('with_timeout', () => {
  it('passes through the resolved value when the promise settles in time', async () => {
    await expect(with_timeout(Promise.resolve(42), 1000, 'fast')).resolves.toBe(42)
  })

  it('propagates the promise own rejection (not masked by the timeout)', async () => {
    await expect(with_timeout(Promise.reject(new Error('boom')), 1000, 'rejecter')).rejects.toThrow('boom')
  })

  it('rejects with a labelled timeout error when the promise never settles', async () => {
    const never = new Promise<number>(() => {}) // hangs forever — the infinite-spinner input
    await expect(with_timeout(never, 20, 'runeforge load')).rejects.toThrow('runeforge load timed out (20ms)')
  })

  it('does not fire a late rejection once a fast read has already resolved', async () => {
    const v = await with_timeout(Promise.resolve('ok'), 10, 'clears-timer')
    expect(v).toBe('ok')
    // if the timer were not cleared it would reject ~10ms later; wait past it and confirm nothing throws
    await new Promise((r) => setTimeout(r, 30))
  })
})
