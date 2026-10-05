// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  city_blocks,
  compile_runtime_world_recipe,
  create_fbm_sampler,
  landscape_height,
  mulberry,
  sample_world_column,
  type FixedStructure,
  type ResourceNodeMarker,
  type WorldRecipe,
} from '@aresrpg/engine'

import environment from '../../../../seed/content/adventure_environment.json'

import { adventure_axis, adventure_biome, cavern_floor, BRIDGE_HEIGHT, RIVER_CENTER_Z } from './biome.ts'
import { adventure_cavern, cavern_movement_area } from './cavern.ts'

export const ADVENTURE_SPAWN = Object.freeze(environment.spawn)
export const ADVENTURE_GATE = Object.freeze({ min_z: 148, max_z: 154 })
const ORIGIN = [96, 0, 96] as const
const CAVE_ROCKS = [
  [116, 117],
  [137, 123],
  [108, 132],
  [130, 139],
  [115, 157],
  [141, 171],
] as const
const noise = create_fbm_sampler(617, { period: 19, octaves: 3, gain: 0.55 })
const path_radius = environment.path.radius.map(([x, y]) => [x!, y!] as const)
const radius_at = (z: number): number => landscape_height(path_radius, z)
/** Invisible movement boundary follows the authored path without changing terrain. */
export const adventure_movement_area =
  (unlocked: boolean) =>
  (x: number, z: number): boolean => {
    if (z >= environment.descent.start_z) return unlocked && cavern_movement_area(x, z)
    const radius = z < 180 ? Math.max(3, radius_at(z) - 4) : 3.5
    return z >= 100 && (unlocked || z < ADVENTURE_GATE.min_z) && Math.abs(x - adventure_axis(z)) < radius
  }

export const adventure_floor = (world_x: number, world_z: number): number => {
  if (world_z >= environment.descent.start_z) return cavern_floor(world_z)
  const x = Math.floor(world_x)
  const z = Math.floor(world_z)
  const route = landscape_height(
    [
      [96, 72],
      [140, 72],
      [150, 73],
      [172, 76],
    ],
    z
  )
  const edge = Math.max(0, Math.abs(x - adventure_axis(z)) - 4)
  return Math.floor(route + edge * (0.16 + noise(x, z) * 0.3))
}

type Fill = Readonly<Parameters<ReturnType<typeof city_blocks>['fill']>>
const inside_gate = (z: number, margin = 0): boolean =>
  z >= ADVENTURE_GATE.min_z - margin && z <= ADVENTURE_GATE.max_z + margin

const cave_column = (x: number, z: number): readonly Fill[] => {
  const radius = radius_at(z) + (noise(x * 0.6, z) - 0.5) * 5
  const distance = Math.abs(x - adventure_axis(z))
  if (distance > radius + 4) return []
  const floor = adventure_floor(x, z)
  const vault = Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2))
  const ceiling = floor + Math.round(5 + vault * 12 + (noise(x, z + 391) - 0.5) * 7)
  const local_x = x - ORIGIN[0]
  const local_z = z - ORIGIN[2]
  const base = floor - ORIGIN[1]
  const roof = ceiling - ORIGIN[1]
  const roof_end = 130 + Math.round(noise(x, z) * 7)
  const has_roof = z < roof_end
  const top = has_roof ? roof + 4 : base - 1
  const rock = 'stone'
  const filled: readonly Fill[] = [
    [local_x, local_x, base - 4, top, local_z, local_z, rock],
    [local_x, local_x, base - 3, base - 1, local_z, local_z, 'deep_stone'],
  ]
  if (z < 100 || (has_roof && distance >= radius)) return filled
  const floor_material = distance < 2 ? 'gravel' : 'moss'
  return [
    ...filled,
    [local_x, local_x, base - 1, base - 1, local_z, local_z, floor_material],
    [local_x, local_x, base, has_roof ? roof : 119, local_z, local_z, 'air'],
  ]
}

export const adventure_plants = (): readonly ResourceNodeMarker[] => {
  const random = mulberry(418)
  const foreground = environment.foreground_plants.map((plant, index) => ({
    ...plant,
    id: `adventure_foreground_${index}`,
    y: adventure_floor(plant.x, plant.z),
    job: 'HERBALIST',
    tier: 4,
  }))
  return Array.from({ length: 520 }, (_, index) => {
    const z = Math.floor(105 + random() * 72) + 0.5
    const side = index % 2 === 0 ? -1 : 1
    const x = Math.floor(adventure_axis(z) + side * radius_at(z) * (0.48 + random() * 0.42)) + 0.5
    const item_type = environment.plants[index % environment.plants.length]!
    return { id: `adventure_plant_${index}`, x, y: adventure_floor(x, z), z, item_type, job: 'HERBALIST', tier: 4 }
  })
    .filter(
      ({ x, z }) => !inside_gate(z, 3) && CAVE_ROCKS.every(([rock_x, rock_z]) => Math.hypot(x - rock_x, z - rock_z) > 4)
    )
    .reduce<ResourceNodeMarker[]>(
      (placed, row) =>
        placed.some((other) => Math.hypot(other.x - row.x, other.z - row.z) < 2.2) ? placed : [...placed, row],
      foreground
    )
}

