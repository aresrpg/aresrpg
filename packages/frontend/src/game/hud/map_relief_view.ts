// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type ReliefView = Readonly<{ center_x: number; center_z: number; radius: number }>

/** Overscan and a stable sample lattice keep small drags inside the same terrain texture. */
export const relief_sample_view = (view: ReliefView): ReliefView => {
  const step = view.radius / 2
  // Normalize signed zero so equivalent views retain identical React dependencies.
  return {
    center_x: Math.round(view.center_x / step) * step + 0,
    center_z: Math.round(view.center_z / step) * step + 0,
    radius: view.radius * 1.5,
  }
}

/** Reproject a completed terrain image into the current camera without resampling it. */
export const relief_image_rect = (view: ReliefView, sampled: ReliefView, size: number) => {
  const scale = size / (view.radius * 2)
  return {
    x: size / 2 + (sampled.center_x - sampled.radius - view.center_x) * scale,
    y: size / 2 + (sampled.center_z - sampled.radius - view.center_z) * scale,
    size: sampled.radius * 2 * scale,
  }
}
