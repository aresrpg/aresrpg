// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [team-outline] weld_smoothed_normals — the position-weld + angle-average that kills the voxel
// corner-noise on the entity outline. Locks the core property: on a HARD-normal cube the 24 per-face
// normals collapse to the 8 exact corner-diagonal normals (so an inflated shell separates only at the
// outer silhouette, not every interior cube edge). A three BoxGeometry is the perfect fixture — 24
// verts, 6 face normals, real triangulation — exercising the exact attribute layout build_outline feeds.

import { test, expect, describe } from 'bun:test'
import { BoxGeometry } from 'three'

import { weld_smoothed_normals } from '../../src/tactical/smooth_normals.js'

const INV_SQRT3 = 1 / Math.sqrt(3) // ≈ 0.5773 — each component of a normalized cube-corner diagonal

/** Quantized key for counting DISTINCT normals (2-decimal grid — well inside the assertions' tolerance). */
const nkey = (/** @type {Float32Array} */ n, /** @type {number} */ i) =>
  `${Math.round(n[i * 3] * 100)},${Math.round(n[i * 3 + 1] * 100)},${Math.round(n[i * 3 + 2] * 100)}`

describe('weld_smoothed_normals — position-welded angle-weighted normals', () => {
  test('a hard-normal cube: 24 per-face normals → 8 corner-averaged normals (each ±1/√3 diagonal)', () => {
    const g = new BoxGeometry(1, 1, 1) // 24 verts, per-face normals, 12 tris (36 index)
    const pos = g.attributes.position.array
    const nor = g.attributes.normal.array
    const idx = /** @type {NonNullable<typeof g.index>} */ (g.index).array
    expect(pos.length / 3).toBe(24) // 4 verts × 6 faces — the "24 hard normals" of the brief

    const out = weld_smoothed_normals(pos, nor, idx)
    expect(out.length).toBe(72)

    const distinct = new Set()
    for (let i = 0; i < 24; i += 1) {
      // every welded normal is unit-length …
      expect(Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2])).toBeCloseTo(1, 5)
      // … and a pure ±(1,1,1)/√3 corner diagonal (each |component| ≈ 0.5773)
      expect(Math.abs(out[i * 3])).toBeCloseTo(INV_SQRT3, 3)
      expect(Math.abs(out[i * 3 + 1])).toBeCloseTo(INV_SQRT3, 3)
      expect(Math.abs(out[i * 3 + 2])).toBeCloseTo(INV_SQRT3, 3)
      distinct.add(nkey(out, i))
    }
    expect(distinct.size).toBe(8) // ONE averaged normal per cube CORNER — not 24 per-face, not 6
  })

  test("each vertex's smoothed normal points OUT of the cube (sign matches its corner octant)", () => {
    const g = new BoxGeometry(2, 2, 2) // centered at origin → position sign IS the octant
    const pos = g.attributes.position.array
    const out = weld_smoothed_normals(
      pos,
      g.attributes.normal.array,
      /** @type {NonNullable<typeof g.index>} */ (g.index).array
    )
    for (let i = 0; i < pos.length / 3; i += 1) {
      expect(Math.sign(out[i * 3])).toBe(Math.sign(pos[i * 3]))
      expect(Math.sign(out[i * 3 + 1])).toBe(Math.sign(pos[i * 3 + 1]))
      expect(Math.sign(out[i * 3 + 2])).toBe(Math.sign(pos[i * 3 + 2]))
    }
  })

  test('a NON-indexed soup welds by position too (same 8 corner normals)', () => {
    const g = new BoxGeometry(1, 1, 1).toNonIndexed() // 36 verts, index === null
    const pos = g.attributes.position.array
    const out = weld_smoothed_normals(pos, g.attributes.normal.array, null)
    const distinct = new Set()
    for (let i = 0; i < pos.length / 3; i += 1) distinct.add(nkey(out, i))
    expect(distinct.size).toBe(8)
  })

  test('a degenerate (zero-area) weld group falls back to the original normal — finite, no NaN', () => {
    // two coincident verts + one apart ⇒ a zero-area triangle; its group has no valid face normal.
    const pos = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0])
    const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0])
    const out = weld_smoothed_normals(pos, nor, null)
    for (const v of out) expect(Number.isNaN(v)).toBe(false)
    expect(out[1]).toBeCloseTo(1, 5) // fallback preserves the original up-normal
  })
})
