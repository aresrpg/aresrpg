// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_request_limiter } from '../src/request_limiter.ts'

describe('global request limiter', () => {
  test('shares one allowance across request kinds for an address', () => {
    let now_ms = 0
    const limiter = create_request_limiter({ capacity: 2, window_ms: 1_000, now: () => now_ms })
    expect(limiter.take('0xA')).toBeTrue()
    expect(limiter.take('0xa')).toBeTrue()
    expect(limiter.take('0xA')).toBeFalse()
    now_ms = 1_001
    expect(limiter.take('0xA')).toBeTrue()
  })

  test('expired buckets are swept at the size cap instead of leaking forever', () => {
    let now_ms = 0
    const limiter = create_request_limiter({ capacity: 1, window_ms: 1_000, max_entries: 4, now: () => now_ms })
    expect(limiter.take('0x1')).toBeTrue()
    expect(limiter.take('0x2')).toBeTrue()
    expect(limiter.take('0x3')).toBeTrue()
    now_ms = 2_000
    expect(limiter.take('0x4')).toBeTrue() // size 4 — under the cap, nothing swept yet
    expect(limiter.take('0x5')).toBeTrue() // cap hit: the three expired buckets are GCed
    expect(limiter.size()).toBe(2)
  })

  test('live saturation evicts the oldest window, never resets a survivor', () => {
    let now_ms = 0
    const limiter = create_request_limiter({ capacity: 1, window_ms: 1_000, max_entries: 2, now: () => now_ms })
    expect(limiter.take('0x1')).toBeTrue()
    now_ms = 10
    expect(limiter.take('0x2')).toBeTrue()
    now_ms = 20
    expect(limiter.take('0x3')).toBeTrue() // the ceiling: 0x1 (oldest live window) is evicted
    expect(limiter.size()).toBe(2)
    expect(limiter.take('0x2')).toBeFalse() // the survivor's spent count is intact
  })
})
