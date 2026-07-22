// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the pure trajectory-conformance evaluator behind the "right place during movements" lock
// (sibling of trajectory_eval.ts). Named *_test.ts (NOT *.test.ts) on purpose: the anchor Playwright config's
// default testMatch (`*.@(spec|test).ts`) would collect a `.test.ts` sibling as a browser spec and explode on
// the bun:test import (click_verify_test.ts / pacing_envelopes_test.ts precedent).
//   run: bun test test/gold/specs_anchor/trajectory_eval_test.ts
// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

import { evaluate_trajectory, type MoveBeat, type PosSample, type Vec2 } from './trajectory_eval'

const sample = (t: number, id: string, x: number, z: number): PosSample => ({ t, id, x, y: 0, z })

/** A clean straight walk: `steps`+1 samples from `from` to `to`, distance-to-destination strictly
 *  decreasing, each step a fraction of a cell apart. dt=66ms ≈ the 15Hz tap interval. */
const straight_walk = (id: string, from: Vec2, to: Vec2, steps: number, base_t = 0, dt = 66): PosSample[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps
    return sample(base_t + i * dt, id, from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f)
  })

const ORIGIN: Vec2 = { x: 0, z: 0 }

describe('evaluate_trajectory — a clean walk conforms', () => {
  test('a straight multi-cell walk reports ZERO violations of any class', () => {
    const to: Vec2 = { x: 4, z: 0 }
    const trace = straight_walk('p', ORIGIN, to, 8)
    const moves: MoveBeat[] = [{ id: 'p', kind: 'walk', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })
    expect(v.movers).toEqual(['p'])
    expect(v.discontinuity_violations).toEqual([])
    expect(v.monotonic_violations).toEqual([])
    expect(v.teleport_violations).toEqual([])
    expect(v.arrival_violations).toEqual([])
  })

  test('reaching AND dwelling on the destination is not mistaken for a snap-then-run', () => {
    const to: Vec2 = { x: 3, z: 0 }
    // the honest walk, then three samples sitting on the target — the ONLY destination-adjacent samples,
    // none of them followed by a departure, so the snap-then-run detector must stay silent.
    const trace = [
      ...straight_walk('p', ORIGIN, to, 6),
      sample(600, 'p', 3, 0),
      sample(666, 'p', 3, 0),
      sample(732, 'p', 3, 0),
    ]
    const moves: MoveBeat[] = [{ id: 'p', kind: 'walk', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })
    expect(v.discontinuity_violations).toEqual([])
    expect(v.arrival_violations).toEqual([])
  })

  test('the defaults resolve (cell_size 1.33) — a sub-cell-step walk stays clean with no opts', () => {
    const to: Vec2 = { x: 5.32, z: 0 } // 4 cells at DEFAULT_CELL_SIZE
    const trace = straight_walk('p', ORIGIN, to, 8)
    const moves: MoveBeat[] = [{ id: 'p', kind: 'walk', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves)
    expect(v.discontinuity_violations).toEqual([])
    expect(v.monotonic_violations).toEqual([])
    expect(v.arrival_violations).toEqual([])
  })
})

describe('evaluate_trajectory — THE SNAP-THEN-RUN LOCK (620f8f6f)', () => {
  test('a destination-adjacent sample BEFORE the path FAILS with the named snap_then_run signature', () => {
    const to: Vec2 = { x: 4, z: 0 }
    // the fixed bug's shape: the rig is placed ON the target first (the snap), THEN honestly walks the path.
    const trace = [sample(0, 'p', 4, 0), ...straight_walk('p', ORIGIN, to, 8, 66)]
    const moves: MoveBeat[] = [{ id: 'p', kind: 'walk', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })

    const named = v.discontinuity_violations.find((d) => d.signature === 'snap_then_run')
    expect(named, 'the snap-then-run signature must be NAMED, not just a generic jump').toBeTruthy()
    expect(named?.id).toBe('p')
    expect(named?.during).toBe('walk')
    // and the corroborating signals: the raw snap jump AND the broken monotonic progress (the roll-back).
    expect(v.discontinuity_violations.some((d) => d.signature === 'jump')).toBe(true)
    expect(v.monotonic_violations.length).toBeGreaterThan(0)
  })

  test('a raw snap with NO declared move (geometry-only mode, moves=[]) is still caught, during=null', () => {
    const trace = [sample(0, 'p', 0, 0), sample(66, 'p', 4, 0)] // a 4-cell jump in one 66ms frame
    const v = evaluate_trajectory(trace, [], { cell_size: 1 })
    expect(v.discontinuity_violations.length).toBe(1)
    expect(v.discontinuity_violations[0]?.during).toBe(null)
    expect(v.discontinuity_violations[0]?.signature).toBe('jump')
  })
})

describe('evaluate_trajectory — the teleport law (③ exactly one discontinuity)', () => {
  test('a teleport with exactly ONE jump PASSES and its lawful jump is excused from ①', () => {
    const to: Vec2 = { x: 4, z: 0 }
    const trace = [sample(0, 'p', 0, 0), sample(66, 'p', 0, 0), sample(132, 'p', 4, 0), sample(198, 'p', 4, 0)]
    const moves: MoveBeat[] = [{ id: 'p', kind: 'teleport', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })
    expect(v.teleport_violations).toEqual([])
    expect(v.discontinuity_violations).toEqual([]) // the one lawful jump is NOT a violation
    expect(v.arrival_violations).toEqual([])
  })

  test('a teleport with TWO jumps FAILS the exactly-one law', () => {
    const to: Vec2 = { x: 4, z: 0 }
    const trace = [sample(0, 'p', 0, 0), sample(66, 'p', 10, 10), sample(132, 'p', 4, 0)]
    const moves: MoveBeat[] = [{ id: 'p', kind: 'teleport', to, t_start: 0, t_end: 1000 }]
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })
    expect(v.teleport_violations.length).toBe(1)
    expect(v.teleport_violations[0]?.found).toBe(2)
  })
})

