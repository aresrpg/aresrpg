// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the pure beat-trace evaluator behind SPEC §7b conformance (sibling of pacing_envelopes.ts).
// Named *_test.ts (NOT *.test.ts) on purpose: the anchor Playwright config's default testMatch would collect a
// `.test.ts` sibling as a browser spec and explode on the bun:test import (click_verify_test.ts precedent).
//   run: bun test test/gold/specs_anchor/pacing_envelopes_test.ts
// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

import { evaluate_trace, envelope, JITTER_MS, PACING_ENVELOPES, type BeatTraceRow } from './pacing_envelopes'

const beat = (t: number, kind: string, id: string | null): BeatTraceRow => ({ t, lane: 'beat', kind, id })
const vfx = (t: number, caster: string): BeatTraceRow => ({ t, lane: 'vfx', kind: 'vfx', id: caster })
const upsert = (t: number, id: string): BeatTraceRow => ({ t, lane: 'upsert', kind: 'upsert', id })

/** A clean single-mob wave: swing → vfx → floater → death, then handoff — every interval inside its row. */
const clean_wave = (base = 100_000): readonly BeatTraceRow[] => [
  beat(base, 'turn_start', null),
  beat(base + 10, 'cast', 'mob-0'),
  vfx(base + 1130, 'mob-0'), // E1 = 1120ms — inside [0, 1400]
  beat(base + 1420, 'damage', 'player'), // E2 = 290ms — inside [0, 600]
  beat(base + 3000, 'turn_end', null), // E10 = 3000ms occupancy, no dead-air gap > 3000
  beat(base + 3200, 'turn_start', null), // E8 = 200ms — inside [0, 1000]
  beat(base + 3210, 'cast', 'me'),
  vfx(base + 3300, 'me'),
  beat(base + 3500, 'damage', 'mob-0'),
  beat(base + 3700, 'death', 'mob-0'), // E4 = 200ms — inside [0, 600]
  beat(base + 5200, 'fight_end', null), // E5 hold = 1500ms — the retro-1.29 reference hold exactly
]

describe('SPEC §7b — the envelope table (the one machine home)', () => {
  test('every row carries a key, a pair, a per-bound source, and pending rows carry null bounds', () => {
    expect(PACING_ENVELOPES.length).toBeGreaterThanOrEqual(12)
    for (const row of PACING_ENVELOPES) {
      expect(row.key).toMatch(/^E\d+$/)
      expect(row.pair.length).toBeGreaterThan(0)
      expect(row.source.length).toBeGreaterThan(0)
      if (row.min_ms === null && row.max_ms === null) expect(row.source).toContain('RULING-PENDING')
    }
    // The migrated complaint-ledger numbers live HERE (one home): the 3s mob slot and the 3s end-turn floor.
    expect(envelope('E10').min_ms).toBe(3000)
    expect(envelope('E11').min_ms).toBe(3000)
    expect(JITTER_MS).toBe(50)
  })
})

