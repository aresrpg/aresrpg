// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const noise = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

const cap_surface = (u: number, v: number): number => {
  const radius = Math.max(0, (0.98 - v) / 0.3)
  const x = Math.cos(u * Math.PI * 2) * radius * 9
  const z = Math.sin(u * Math.PI * 2) * radius * 9
  const cell_x = Math.floor(x)
  const cell_z = Math.floor(z)
  const spot_x = cell_x + 0.2 + noise(cell_x, cell_z) * 0.6
  const spot_z = cell_z + 0.2 + noise(cell_z + 19, cell_x) * 0.6
  const distance = Math.hypot(x - spot_x, z - spot_z)
  const spots = Math.max(0, 1 - distance / (0.12 + noise(cell_x + 71, cell_z) * 0.12))
  const mottle = Math.sin(x * 1.3 + Math.sin(z * 1.7)) * Math.cos(z * 0.8 - x * 0.4)
  return 0.79 + mottle * 0.11 + spots * 0.18
}

/** One neutral atlas: longitudinal stem fibres, radial gills, and mottled caps. */
export const mushroom_surface = (u: number, v: number): number => {
  if (v >= 0.66) return cap_surface(u, v)
  if (v >= 0.33) return 0.65 + Math.abs(Math.sin(u * Math.PI * 96)) * 0.32
  const fibres = Math.sin(u * Math.PI * 48 + Math.sin(v * 35) * 0.25)
  return 0.82 + fibres * 0.1 + Math.sin(u * Math.PI * 110 + v * 13) * 0.04
}
