// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, writeFileSync } from 'node:fs'

import { detail_builder } from '../packages/engine/src/detail_builder.ts'
import { create_ridged_sampler } from '../packages/engine/src/world_noise.ts'
import {
  BIOME_SLOTS,
  validate_world_recipe,
  compile_runtime_world_recipe,
  sample_world_column,
} from '../packages/engine/src/world_recipe.ts'
import { sample_far_height } from '../packages/engine/src/far_surface.ts'
import { place_tree } from '../packages/engine/src/tree_placement.ts'
import { QUALITY_OPTIONS } from '../packages/engine/src/quality.ts'

import { partition_blocks } from './partition_blocks.mjs'
import { harbor_lamp, harbor_railing, harbor_canvas } from './harbor_details.mjs'
import { author_house, house_footprint } from './main_menu_buildings.mjs'
import { dress_harbor } from './main_menu_landmarks.mjs'

const root = new URL('../', import.meta.url)
const recipe = JSON.parse(readFileSync(new URL('seed/scenes/main_menu.recipe.json', root), 'utf8'))
const { types } = JSON.parse(readFileSync(new URL('seed/structures/types.json', root), 'utf8'))
const blocks = new Map()
const set = (x, y, z, material) => blocks.set(`${x},${y},${z}`, [x, y, z, material])
const fill = (x0, x1, y0, y1, z0, z1, material) => {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, material)
}
const details = detail_builder()
const glows = []
const vines = []
const footprints = recipe.houses.map(house_footprint)
recipe.houses.forEach((house) => author_house(house, { set, glows, details, vines }))
// Snow-capped stone stairs tie the terraces together instead of leaving isolated cottages.
for (let step = 0; step < 18; step++) {
  const y = 45 + Math.floor(step * 0.7)
  fill(48, 53, 43, y, 42 + step, 42 + step, 'stone')
  fill(48, 53, y + 1, y + 1, 42 + step, 42 + step, 'snow')
}

