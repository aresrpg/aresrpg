// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { client_to_chain_coordinate, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'

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

export type WorldMapZoneTarget = Readonly<{ zx: number; zz: number; x: number; z: number }>

/** Canvas click → the clicked zone and its legal chain-space center. */
export const world_map_zone_target = (
  view: Readonly<{ center_x: number; center_z: number; radius: number }>,
  canvas_x: number,
  canvas_z: number,
  canvas_size: number
): WorldMapZoneTarget => {
  const client_x = view.center_x + (clamp(canvas_x, 0, canvas_size) / canvas_size - 0.5) * view.radius * 2
  const client_z = view.center_z + (clamp(canvas_z, 0, canvas_size) / canvas_size - 0.5) * view.radius * 2
  const chain_x = clamp(Math.floor(client_to_chain_coordinate(client_x)), 0, world_size - 1)
  const chain_z = clamp(Math.floor(client_to_chain_coordinate(client_z)), 0, world_size - 1)
  const { zx, zz } = zone_of(chain_x, chain_z)
  return Object.freeze({
    zx,
    zz,
    x: Math.min(world_size - 1, zx * ZONE_SIZE + ZONE_SIZE / 2),
    z: Math.min(world_size - 1, zz * ZONE_SIZE + ZONE_SIZE / 2),
  })
}
