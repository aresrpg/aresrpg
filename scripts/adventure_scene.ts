// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  BIOME_SLOTS,
  city_blocks,
  compile_runtime_world_recipe,
  create_fbm_sampler,
  landscape_height,
  mulberry,
  parse_world_recipe,
  sample_world_column,
  world_terrain,
  type FixedStructure,
  type ResourceNodeMarker,
  type TerrainHeightGrid,
  type WorldRecipe,
} from '../packages/engine/src/index.ts'
import environment from '../seed/content/adventure_environment.json'
import adventure from '../seed/content/adventure.json'
import {
  adventure_axis,
  cavern_floor,
  adventure_floor,
  adventure_path_radius as radius_at,
  adventure_noise as noise,
  ADVENTURE_GATE,
} from '../packages/frontend/src/adventure/terrain.ts'

const relief = create_fbm_sampler(1934, { period: 64, octaves: 3, gain: 0.5 })
/** The cave is excavated inside this massif; the far terrain must retain its enclosing rock too. */
const cavern_massif = (x: number, z: number): number => {
  const plan = environment.descent
  if (z < plan.start_z) return 0
  const boss = adventure.encounters.at(-1)!.position
  const tunnel = z <= boss.z ? Math.abs(x - adventure_axis(z)) / (plan.radius + 14) : Infinity
  const chamber = Math.hypot(x - boss.x, z - boss.z) / (plan.chamber_radius + 14)
  const envelope = Math.max(0, Math.min(1, (1 - Math.min(tunnel, chamber)) * 3))
  return (cavern_floor(z) + plan.arena_vault_height + plan.roof_thickness + 12) * envelope
}

const RIVER_CENTER_Z = 211
const BRIDGE_HEIGHT = 80

const forest_recipe = (): WorldRecipe => {
  const source = parse_world_recipe(world_terrain('nauvis'))
  const { ocean: _ocean, ...land } = source
  return parse_world_recipe({
    ...land,
    sea_level: environment.sea_level,
    structure_areas: [],
    materials: { ...source.materials, ...environment.materials },
    scenery: environment.scenery,
    atmosphere: environment.atmosphere,
    canopy: environment.canopy,
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'mosswood'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'mosswood',
        structure_packs: ['temperate_trees', 'temperate_rocks'],
        ravines: true,
        mountain_passes: true,
        landscape: [
          { x: 0, y: 40, land: { surface: 'moss', subsurface: 'rich_soil', filler: 'stone' } },
          { x: 0.2, y: 54 },
          { x: 0.4, y: 62 },
          { x: 0.6, y: 72 },
          { x: 0.7, y: 80 },
          { x: 0.76, y: 108 },
          { x: 0.82, y: 156 },
          { x: 0.9, y: 225 },
          { x: 1, y: 310 },
        ],
      },
    ],
  })
}

/** A continuous height field owns the canyon, mesas and walkable approach in every renderer. */
const valley_height = (x: number, z: number): number => {
  const variation = (relief(x, z) - 0.5) * 2
  const terraces = environment.terraces.map((terrace) => {
    const distance = Math.hypot((x - terrace.x) / terrace.radius_x, (z - terrace.z) / terrace.radius_z)
    const edge = Math.max(0, Math.min(1, (1 - distance + variation * 0.05) * 6))
    return environment.sea_level - 2 + (terrace.height + variation * terrace.relief - environment.sea_level + 2) * edge
  })
  const route_width = z < 142 ? 33 : 4
  const route = Math.max(0, Math.min(1, (route_width - Math.abs(x - adventure_axis(z))) / 4))
  const approach = z < 280 ? (z < 180 ? 72 : BRIDGE_HEIGHT - 1) * route : 0
  return Math.max(environment.sea_level - 2, approach, cavern_massif(x, z), ...terraces)
}

const adventure_biome = (): WorldRecipe => {
  const recipe = forest_recipe()
  const world = compile_runtime_world_recipe(recipe)
  const cell_size = 4
  const width = 208
  const depth = 192
  const target_heights = Array.from({ length: width * depth }, (_, index) => {
    const x = -288 + ((index % width) + 0.5) * cell_size
    const z = 80 + (Math.floor(index / width) + 0.5) * cell_size
    const surface = sample_world_column(world, x, z).surface_y
    const edge = Math.min((x + 288) / 64, (544 - x) / 64, (848 - z) / 80, (z - 80) / 16, 1)
    return Math.round(surface + (valley_height(x, z) - surface) * Math.max(0, edge))
  })
  const height_grid: TerrainHeightGrid = {
    min_x: -288,
    min_z: 80,
    cell_size,
    width,
    depth,
    target_heights,
    cut_cells: [],
  }
  return { ...recipe, height_grid }
}

const plan = environment.descent
const throne = adventure.encounters.at(-1)!.position
const cavern_noise = create_fbm_sampler(871, { period: 13, octaves: 2, gain: 0.5 })