// Foreground pier frames the view; opposite jetties step out into the inlet.
for (const [x, z, width, length] of recipe.piers) {
  fill(x, x + width, 43, 44, z, z + length, 'wood')
  for (let i = 0; i <= length; i += 8) {
    fill(x, x + 1, 35, 45, z + i, z + i + 1, 'wood')
    fill(x + width - 1, x + width, 35, 45, z + i, z + i + 1, 'wood')
    fill(x - 1, x + 2, 46, 46, z + i - 1, z + i + 2, 'snow')
  }
  fill(x + 2, x + width - 2, 45, 45, z, z + length, 'snow')
  harbor_railing(details, [x, 47, z], [x, 47, z + length])
  for (let edge = 0; edge < length; edge += 8)
    details.rope([x + width, 46, z + edge], [x + width, 46, z + Math.min(edge + 8, length)], 0.7, 0.09, 'rope')
}
// Clinker hulls with curved prows, raised gunwales, ribs, benches and furled canvas.
const boat = (x, z, length, width) => {
  for (let row = 0; row <= length; row++) {
    const half = Math.max(1, Math.round(width * Math.sin(((row + 1) / (length + 2)) * Math.PI)))
    const tip = Math.round(3 * (1 - Math.sin((row / length) * Math.PI)))
    fill(x - half + 1, x + half - 1, 43, 43, z + row, z + row, 'wood')
    for (const side of [-1, 1]) {
      fill(x + side * half, x + side * half, 41, 45 + tip, z + row, z + row, 'wood')
      set(x + side * half, 46 + tip, z + row, 'trim')
    }
    if (row % 5 === 0) fill(x - half, x + half, 44, 44, z + row, z + row, 'trim')
  }
  const mast_z = z + Math.floor(length / 2)
  details.beam([x, 43, mast_z], [x, 70, mast_z], 0.65, 0.65, 'trim')
  details.beam([x - width - 2, 66, mast_z], [x + width + 2, 66, mast_z], 0.4, 0.4, 'wood')
  harbor_canvas(details, { x: x - width, y: 65, z: mast_z + 0.6, width: width * 2, height: 13, material: 'sail' })
  for (const side of [-1, 1]) {
    details.rope([x, 69, mast_z], [x + side * width * 0.7, 46, mast_z + length * 0.35], 0.25, 0.09, 'rope')
    details.rope([x, 69, mast_z], [x + side * width * 0.7, 46, mast_z - length * 0.35], 0.25, 0.09, 'rope')
    harbor_lamp(details, glows, x + side * width * 0.5, 44, z + 5)
  }
}
boat(20, 28, 42, 8)
boat(38, 78, 34, 6)
boat(-26, 28, 32, 7)
for (const [x, z] of [
  [-45, -38],
  [-45, -10],
  [39, 18],
  [50, 57],
  [71, 90],
]) {
  harbor_lamp(details, glows, x, 45, z, Math.abs(z) < 40 ? 28 : undefined)
}
const ridge_field = create_ridged_sampler(947, { period: 180, octaves: 4, gain: 0.55 })
const channel_center = (z) => -Math.max(0, z - recipe.channel.bend_start) * recipe.channel.bend_strength
const height_at = (x, z) => {
  const channel = recipe.channel.width + z * recipe.channel.widening
  const bend = channel_center(z)
  const bank = Math.abs(x - bend) - channel
  const shore =
    28 +
    Math.max(0, Math.min(1, (bank + 16) / 18)) * 12 +
    Math.max(0, Math.min(1, bank / 20)) * (24 + Math.max(0, z) * 0.09 + ridge_field(x, z) * 48)
  const peaks = recipe.peaks.map(([px, pz, radius, height]) => {
    const distance = Math.hypot(
      (x - px + Math.sin(z * 0.033) * 17) / radius,
      (z - pz + Math.sin(x * 0.047) * 14) / radius
    )
    const angle = Math.atan2(z - pz, x - px)
    const ridges = 1 + Math.sin(angle * 5 + px) * 0.14 + Math.sin(angle * 9) * 0.07
    const folds = Math.sin(x * 0.057 + z * 0.036) * Math.sin(z * 0.071) * 9
    return (
      28 +
      Math.max(0, 1 - distance * ridges) ** 1.1 * height * (0.72 + ridge_field(x * 1.4, z * 1.4) * 0.3) +
      Math.max(0, 1 - distance) * folds
    )
  })
  const spires = recipe.ridges.map(([px, pz, width, height]) => {
    const distance = Math.hypot((x - px) / width, (z - pz) / (width * 0.7))
    return 28 + Math.max(0, 1 - distance) ** 0.65 * height
  })
  const ravine =
    Math.max(0, 1 - Math.abs(x + 106 + Math.sin(z * 0.03) * 7) / 9) * Math.max(0, 1 - Math.abs(z - 86) / 48) * 20
  const ripples = Math.sin(x * 0.043) * Math.cos(z * 0.031) * Math.max(0, Math.min(1, bank / 25)) * 5
  const ground = footprints.reduce(
    (ground, { min_x, max_x, min_z, max_z, y }) => {
      const distance = Math.hypot(Math.max(min_x - 3 - x, 0, x - max_x - 3), Math.max(min_z - 3 - z, 0, z - max_z - 3))
      const blend = Math.max(0, 1 - distance / 12)
      return ground + (y - ground) * blend
    },
    Math.max(shore + ripples, ...peaks, ...spires) - ravine
  )
  const pier = recipe.piers.some(([px, pz, width, length]) =>
    [x >= px, x <= px + width, z >= pz, z <= pz + length].every(Boolean)
  )
  return pier ? Math.min(ground, recipe.sea_level - 2) : ground
}
const grid = { min_x: -640, min_z: -192, cell_size: 8, width: 160, depth: 144 }
const target_heights = Array.from({ length: grid.width * grid.depth }, (_, index) =>
  Math.round(
    height_at(grid.min_x + ((index % grid.width) + 0.5) * 8, grid.min_z + (Math.floor(index / grid.width) + 0.5) * 8)
  )
)
const terrain_recipe = {
  seed: 'ares-winter-harbor',
  sea_level: recipe.sea_level,
  liquid: 'water',
  atmosphere: 'winter',
  sky_rotation: recipe.sky_rotation,
  portal: false,
  materials: recipe.materials,
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'winter'])),
  biomes: [
    {
      name: 'winter',
      landscape: [
        { x: 0, y: 28, land: { surface: 'snow', subsurface: 'stone', filler: 'rock' } },
        { x: 1, y: 28 },
      ],
    },
  ],
  height_grid: { ...grid, target_heights, cut_cells: [] },
}

