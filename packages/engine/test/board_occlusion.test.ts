// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The peephole's ramp, pinned on the host. The shader graph builds the same expression from the
// same constants; this is the only half a machine can check without a GPU, so it carries the
// LAWS the effect must never break: the arena stays solid, the world behind it stays solid, and
// nothing is ever cut with a hard edge.

import { describe, expect, test } from 'bun:test'

import { occlusion_fade_value, project_board_screen } from '../src/board_occlusion.ts'

const board = { center_ndc: [0, 0] as const, half_ndc: [0.5, 0.5] as const, view_dist: 40 }

describe('the board peephole', () => {
  test('geometry between the eye and the board dissolves', () => {
    // a tree at the board's screen centre, well in front of it
    expect(occlusion_fade_value({ ...board, frag_ndc: [0, 0], frag_dist: 10 })).toBeCloseTo(0, 5)
  })

  test('the arena itself is never dissolved', () => {
    // fragments AT the board's depth sit inside the bias, so the board and its curbs stay solid
    expect(occlusion_fade_value({ ...board, frag_ndc: [0, 0], frag_dist: 40 })).toBe(1)
    expect(occlusion_fade_value({ ...board, frag_ndc: [0, 0], frag_dist: 39 })).toBe(1)
  })

  test('the world BEHIND the board is never dissolved', () => {
    expect(occlusion_fade_value({ ...board, frag_ndc: [0, 0], frag_dist: 200 })).toBe(1)
  })

  test('the edge is feathered, never a hard clip', () => {
    // walking outward THROUGH the feather band (normalized radius 1.45 → 2.6) must pass through
    // partial values, not jump 0 → 1. Half-extent is 0.5, so radius r sits at ndc x = r * 0.5.
    const samples = [1.5, 2.0, 2.5].map((radius) =>
      occlusion_fade_value({ ...board, frag_ndc: [radius * 0.5, 0], frag_dist: 10 })
    )
    expect(samples.every((value) => value >= 0 && value <= 1)).toBeTrue()
    expect(samples.some((value) => value > 0 && value < 1)).toBeTrue()
    // and it is monotonic outward: further from the board, more visible
    expect(samples[0]!).toBeLessThanOrEqual(samples[1]!)
    expect(samples[1]!).toBeLessThanOrEqual(samples[2]!)
  })

  test('far off screen nothing melts', () => {
    expect(occlusion_fade_value({ ...board, frag_ndc: [1, 1], frag_dist: 10 })).toBe(1)
  })

  test('disarmed, every fragment is fully visible', () => {
    expect(occlusion_fade_value({ ...board, frag_ndc: [0, 0], frag_dist: 1, active: false })).toBe(1)
  })

  test('a board behind the camera projects to nothing', () => {
    const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
    // camera-space z positive means the board sits behind the eye
    expect(project_board_screen(identity, identity, [0, 0, 5], 4, 4, 0)).toBeNull()
  })

  test('a board in front projects to a centred footprint', () => {
    const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
    const projected = project_board_screen(identity, identity, [0, 0, -30], 4, 4, 0)

    expect(projected).not.toBeNull()
    expect(projected!.view_dist).toBe(30)
    expect(projected!.center_ndc[0]).toBeCloseTo(0, 5)
    expect(projected!.half_ndc[0]).toBeCloseTo(4, 5)
  })
})
