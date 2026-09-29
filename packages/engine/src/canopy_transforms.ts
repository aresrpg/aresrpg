// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ChunkLod, Vec3 } from './types.ts'

export const CANOPY_LOD: Readonly<Record<ChunkLod, Readonly<{ step: number; size: number }>>> = Object.freeze({
  near: { step: 2, size: 1.75 },
  mid: { step: 4, size: 3.25 },
  far: { step: 8, size: 6.5 },
})

export const CANOPY_YAW_STEP = 2.399963
export const CANOPY_YAW_OFFSET = 0.41
/** Fixed non-axial tilt, with per-clump yaw: no large dynamically indexed shader table. */
export const canopy_rotation = (yaw: number): readonly Vec3[] => {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw)
  const cx = Math.cos(0.27),
    sx = Math.sin(0.27)
  const cz = Math.cos(0.31),
    sz = Math.sin(0.31)
  return [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ]
}
export const CANOPY_TILT = canopy_rotation(0)
export const CANOPY_JITTER: readonly Vec3[] = Array.from({ length: 16 }, (_, index) => {
  const seed = Math.imul(index + 17, 0x85ebca6b) >>> 0
  return [(seed % 3) - 1, ((seed >>> 8) % 3) - 1, ((seed >>> 16) % 3) - 1]
})

export const canopy_variant = (origin: Vec3, point: readonly number[]): number => {
  const x = origin[0] + point[0]!
  const y = origin[1] + point[1]!
  const z = origin[2] + point[2]!
  let seed = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
  seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d)
  return (seed ^ (seed >>> 15)) & 15
}
