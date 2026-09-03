// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { hash_position } from './world_noise.ts'

const U32_RANGE = 0x1_0000_0000
const PASS_CELL = 1_536
const PASS_CHANCE_BP = 4_500
const PASS_END_FEATHER = 112
const RAVINE_CELL = 2_048
const RAVINE_CHANCE_BP = 3_200
const RAVINE_END_FEATHER = 180

const smooth = (value: number): number => value * value * (3 - 2 * value)
const signed_fraction = (value: number): number => value / U32_RANGE - 0.5

const feature_axes = (
  seed: number,
  label: string,
  cell_size: number,
  x: number,
  z: number
): Readonly<{ cell_x: number; cell_z: number; along: number; across: number }> => {
  const cell_x = Math.floor(x / cell_size)
  const cell_z = Math.floor(z / cell_size)
  const center_x =
    (cell_x + 0.5) * cell_size +
    Math.round(signed_fraction(hash_position(seed, label, cell_x, cell_z, 0x165667b1)) * cell_size * 0.22)
  const center_z =
    (cell_z + 0.5) * cell_size +
    Math.round(signed_fraction(hash_position(seed, label, cell_x, cell_z, 0xd3a2646c)) * cell_size * 0.22)
  const angle = (hash_position(seed, label, cell_x, cell_z, 0xb55a4f09) / U32_RANGE) * Math.PI
  const axis_x = Math.cos(angle)
  const axis_z = Math.sin(angle)
  const offset_x = x - center_x
  const offset_z = z - center_z
  return Object.freeze({
    cell_x,
    cell_z,
    along: offset_x * axis_x + offset_z * axis_z,
    across: Math.abs(offset_x * axis_z - offset_z * axis_x),
  })
}

/** A rare, cell-local ancient road cut. It only removes mountain mass; ordinary terrain remains
 * the material and occupancy owner, so near, far, preview and collision see one surface. */
export const mountain_pass_surface_y = (
  seed: number,
  sea_level: number,
  x: number,
  z: number,
  surface_y: number
): number => {
  const feature = feature_axes(seed, 'mountain_pass', PASS_CELL, x, z)
  const chance = hash_position(seed, 'mountain_pass', feature.cell_x, feature.cell_z, 0x27d4eb2f)
  if (chance % 10_000 >= PASS_CHANCE_BP) return surface_y
  const half_length = 430 + (hash_position(seed, 'mountain_pass', feature.cell_x, feature.cell_z, 0xfd7046c5) % 151)
  const width = 13 + (hash_position(seed, 'mountain_pass', feature.cell_x, feature.cell_z, 0x94d049bb) % 10)
  if (Math.abs(feature.along) >= half_length || feature.across >= width) return surface_y

  const edge_strength = smooth(1 - feature.across / width)
  const end_strength = smooth(Math.min(1, (half_length - Math.abs(feature.along)) / PASS_END_FEATHER))
  const center_height =
    sea_level + 92 + (hash_position(seed, 'mountain_pass', feature.cell_x, feature.cell_z, 0x6a09e667) % 81)
  const grade = signed_fraction(hash_position(seed, 'mountain_pass', feature.cell_x, feature.cell_z, 0xbb67ae85)) * 0.14
  const target_y = center_height + feature.along * grade
  if (surface_y <= target_y) return surface_y
  return Math.round(surface_y + (target_y - surface_y) * edge_strength * end_strength)
}

/** A sparse natural fracture with a narrow deep center and long feathered ends. */
export const ravine_surface_y = (seed: number, sea_level: number, x: number, z: number, surface_y: number): number => {
  const feature = feature_axes(seed, 'ravine', RAVINE_CELL, x, z)
  const chance = hash_position(seed, 'ravine', feature.cell_x, feature.cell_z, 0x243f6a88)
  if (chance % 10_000 >= RAVINE_CHANCE_BP) return surface_y
  const half_length = 620 + (hash_position(seed, 'ravine', feature.cell_x, feature.cell_z, 0x85a308d3) % 241)
  const width = 22 + (hash_position(seed, 'ravine', feature.cell_x, feature.cell_z, 0x13198a2e) % 19)
  if (Math.abs(feature.along) >= half_length || feature.across >= width) return surface_y

  const cross_strength = smooth(1 - feature.across / width) ** 1.7
  const end_strength = smooth(Math.min(1, (half_length - Math.abs(feature.along)) / RAVINE_END_FEATHER))
  const depth = 38 + (hash_position(seed, 'ravine', feature.cell_x, feature.cell_z, 0x03707344) % 59)
  return Math.max(sea_level - 12, Math.round(surface_y - depth * cross_strength * end_strength))
}

export const carved_terrain_surface_y = (
  features: Readonly<{ mountain_passes?: boolean; ravines?: boolean }>,
  seed: number,
  sea_level: number,
  x: number,
  z: number,
  surface_y: number
): number => {
  const pass_surface_y = features.mountain_passes
    ? mountain_pass_surface_y(seed, sea_level, x, z, surface_y)
    : surface_y
  return features.ravines ? ravine_surface_y(seed, sea_level, x, z, pass_surface_y) : pass_surface_y
}