const tree_world = compile_runtime_world_recipe(terrain_recipe, { structures: false })
const ground_at = (x, z) => sample_world_column(tree_world, x, z).surface_y

for (const [x, z, radius] of [
  [-28, -48, 5],
  [-35, -22, 4],
  [9, 1, 3],
  [16, 65, 4],
  [-9, 80, 3],
]) {
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius + Math.sin(dx * 2 + dz) * 3) continue
      set(x + dx, 42, z + dz, 'ice')
      if ((dx + dz) % 3 !== 0) set(x + dx, 43, z + dz, 'snow')
    }
}
for (const [x, z, radius] of [
  [-26, -69, 5],
  [-52, -49, 6],
  [3, -44, 4],
  [57, 6, 4],
]) {
  const ground = Math.max(42, ground_at(x, z))
  const side = radius * 2 + 1
  for (let index = 0; index < radius * side * side; index++) {
    const y = Math.floor(index / (side * side))
    const dx = (index % side) - radius
    const dz = (Math.floor(index / side) % side) - radius
    if (dx * dx + dz * dz + (y * 1.4) ** 2 > radius * radius) continue
    set(x + dx, ground + y, z + dz, y > radius * 0.25 ? 'snow' : 'rock')
  }
}
dress_harbor({ fill, set, details, ground: ground_at, glows, recipe })

// Match the engine's chunk boundary: empty space must not reserve five vertical layers
// across the whole harbor merely because distant buildings share an authored source.
for (const [x, z, source] of [
  [-85, -48, 'taiga_huge_sapin_g1'],
  [55, -50, 'taiga_huge_sapin_g2'],
]) {
  const tree = place_tree(tree_world, source, x, ground_at(x, z), z, 1, 0)
  for (const packed of tree.type.packed_voxels)
    set(
      tree.x + (packed & 255),
      tree.y + ((packed >>> 16) & 255),
      tree.z + ((packed >>> 8) & 255),
      tree_world.materials.entries[packed >>> 24].name
    )
}
const structures = partition_blocks([...blocks.values()]).map(({ origin, blocks: local }) => ({
  source: { name: `winter_harbor_${origin.join(':')}`, size: [32, 32, 32], anchor: [0, 0, 0], blocks: local },
  origin,
  rotation: 0,
}))
for (let z = -15; z < 245; z += 17)
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (69 + z * 0.22 + Math.sin(z * 1.7) * 17)
    const y = ground_at(x, z)
    const source = z % 3 === 0 ? 'taiga_big_sapin_neige_g1' : 'taiga_big_sapin_neige_g2'
    structures.push({ source, origin: [Math.round(x), y, z], rotation: Math.abs(z) % 4 })
  }
for (const [x, z, scale] of [
  [-49, -10, 1],
  [-68, -12, 1],
  [48, -1, 1],
]) {
  structures.push({
    source: 'taiga_big_sapin_neige_g2',
    origin: [x, ground_at(x, z), z],
    rotation: 0,
    scale,
  })
}
const forest = Array.from({ length: 150 }, (_, index) => ({
  x: Math.round((index % 2 ? -1 : 1) * (82 + ((index * 0.6180339) % 1) * 100)),
  z: Math.round(-15 + ((index * 0.4142135) % 1) * 190),
}))
  .filter(
    ({ x, z }) =>
      !footprints.some(
        ({ min_x, max_x, min_z, max_z }) => x > min_x - 5 && x < max_x + 5 && z > min_z - 5 && z < max_z + 5
      )
  )
  .filter(
    ({ x, z }) =>
      !recipe.castles.some(({ position: [cx, , cz] }) => x > cx - 12 && x < cx + 55 && z > cz - 12 && z < cz + 42)
  )
