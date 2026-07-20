// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// pos-trace recorder unit — the driven-oracle trajectory tap that logs every glb position every
// frame, to verify entities are at the right place throughout movements. The recorder is pure/injectable
// (now + sink), so throttle, ring-cap, and the disabled-no-op path are all verified headless without a
// GLB or a browser. The browser wiring (window.__ARES_POS_TRACE + the ?postrace=1 flag) is exercised by
// the future spec lane; here we lock the recorder's contract.

import { test, expect, describe, afterEach } from 'bun:test'

import { create_pos_trace, pos_trace_enabled } from './pos_trace.js'

const one = (/** @type {string} */ id, /** @type {number} */ x = 0) => [{ id, cell: { x, y: x }, x, y: x, z: x }]

describe('create_pos_trace — throttle', () => {
  test('honors ~hz: a sample within the interval is dropped, one past it records', () => {
    let clock = 0
    const trace = create_pos_trace({ enabled: true, hz: 15, now: () => clock })
    // interval = 1000/15 ≈ 66.67ms
    clock = 0
    trace.record(() => one('a'))
    expect(trace.buffer.length).toBe(1) // first sample always lands (last = -Infinity)
    clock = 10
    trace.record(() => one('a')) // 10ms < 66.67ms → throttled
    expect(trace.buffer.length).toBe(1)
    clock = 70
    trace.record(() => one('a')) // 70ms since last recorded → records
    expect(trace.buffer.length).toBe(2)
  })

  test('the collect thunk is NOT invoked on a throttled tick (no projection cost)', () => {
    let clock = 0
    let collected = 0
    const trace = create_pos_trace({ enabled: true, hz: 15, now: () => clock })
    const collect = () => {
      collected += 1
      return one('a')
    }
    trace.record(collect) // t=0 → records, collect called (1)
    clock = 5
    trace.record(collect) // throttled → collect NOT called
    expect(collected).toBe(1)
  })
})

describe('create_pos_trace — ring cap', () => {
  test('never exceeds cap; the OLDEST entries are dropped', () => {
    // hz high + a monotonic clock so the throttle never blocks; cap = 3.
    let clock = 0
    const trace = create_pos_trace({ enabled: true, hz: 1000, cap: 3, now: () => (clock += 1) })
    for (const id of ['a', 'b', 'c', 'd', 'e']) trace.record(() => one(id))
    expect(trace.buffer.length).toBe(3)
    expect(trace.buffer.map((/** @type {any} */ e) => e.id)).toEqual(['c', 'd', 'e']) // a,b evicted
  })

  test('a single over-cap batch is trimmed to cap in one pass', () => {
    const trace = create_pos_trace({ enabled: true, cap: 2, now: () => 0 })
    trace.record(() => [...one('a'), ...one('b'), ...one('c'), ...one('d')])
    expect(trace.buffer.length).toBe(2)
    expect(trace.buffer.map((/** @type {any} */ e) => e.id)).toEqual(['c', 'd'])
  })
})

describe('create_pos_trace — disabled', () => {
  test('disabled recorder writes NOTHING (zero-cost prod path)', () => {
    const trace = create_pos_trace({ enabled: false, now: () => 0 })
    trace.record(() => one('a'))
    trace.record(() => one('b'))
    expect(trace.buffer.length).toBe(0)
  })
})

describe('create_pos_trace — recorded shape + reset', () => {
  test('each entry carries {t, id, cell, x, y, z}', () => {
    const trace = create_pos_trace({ enabled: true, now: () => 123 })
    trace.record(() => [{ id: 'hero', cell: { x: 4, y: 5 }, x: 1.5, y: 2.5, z: 3.5 }])
    expect(trace.buffer[0]).toEqual({ t: 123, id: 'hero', cell: { x: 4, y: 5 }, x: 1.5, y: 2.5, z: 3.5 })
  })

  test('reset() clears the buffer AND re-arms the throttle', () => {
    const clock = 100
    const trace = create_pos_trace({ enabled: true, hz: 15, now: () => clock })
    trace.record(() => one('a'))
    expect(trace.buffer.length).toBe(1)
    trace.reset()
    expect(trace.buffer.length).toBe(0)
    // same clock — without the throttle re-arm this would be dropped as "too soon"
    trace.record(() => one('a'))
    expect(trace.buffer.length).toBe(1)
  })

  test('reset() mutates the sink in place (a held reference stays valid)', () => {
    const sink = /** @type {any[]} */ ([])
    const trace = create_pos_trace({ enabled: true, sink, now: () => 0 })
    trace.record(() => one('a'))
    expect(sink.length).toBe(1)
    trace.reset()
    expect(sink.length).toBe(0)
    expect(trace.buffer).toBe(sink) // same array, never reassigned
  })
})

describe('pos_trace_enabled — the reused flag idiom', () => {
  afterEach(() => {
    delete (/** @type {any} */ (globalThis).__ARES_POS_TRACE_ON)
  })
  test('default OFF (no global, no URL)', () => {
    expect(pos_trace_enabled()).toBe(false)
  })
  test('globalThis.__ARES_POS_TRACE_ON truthy ⇒ ON (the bench addInitScript idiom)', () => {
    ;/** @type {any} */ (globalThis).__ARES_POS_TRACE_ON = 1
    expect(pos_trace_enabled()).toBe(true)
  })
  test('the off-sentinels (0, false, "0") stay OFF', () => {
    for (const v of [0, false, '0']) {
      ;/** @type {any} */ (globalThis).__ARES_POS_TRACE_ON = v
      expect(pos_trace_enabled()).toBe(false)
    }
  })
})
