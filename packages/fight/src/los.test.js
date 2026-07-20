// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { encode, lineOfSight } from './los.js'

// Mirrors packages/move/tests/combat_grid_los_test.move's `los_reference_vectors` test EXACTLY (same origin/
// obstacle/target triples, same expected verdicts) — proves the client port is verdict-identical to the
// on-chain `combat_grid::line_of_sight` this file was ported from, not just structurally similar.
describe('fight-los / lineOfSight (mirrors combat_grid_los_test.move)', () => {
  it('no obstacle straight: (0,0)->(9,0) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 0), [])).toBe(true)
  })
  it('H blocker on line: (0,0)->(9,0) obs (4,0) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 0), [encode(4, 0)])).toBe(false)
  })
  it('H target BEFORE blocker: (0,0)->(3,0) obs (4,0) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(3, 0), [encode(4, 0)])).toBe(true)
  })
  it('H target just PAST blocker: (0,0)->(5,0) obs (4,0) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(5, 0), [encode(4, 0)])).toBe(false)
  })
  it('V blocker on line: (0,0)->(0,9) obs (0,4) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(0, 9), [encode(0, 4)])).toBe(false)
  })
  it('V off-column blocker: (0,0)->(0,9) obs (1,4) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(0, 9), [encode(1, 4)])).toBe(true)
  })
  it('pure diagonal on the line: (0,0)->(9,9) obs (4,4) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 9), [encode(4, 4)])).toBe(false)
  })
  it('diagonal, blocker off by one: (0,0)->(9,9) obs (4,5) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 9), [encode(4, 5)])).toBe(true)
  })
  it('adjacent target: (0,0)->(1,0) obs (4,0) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(1, 0), [encode(4, 0)])).toBe(true)
  })
  it('adjacent diagonal target: (0,0)->(1,1) obs (5,5) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(1, 1), [encode(5, 5)])).toBe(true)
  })
  it('knight-offset blocker (2,1): (0,0)->(8,4) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(8, 4), [encode(2, 1)])).toBe(false)
  })
  it('center origin, blocker due E: (5,5)->(9,5) obs (6,5) — blocked', () => {
    expect(lineOfSight(encode(5, 5), encode(9, 5), [encode(6, 5)])).toBe(false)
  })
  it('center origin, target due W blocked: (5,5)->(0,5) obs (2,5) — blocked', () => {
    expect(lineOfSight(encode(5, 5), encode(0, 5), [encode(2, 5)])).toBe(false)
  })
  it('center origin, target due N blocked: (5,5)->(5,0) obs (5,2) — blocked', () => {
    expect(lineOfSight(encode(5, 5), encode(5, 0), [encode(5, 2)])).toBe(false)
  })
  it('center origin, NE diagonal blocked: (5,5)->(9,9) obs (7,7) — blocked', () => {
    expect(lineOfSight(encode(5, 5), encode(9, 9), [encode(7, 7)])).toBe(false)
  })
  it('center origin, SW diagonal clear (obstacle wrong quadrant): (5,5)->(0,0) obs (9,9) — clear', () => {
    expect(lineOfSight(encode(5, 5), encode(0, 0), [encode(9, 9)])).toBe(true)
  })
  it('multi-obstacle, one on the line one off: (0,0)->(9,0) obs (4,4)+(4,0) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 0), [encode(4, 4), encode(4, 0)])).toBe(false)
  })
  it('multi-obstacle, both off the line: (0,0)->(9,0) obs (4,4)+(4,5) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 0), [encode(4, 4), encode(4, 5)])).toBe(true)
  })
  it('shallow angle blocked: (0,0)->(9,3) obs (6,2) — blocked', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 3), [encode(6, 2)])).toBe(false)
  })
  it('shallow angle clear: (0,0)->(9,1) obs (3,3) — clear', () => {
    expect(lineOfSight(encode(0, 0), encode(9, 1), [encode(3, 3)])).toBe(true)
  })
})
