// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

const LOCAL_RADIUS = ZONE_SIZE * 1.5
const WORLD_RADIUS = world_size / 2
const ZONE_LAYER_MIN_PX = 12
const ZONE_LABEL_MIN_PX = 48

export const WORLD_MAP_RADII = Object.freeze([
  LOCAL_RADIUS,
  LOCAL_RADIUS * 2,
  LOCAL_RADIUS * 4,
  LOCAL_RADIUS * 8,
  LOCAL_RADIUS * 16,
  LOCAL_RADIUS * 32,
  WORLD_RADIUS,
])

export const WORLD_MAP_LAST_LOD = WORLD_MAP_RADII.length - 1

export type WorldMapLod = Readonly<{
  center_x: number
  center_z: number
  radius: number
  level: number
}>

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

export const world_map_lod = (origin_x: number, origin_z: number, requested_level: number): WorldMapLod => {
  const level = clamp(Math.trunc(requested_level), 0, WORLD_MAP_LAST_LOD)
  const radius = WORLD_MAP_RADII[level]!
  const center_limit = WORLD_RADIUS - radius
  const center_x = center_limit === 0 ? 0 : clamp(origin_x, -center_limit, center_limit)
  const center_z = center_limit === 0 ? 0 : clamp(origin_z, -center_limit, center_limit)
  return Object.freeze({
    center_x,
    center_z,
    radius,
    level,
  })
}

export const step_world_map_lod = (level: number, direction: -1 | 1): number =>
  clamp(level + direction, 0, WORLD_MAP_LAST_LOD)

export const world_map_zone_lod = (
  radius: number,
  canvas_size: number
): Readonly<{ layer: boolean; labels: boolean }> => {
  const zone_pixels = (ZONE_SIZE * canvas_size) / (radius * 2)
  return Object.freeze({ layer: zone_pixels >= ZONE_LAYER_MIN_PX, labels: zone_pixels >= ZONE_LABEL_MIN_PX })
}