describe('evaluate_trajectory — arrival, sampling gaps, geometry', () => {
  test('④ a move that stops short of its destination centre flags arrival, nothing else', () => {
    const trace = straight_walk('p', ORIGIN, { x: 4, z: 0 }, 8) // rig stops at (4,0)
    const moves: MoveBeat[] = [{ id: 'p', kind: 'walk', to: { x: 6, z: 0 }, t_start: 0, t_end: 1000 }] // intended (6,0)
    const v = evaluate_trajectory(trace, moves, { cell_size: 1 })
    expect(v.arrival_violations.length).toBe(1)
    expect(v.arrival_violations[0]?.off_cells).toBeCloseTo(2, 5)
    expect(v.discontinuity_violations).toEqual([])
    expect(v.monotonic_violations).toEqual([])
  })

  test('a jump across a SAMPLING GAP (dt > max_dt_ms) is not a false snap', () => {
    const trace = [sample(0, 'p', 0, 0), sample(400, 'p', 4, 0)] // 400ms apart > default 250ms
    expect(evaluate_trajectory(trace, [], { cell_size: 1 }).discontinuity_violations).toEqual([])
  })

  test('the discontinuity threshold scales with cell_size', () => {
    const trace = [sample(0, 'p', 0, 0), sample(66, 'p', 1, 0)] // a flat 1.0-world-unit step
    expect(evaluate_trajectory(trace, [], { cell_size: 1 }).discontinuity_violations).toEqual([]) // 1.0 cell < 1.5
    expect(evaluate_trajectory(trace, [], { cell_size: 0.5 }).discontinuity_violations.length).toBe(1) // 2.0 cells > 1.5
  })

  test('violations are isolated per mover — a clean walker never inherits a snapper’s reds', () => {
    const to: Vec2 = { x: 4, z: 0 }
    const clean = straight_walk('clean', ORIGIN, to, 8)
    const snapper = [sample(0, 'snapper', 4, 0), ...straight_walk('snapper', ORIGIN, to, 8, 66)]
    const moves: MoveBeat[] = [
      { id: 'clean', kind: 'walk', to, t_start: 0, t_end: 2000 },
      { id: 'snapper', kind: 'walk', to, t_start: 0, t_end: 2000 },
    ]
    const v = evaluate_trajectory([...clean, ...snapper], moves, { cell_size: 1 })
    expect(v.movers).toEqual(['clean', 'snapper'])
    expect(v.discontinuity_violations.length).toBeGreaterThan(0)
    expect(v.discontinuity_violations.every((d) => d.id === 'snapper')).toBe(true)
    expect(v.monotonic_violations.every((r) => r.id === 'snapper')).toBe(true)
  })
})
