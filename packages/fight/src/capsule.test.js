// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { push_bounded, capsule_export, CAPSULE_RING_LIMIT, TRACE_FORMAT_ENVELOPE } from './capsule.js'
import { input_envelope, clock_observed, ENVELOPE_VERSION } from './envelope.js'

describe('push_bounded — the ring bound', () => {
  test('appends under the limit, immutably (input ring untouched)', () => {
    const ring = [1, 2]
    const next = push_bounded(ring, 3, 5)
    expect(next).toEqual([1, 2, 3])
    expect(ring).toEqual([1, 2]) // the source array is never mutated (fight-core FP law)
    expect(next).not.toBe(ring)
  })

  test('at the limit, the OLDEST rings out — length never exceeds the bound', () => {
    let ring = []
    for (let n = 0; n < 10; n++) ring = push_bounded(ring, n, 4)
    expect(ring.length).toBe(4)
    expect(ring).toEqual([6, 7, 8, 9]) // newest 4; 0..5 rang out
  })

  test('holds a whole real fight — the largest historical capture (~1,750) fits the default bound', () => {
    expect(CAPSULE_RING_LIMIT).toBeGreaterThanOrEqual(1753)
    let ring = []
    for (let n = 0; n < 1753; n++) ring = push_bounded(ring, n)
    expect(ring.length).toBe(1753) // nothing rang out — a full fight is intact
    expect(ring[0]).toBe(0)
  })
})

describe('capsule_export — the trace_format-2 dump shape', () => {
  test('stamps format 2 + envelope version and carries the ring verbatim', () => {
    const capsules = [
      input_envelope({ session_id: '0xfeed', input_seq: 0, observed_at_ms: 10, payload: clock_observed({}) }),
    ]
    const dump = capsule_export({ session_id: '0xfeed', app_version: '1.12.45', captured_at: 99, capsules })
    expect(dump).toEqual({
      trace_format: TRACE_FORMAT_ENVELOPE,
      envelope_version: ENVELOPE_VERSION,
      app_version: '1.12.45',
      session_id: '0xfeed',
      captured_at: 99,
      capsules,
    })
    expect(dump.trace_format).toBe(2)
  })

  test('provenance flags ride only when present (converted-capture unknowables)', () => {
    const bare = capsule_export({ captured_at: 1, capsules: [] })
    expect('flags' in bare).toBe(false)
    const flagged = capsule_export({ captured_at: 1, capsules: [], flags: { arrival_timing: 'event_order' } })
    expect(flagged.flags).toEqual({ arrival_timing: 'event_order' })
  })
})