describe('evaluate_trace — beat-pair envelopes over a probe trace', () => {
  test('a clean wave measures E1/E2/E4/E5/E8/E10 and reports zero violations', () => {
    const verdict = evaluate_trace(clean_wave())
    for (const key of ['E1', 'E2', 'E4', 'E5', 'E8', 'E10'])
      expect(
        verdict.measures.some((m) => m.key === key),
        `envelope ${key} was never measured on the clean fixture`
      ).toBe(true)
    expect(verdict.envelope_violations).toEqual([])
    expect(verdict.order_violations).toEqual([])
    expect(verdict.dead_air_violations).toEqual([])
    expect(verdict.teleport_violations).toEqual([])
    expect(verdict.windows.length).toBe(2)
    expect(verdict.windows[0]?.actor).toBe('mob')
    expect(verdict.windows[1]?.actor).toBe('local')
  })

  test('a floater ≥1s after its vfx lands ABOVE the E2 envelope', () => {
    const base = 200_000
    const rows = [
      beat(base, 'turn_start', null),
      beat(base + 10, 'cast', 'me'),
      vfx(base + 500, 'me'),
      beat(base + 1700, 'damage', 'mob-0'), // vfx→floater = 1200ms — the "at least 1s late" report
    ]
    const verdict = evaluate_trace(rows)
    const late = verdict.envelope_violations.find((m) => m.key === 'E2')
    expect(late, 'a 1.2s vfx→floater gap must violate E2').toBeTruthy()
    expect(late?.verdict).toBe('above')
    expect(late?.interval_ms).toBe(1200)
  })

  test('parallel AoE victims (same-frame floaters) land BELOW the E3 serial floor', () => {
    const base = 300_000
    const rows = [
      beat(base, 'cast', 'me'),
      vfx(base + 100, 'me'),
      beat(base + 400, 'damage', 'mob-0'),
      beat(base + 400, 'damage', 'mob-1'), // 0ms apart — the "never in parallel" law broken
    ]
    const verdict = evaluate_trace(rows)
    const parallel = verdict.envelope_violations.find((m) => m.key === 'E3')
    expect(parallel, 'same-frame serial victims must violate E3').toBeTruthy()
    expect(parallel?.verdict).toBe('below')
  })

  test('a floater rendered BEFORE its cast vfx is an order violation (grammar, not envelope)', () => {
    const base = 400_000
    const rows = [
      beat(base, 'cast', 'me'),
      beat(base + 200, 'damage', 'mob-0'), // floater first…
      vfx(base + 900, 'me'), // …vfx after — the grammar inversion
    ]
    const verdict = evaluate_trace(rows)
    expect(verdict.order_violations.some((v) => v.rule === 'floater_before_vfx')).toBe(true)
  })

  test('a death presented before its victim floater is an order violation', () => {
    const base = 450_000
    const rows = [
      beat(base, 'cast', 'me'),
      vfx(base + 100, 'me'),
      beat(base + 200, 'death', 'mob-0'), // death first — the insta-despawn shape
      beat(base + 800, 'damage', 'mob-0'),
    ]
    const verdict = evaluate_trace(rows)
    expect(verdict.order_violations.some((v) => v.rule === 'death_before_floater')).toBe(true)
  })

  test('an instant despawn hold (death → next beat under the E5 floor) lands BELOW', () => {
    const base = 500_000
    const rows = [
      beat(base, 'cast', 'me'),
      vfx(base + 100, 'me'),
      beat(base + 300, 'damage', 'mob-0'),
      beat(base + 400, 'death', 'mob-0'),
      beat(base + 500, 'fight_end', null), // 100ms death hold — vanish-class
    ]
    const verdict = evaluate_trace(rows)
    const held = verdict.envelope_violations.find((m) => m.key === 'E5')
    expect(held, 'a 100ms death hold must violate the E5 floor').toBeTruthy()
    expect(held?.verdict).toBe('below')
  })

  test('dead air — a silent gap swallowing a whole mob slot violates E12 inside a non-local turn', () => {
    const base = 600_000
    const rows = [
      beat(base, 'turn_start', null),
      beat(base + 10, 'cast', 'mob-0'),
      beat(base + 3600, 'damage', 'player'), // 3590ms of silence inside the mob turn
      beat(base + 3700, 'turn_end', null),
    ]
    const verdict = evaluate_trace(rows)
    expect(verdict.dead_air_violations.some((m) => m.key === 'E12' && m.verdict === 'above')).toBe(true)
  })

  test('no teleport-then-walk — a rig upsert INSIDE a walk (move → arrival) is a teleport violation', () => {
    const base = 700_000
    const rows = [
      beat(base, 'move', 'me'),
      upsert(base + 400, 'me'), // the snap-back/teleport mid-walk
      beat(base + 1500, 'arrival', 'me'),
    ]
    const verdict = evaluate_trace(rows)
    expect(verdict.teleport_violations).toEqual([{ id: 'me', at_ms: base + 400 }])
  })

  test('a legit upsert outside any walk window never flags', () => {
    const base = 800_000
    const rows = [
      upsert(base, 'me'), // initial placement
      beat(base + 1000, 'move', 'me'),
      beat(base + 2400, 'arrival', 'me'),
      upsert(base + 3000, 'me'), // post-walk reconcile snap
    ]
    expect(evaluate_trace(rows).teleport_violations).toEqual([])
  })

  test('pending rows (null bounds) never produce measures or violations', () => {
    const verdict = evaluate_trace(clean_wave())
    expect(verdict.measures.concat(verdict.envelope_violations).some((m) => m.key === 'E9')).toBe(false)
  })

  test('E7 carries the reference slide bounds but stays unmeasured until conformance samples slides', () => {
    expect(envelope('E7').min_ms).toBe(119)
    expect(envelope('E7').max_ms).toBe(119)
    expect(envelope('E7').measured).toBe(false)
    expect(evaluate_trace(clean_wave()).measures.some((m) => m.key === 'E7')).toBe(false)
  })

  test('jitter tolerance — an interval 40ms past a bound stays in (50ms frame quantum)', () => {
    const base = 900_000
    const rows = [
      beat(base, 'cast', 'me'),
      vfx(base + 1440, 'me'), // E1 max 1400 + 40 < 1400 + JITTER — still in
      beat(base + 1900, 'damage', 'mob-0'),
    ]
    const verdict = evaluate_trace(rows)
    expect(verdict.envelope_violations.filter((m) => m.key === 'E1')).toEqual([])
    expect(verdict.measures.some((m) => m.key === 'E1' && m.verdict === 'in')).toBe(true)
  })
})