const margin = Math.ceil(plan.chamber_radius * 1.2)
const origin_x = throne.x - margin
const origin_z = plan.start_z
const width = margin * 2 + 1
const depth = throne.z + margin - origin_z + 1
type Fill = Readonly<Parameters<ReturnType<typeof city_blocks>['fill']>>
const vault = (distance: number): number => Math.sqrt(Math.max(0, 1 - distance ** 2))

const cavern_material = (x: number, z: number, radius: number, lava: boolean): string => {
  if (lava) {
    const angle = Math.atan2(z - throne.z, x - throne.x)
    return Math.sin(radius * 1.3 + angle * 5) > 0.8 ? 'lava_hot' : 'lava'
  }
  return Math.abs(radius - plan.arena_radius) < 1 || radius < 4 ? 'cavern_basalt' : 'cavern_slate'
}

const cavern_column = (x: number, z: number): readonly Fill[] => {
  const lateral = Math.abs(x - adventure_axis(z))
  const radial = Math.hypot(x - throne.x, z - throne.z)
  const tunnel = z <= throne.z ? lateral / plan.radius : Infinity
  const chamber = radial / plan.chamber_radius
  const distance = Math.min(tunnel, chamber)
  const ripple = (cavern_noise(x, z) - 0.5) * 0.13
  if (distance > 1.13 + ripple) return []
  const floor = cavern_floor(z)
  const ceiling =
    floor + 7 + Math.round(Math.max(vault(tunnel) * plan.vault_height, vault(chamber) * plan.arena_vault_height))
  const lava = radial > plan.arena_radius && radial < plan.lava_radius && tunnel > 4 / plan.radius
  const top = ceiling + plan.roof_thickness + Math.round(cavern_noise(x, z) * 4)
  const local_x = x - origin_x
  const local_z = z - origin_z
  const filled: readonly Fill[] = [[local_x, local_x, floor - 9, top, local_z, local_z, 'cavern_basalt']]
  if (distance >= 1 + ripple) return filled
  const surface = (lava ? throne.y : floor) - 1
  return [
    ...filled,
    [local_x, local_x, surface, surface, local_z, local_z, cavern_material(x, z, radial, lava)],
    [local_x, local_x, surface + 1, ceiling, local_z, local_z, 'air'],
  ]
}

/** Open leaves sit against the jambs; the central arch always retains walking and camera clearance. */
const cavern_gate = () => {
  const blocks = city_blocks()
  const x = throne.x - origin_x
  const z = plan.gate.z - origin_z
  const y = cavern_floor(plan.gate.z)
  for (const side of [-1, 1]) {
    const jamb = x + side * plan.gate.half_width
    blocks.fill(jamb - 1, jamb + 1, y, y + plan.gate.height - 3, z - 2, z + 2, 'cavern_basalt')
    blocks.fill(jamb - 2, jamb + 2, y, y + 2, z - 3, z + 3, 'cavern_slate')
    blocks.fill(
      x + side * (plan.gate.half_width - 2),
      x + side * (plan.gate.half_width - 2),
      y,
      y + plan.gate.leaf_height,
      z + 1,
      z + plan.gate.leaf_depth,
      'cavern_basalt'
    )
    blocks.fill(
      x + side * (plan.gate.half_width - 2),
      x + side * (plan.gate.half_width - 2),
      y + plan.gate.leaf_height - 1,
      y + plan.gate.leaf_height - 1,
      z + 1,
      z + plan.gate.leaf_depth,
      'poison_rune'
    )
    for (const height of [4, 8, 12, 16]) blocks.set(jamb, y + height, z - 3, 'poison_rune')
  }
  for (let offset = 1 - plan.gate.half_width; offset < plan.gate.half_width; offset += 1) {
    const crown = y + plan.gate.height - Math.floor(Math.abs(offset) / 2)
    blocks.fill(x + offset, x + offset, crown, crown + 2, z - 2, z + 2, 'cavern_basalt')
    blocks.set(x + offset, crown, z - 3, 'poison_rune')
  }
  blocks.fill(x - 1, x + 1, y + plan.gate.height, y + plan.gate.height + 4, z - 3, z - 1, 'poison_rune')
  return blocks.finish()
}

const adventure_cavern = (): FixedStructure => {
  const blocks = city_blocks()
  Array.from({ length: width * depth }, (_, index) =>
    cavern_column(origin_x + (index % width), origin_z + Math.floor(index / width))
  )
    .flat()
    .forEach((fill) => blocks.fill(...fill))
  cavern_gate().forEach(([x, y, z, material]) => blocks.set(x, y, z, material))
  return {
    source: { name: 'adventure_cavern', size: [width, 128, depth], anchor: [0, 0, 0], blocks: blocks.finish() },
    origin: [origin_x, 0, origin_z],
    rotation: 0,
  }
}

const ORIGIN = [96, 0, 96] as const
const CAVE_ROCKS = [
  [116, 117],
  [137, 123],
  [108, 132],
  [130, 139],
  [115, 157],
  [141, 171],
] as const

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

const adventure_plants = (): readonly ResourceNodeMarker[] => {
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
const adventure_terrain = (): WorldRecipe => {
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

export const build_adventure_scene = () => ({ world: adventure_terrain(), resources: adventure_plants() })
