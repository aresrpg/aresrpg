// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SceneryVolume } from './scenery_data.ts'
import type { Vec3 } from './types.ts'

export const LOCAL_SHAFT_DEPTH = Object.freeze({ base: 0.5, slope: 0.015 })

/** Closed ray/box interval, clipped by opaque depth and the finite integration budget. */
export const local_shaft_interval = (
  origin: Vec3,
  direction: Vec3,
  volume: SceneryVolume,
  limit: number
): readonly [number, number] | null => {
  const intervals = direction.map((component, axis) => {
    const offset = volume.center[axis]! - origin[axis]!
    const half = volume.size[axis]! / 2
    if (Math.abs(component) < 1e-8) return Math.abs(offset) <= half ? [-Infinity, Infinity] : [Infinity, -Infinity]
    const a = (offset - half) / component
    const b = (offset + half) / component
    return [Math.min(a, b), Math.max(a, b)]
  })
  const start = Math.max(0, ...intervals.map(([near]) => near!))
  const end = Math.min(limit, ...intervals.map(([, far]) => far!))
  return end > start ? [start, end] : null
}

export const local_shaft_depth_weight = (sample_depth: number, scene_depth: number): number => {
  const difference =
    Math.abs(sample_depth - scene_depth) / (LOCAL_SHAFT_DEPTH.base + scene_depth * LOCAL_SHAFT_DEPTH.slope)
  const progress = Math.max(0, Math.min(1, difference))
  return 1 - progress * progress * (3 - 2 * progress)
}