for (const { x, z } of forest)
  structures.push({ source: 'taiga_big_sapin_neige_g2', origin: [x, ground_at(x, z), z], rotation: 0 })
const resources = Array.from({ length: 20 }, (_, index) => {
  const x = -35 - ((index * 0.6180339) % 1) * 9
  const z = -30 - ((index * 0.4142135) % 1) * 25
  return {
    id: `winter-dressing-${index}`,
    x,
    y: 46,
    z,
    item_type: index % 7 === 0 ? 'arcaneshroom' : 'aloe_vera',
    job: 'HERBALIST',
    tier: 1,
    scale: 0.7 + (index % 4) * 0.18,
  }
})
const plants = Array.from({ length: 220 }, (_, index) => {
  const side = index % 2 ? -1 : 1
  const z = -45 + ((index * 0.4142135) % 1) * 185
  const x = side * (59 + ((index * 0.6180339) % 1) * 30 + Math.max(0, z) * 0.15)
  return {
    ...recipe.flora_palette[index % recipe.flora_palette.length],
    center: [x, ground_at(x, z), z],
    scale: 1 + (index % 5) * 0.22,
  }
})
const world = {
  ...terrain_recipe,
  details: details.finish(),
  fixed_structures: structures.filter(
    (row) =>
      typeof row.source !== 'string' ||
      !footprints.some(
        ({ min_x, max_x, min_z, max_z }) =>
          row.origin[0] > min_x - 4 &&
          row.origin[0] < max_x + 4 &&
          row.origin[2] > min_z - 4 &&
          row.origin[2] < max_z + 4
      )
  ),
  scenery: {
    ...recipe.scenery,
    plants,
    vines: [...recipe.scenery.vines, ...vines],
    glows,
  },
}
// Validate tree palettes at generation time; a renamed asset must not silently disappear.
for (const row of structures.filter((row) => typeof row.source === 'string'))
  if (!types[row.source]) throw new Error(`Unknown tree ${row.source}`)
const horizon = tree_world
const distant_pines = Array.from({ length: 440 }, (_, index) => {
  const z = 360 + ((index * 0.4142135) % 1) * 300
  const bend = index % 3 === 0 ? 0 : channel_center(z)
  const x = bend + (index % 2 ? -1 : 1) * (70 + ((index * 0.6180339) % 1) * 130)
  const heights = QUALITY_OPTIONS.map((quality) => sample_far_height(horizon, quality, x, z))
  return { index, x, z, low: Math.min(...heights), high: Math.max(...heights) }
})
  .filter((row) => row.high - row.low <= 8 && row.low > recipe.sea_level + 4)
  .slice(0, 110)
  .map(({ x, z, low, index }) => ({
    kind: 'pine',
    center: [x, low - 1, z],
    scale: 3.6 + (index % 4) * 0.3,
    color: recipe.far_forest.color,
    accent: recipe.far_forest.accent,
  }))
const scene_world = {
  ...world,
  water_reflection: 'planar',
  water_surface: 'frozen_shore',
  scenery: { ...world.scenery, plants: [...world.scenery.plants, ...distant_pines] },
}
const scene_resources = resources
const validation = validate_world_recipe(scene_world)
if (!validation.ok) throw new Error(validation.errors.join('\n'))
const output =
  JSON.stringify({
    camera: recipe.camera,
    character: recipe.character,
    residents: recipe.residents,
    time_of_day: recipe.time_of_day,
    resources: scene_resources,
    world: scene_world,
  }) + '\n'
const path = new URL('seed/scenes/main_menu.json', root)
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) throw new Error('Main-menu scene is stale')
} else writeFileSync(path, output)
