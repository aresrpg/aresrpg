// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// build_export_payload (issue #522 follow-up, owner ruling 2026-07-24) — the pure, testable seam
// export_fight_trace() extends minimally: bundle the shadow's last divergence capsule into the SAME download
// as the replay trace, one button/one file, the shadow half only when present. Pure — no DOM, no Blob/anchor
// (see fight_trace_export.js's header for why the download mechanics themselves stay untested at this layer).
import { describe, expect, test } from 'bun:test'

import { build_export_payload } from './fight_trace_export.js'

const trace = { trace_format: 1, fight_id: '0xfeed', app_version: 'test', captured_at: 1000, inputs: [] }

describe('build_export_payload', () => {
  test('no shadow capsule → the trace passes through byte-identical (back-compat: no new field added)', () => {
    expect(build_export_payload(trace, null)).toEqual(trace)
    expect(build_export_payload(trace, null)).not.toHaveProperty('shadow_capsule')
  })

  test('a shadow capsule present → bundled as one extra top-level field, the trace itself untouched', () => {
    const shadow_capsule = { trace_format: 2, envelope_version: 1, session_id: '0xfeed', capsules: [] }
    const payload = build_export_payload(trace, shadow_capsule)
    expect(payload).toEqual({ ...trace, shadow_capsule })
    expect(payload.trace_format).toBe(1) // the REPLAY trace's own format tag is never overwritten
    expect(payload.shadow_capsule.trace_format).toBe(2) // the shadow half keeps its own
  })

  test('undefined shadow capsule behaves exactly like null (both mean "nothing to bundle")', () => {
    expect(build_export_payload(trace, undefined)).toEqual(trace)
  })
})
