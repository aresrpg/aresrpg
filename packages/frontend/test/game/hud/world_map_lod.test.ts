// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

import {
  step_world_map_lod,
  WORLD_MAP_LAST_LOD,
  WORLD_MAP_RADII,
  world_map_lod,
  world_map_zone_lod,
} from '../../../src/game/hud/world_map_lod.ts'

describe('world map LOD', () => {
  test('starts at the current 3x3 zone lens and ends at the whole world', () => {
    expect(WORLD_MAP_RADII[0]).toBe(ZONE_SIZE * 1.5)
    expect(WORLD_MAP_RADII[WORLD_MAP_LAST_LOD]).toBe(world_size / 2)

    const world = world_map_lod(18_000, -24_000, WORLD_MAP_LAST_LOD)
    expect(world).toEqual({ center_x: 0, center_z: 0, radius: world_size / 2, level: WORLD_MAP_LAST_LOD })
  })

  test('keeps intermediate views inside world bounds without abandoning the opened location', () => {
    const middle = world_map_lod(49_000, -49_000, 2)
    const limit = world_size / 2 - WORLD_MAP_RADII[2]!

    expect(middle.center_x).toBe(limit)
    expect(middle.center_z).toBe(-limit)
  })

  test('clamps button and wheel steps at both ends', () => {
    expect(step_world_map_lod(0, -1)).toBe(0)
    expect(step_world_map_lod(0, 1)).toBe(1)
    expect(step_world_map_lod(WORLD_MAP_LAST_LOD, 1)).toBe(WORLD_MAP_LAST_LOD)
  })

  test('drops zone clutter before the whole-biome overview', () => {
    expect(world_map_zone_lod(WORLD_MAP_RADII[0]!, 768)).toEqual({ layer: true, labels: true })
    expect(world_map_zone_lod(WORLD_MAP_RADII[4]!, 768)).toEqual({ layer: true, labels: false })
    expect(world_map_zone_lod(world_size / 2, 768)).toEqual({ layer: false, labels: false })
  })
})