/** Noise-warped chambers retain one walkable route; all air, stone, and moss share voxel collision. */
export const adventure_terrain = (): WorldRecipe => {
  const source = adventure_biome()
  const world = compile_runtime_world_recipe(source)
  const blocks = city_blocks()
  Array.from({ length: 64 * 84 }, (_, index) => cave_column(96 + (index % 64), 96 + Math.floor(index / 64)))
    .flat()
    .forEach((fill) => blocks.fill(...fill))
  for (let z = 180; z < environment.descent.start_z; z += 1) {
    const path_height = landscape_height(
      [
        [180, 76],
        [194, BRIDGE_HEIGHT],
        [228, BRIDGE_HEIGHT],
      ],
      z
    )
    const floor = Math.round(path_height) - ORIGIN[1]
    const bridge = Math.abs(z - RIVER_CENTER_Z) < 18
    blocks.fill(29, 35, floor - 1, floor - 1, z - ORIGIN[2], z - ORIGIN[2], bridge ? 'temperate_wood' : 'gravel')
    blocks.fill(29, 35, floor, floor + 16, z - ORIGIN[2], z - ORIGIN[2], 'air')
  }
  Array.from({ length: 9 }, (_, index) => RIVER_CENTER_Z - 16 + index * 4).forEach((z) => {
    const riverbed = sample_world_column(world, 128, z).surface_y - ORIGIN[1]
    blocks.fill(28, 28, riverbed, BRIDGE_HEIGHT - ORIGIN[1] + 1, z - ORIGIN[2], z - ORIGIN[2], 'temperate_wood')
    blocks.fill(36, 36, riverbed, BRIDGE_HEIGHT - ORIGIN[1] + 1, z - ORIGIN[2], z - ORIGIN[2], 'temperate_wood')
  })
  blocks.fill(28, 28, BRIDGE_HEIGHT - ORIGIN[1] + 1, BRIDGE_HEIGHT - ORIGIN[1] + 1, 99, 131, 'temperate_wood')
  blocks.fill(36, 36, BRIDGE_HEIGHT - ORIGIN[1] + 1, BRIDGE_HEIGHT - ORIGIN[1] + 1, 99, 131, 'temperate_wood')
  for (const [x, z] of [
    [110, 119],
    [143, 116],
    [117, 127],
  ] as const) {
    const from = adventure_floor(x, z) + 10 - ORIGIN[1]
    blocks.fill(x - ORIGIN[0] - 2, x - ORIGIN[0] + 2, from, 119, z - ORIGIN[2] - 2, z - ORIGIN[2] + 2, 'air')
  }
  for (const plant of adventure_plants()) {
    const x = Math.floor(plant.x) - ORIGIN[0]
    const z = Math.floor(plant.z) - ORIGIN[2]
    const y = plant.y - ORIGIN[1]
    blocks.fill(x - 1, x + 1, y - 3, y - 1, z - 1, z + 1, 'moss')
    blocks.fill(x - 1, x + 1, y, y + 2, z - 1, z + 1, 'air')
  }
  const trees: readonly FixedStructure[] = environment.trees.map(({ source, x, z, scale, rotation }) => ({
    source,
    origin: [x, sample_world_column(world, x, z).surface_y, z],
    scale,
    rotation: rotation as 0 | 1 | 2 | 3,
  }))
  const route: FixedStructure = {
    source: { name: 'adventure_path', size: [64, 128, 150], anchor: [0, 0, 0], blocks: blocks.finish() },
    origin: ORIGIN,
    rotation: 0,
  }
  const rocks: readonly FixedStructure[] = CAVE_ROCKS.map(([x, z], index) => ({
    source: `grassland_rock_g${index + 1}`,
    origin: [x!, adventure_floor(x!, z!) - 1, z!],
    rotation: (index % 4) as 0 | 1 | 2 | 3,
  }))
  return Object.freeze({ ...source, fixed_structures: Object.freeze([...trees, route, ...rocks, adventure_cavern()]) })
}
