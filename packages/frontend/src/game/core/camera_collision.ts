// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Vec3 } from '@aresrpg/engine'

import type { SolidFn } from './collision.ts'

/** True iff any solid voxel intersects the cube [p−r, p+r]³ (L∞ margin — corner-leak proof). */
export const cube_overlaps_solid = (solid_at: SolidFn, x: number, y: number, z: number, r: number): boolean => {
  const x1 = Math.floor(x + r)
  const y1 = Math.floor(y + r)
  const z1 = Math.floor(z + r)
  for (let cy = Math.floor(y - r); cy <= y1; cy += 1)
    for (let cz = Math.floor(z - r); cz <= z1; cz += 1)
      for (let cx = Math.floor(x - r); cx <= x1; cx += 1) if (solid_at(cx, cy, cz)) return true
  return false
}

/** Refine only the first blocked interval; keep the last proven-clean endpoint. */
const refine_clearance = (
  solid_at: SolidFn,
  origin: Vec3,
  direction: Vec3,
  range: readonly [number, number],
  margin: number
): number => {
  let [clear, blocked] = range
  for (let step = 0; step < 5; step += 1) {
    const middle = (clear + blocked) / 2
    if (
      cube_overlaps_solid(
        solid_at,
        origin[0] + direction[0] * middle,
        origin[1] + direction[1] * middle,
        origin[2] + direction[2] * middle,
        margin
      )
    )
      blocked = middle
    else clear = middle
  }
  return clear
}

/** March the margin cube outward, return the LAST proven-clean distance (0 = buried origin). */
export const wall_march = (
  solid_at: SolidFn,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max_dist: number,
  margin: number
): number => {
  const STEP = 0.25
  let clear = 0
  for (let t = 0; ; t = Math.min(t + STEP, max_dist)) {
    if (cube_overlaps_solid(solid_at, ox + dx * t, oy + dy * t, oz + dz * t, margin))
      return refine_clearance(solid_at, [ox, oy, oz], [dx, dy, dz], [clear, t], margin)
    clear = t
    if (t >= max_dist) return max_dist
  }
}
