// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const HEIGHT_FOG = Object.freeze({
  base_offset: 18,
  density: 0.0007,
  falloff_height: 24,
  max_opacity: 0.22,
  near_clear: 10,
  full_distance: 60,
})

export const height_fog_density = (camera_y: number, ground_y: number, humidity: number): number => {
  const moisture = 0.45 + Math.max(0, Math.min(1, humidity)) * 0.8
  const altitude = Math.max(0, camera_y - (ground_y + HEIGHT_FOG.base_offset))
  return HEIGHT_FOG.density * moisture * Math.exp(-altitude / HEIGHT_FOG.falloff_height)
}
