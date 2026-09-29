// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import source from '../seed/structures/workshop.recipe.json' with { type: 'json' }
import { CHUNK_EDGE } from '../packages/engine/src/voxel_data.ts'
import { BIOME_SLOTS, validate_world_recipe } from '../packages/engine/src/world_recipe.ts'
import { decode_detail_vertices, DETAIL_STRIDE } from '../packages/engine/src/detail_artifact.ts'

import { partition_blocks } from './partition_blocks.mjs'
import { bake_schematic } from './bake_schematic.mjs'
import { compile_neighborhood } from './compile_neighborhood.mjs'

const recipe = { ...source, assets: compile_neighborhood(source) }
const GROUND = 32
const positions_of = ({ blocks, details }) => [
  ...blocks.map(([x, y, z]) => [x, y, z]),
  ...details.flatMap((cell) => {
    const vertices = decode_detail_vertices(cell.vertices)
    return Array.from({ length: vertices.length / DETAIL_STRIDE }, (_, i) =>
      cell.origin.map((value, axis) => value + vertices[i * DETAIL_STRIDE + axis])
    )
  }),
]
const bounds_of = (positions) => ({
  min: [0, 1, 2].map((axis) => Math.floor(positions.reduce((n, point) => Math.min(n, point[axis]), Infinity))),
  max: [0, 1, 2].map((axis) => Math.ceil(positions.reduce((n, point) => Math.max(n, point[axis]), -Infinity))),
})
const fixed_structure = (id, blocks) =>
  partition_blocks(blocks).map(({ origin, blocks }) => ({
    origin,
    rotation: 0,
    source: {
      name: `${id}:${origin.join(',')}`,
      size: [CHUNK_EDGE, CHUNK_EDGE, CHUNK_EDGE],
      anchor: [0, 0, 0],
      blocks,
    },
  }))

const workshop_layout = ({ assets, columns, cell_size }) => {
  let x = 0,
    z = 0,
    row_depth = 0
  const entries = assets.map((id) => {
    const bounds = bounds_of(positions_of(bake_schematic(recipe.assets, id)))
    const width = Math.ceil((bounds.max[0] - bounds.min[0] + 4) / cell_size)
    const depth = Math.ceil((bounds.max[2] - bounds.min[2] + 4) / cell_size)
    if (width > columns) throw new Error(`Workshop is too narrow for ${id}`)
    if (x + width > columns) {
      x = 0
      z += row_depth
      row_depth = 0
    }
    const entry = { id, bounds, x, z, width, depth }
    x += width
    row_depth = Math.max(row_depth, depth)
    return entry
  })
  return { entries, width: columns * cell_size, depth: (z + row_depth) * cell_size }
}

export const bake_workshop = () => {
  const { cell_size, camera } = recipe.workshop
  const { entries, width, depth } = workshop_layout(recipe.workshop)
  const modules = entries.map(({ id, bounds, x, z, width: span_x, depth: span_z }) => ({
    asset: id,
    rotation: 0,
    position: [
      x * cell_size - width / 2 + Math.floor((span_x * cell_size - bounds.min[0] - bounds.max[0]) / 2),
      0,
      z * cell_size - depth / 2 + Math.floor((span_z * cell_size - bounds.min[2] - bounds.max[2]) / 2),
    ],
    pad: [x * cell_size - width / 2, z * cell_size - depth / 2, span_x * cell_size, span_z * cell_size],
    label: [x * cell_size - width / 2 + (span_x * cell_size) / 2, GROUND + 0.3, z * cell_size - depth / 2 + 2],
  }))
  const baked = bake_schematic({ ...recipe.assets, workshop: { kind: 'building', parts: modules } }, 'workshop', [
    0,
    GROUND,
    0,
  ])
  const grid_cells = new Map()
  modules.forEach(({ pad: [x, z, w, d] }) => {
    const put = (px, pz) => grid_cells.set(`${px}:${pz}`, [px, GROUND - 1, pz, 'stone'])
    for (let dx = 0; dx <= w; dx++) {
      put(x + dx, z)
      put(x + dx, z + d)
    }
    for (let dz = 0; dz <= d; dz++) {
      put(x, z + dz)
      put(x + w, z + dz)
    }
  })
  const grid = [...grid_cells.values()]
  const world = {
    seed: 'asset-workshop',
    sea_level: 0,
    portal: false,
    atmosphere: 'clear',
    sky_rotation: 1.2,
    materials: recipe.materials,
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'workshop'])),
    biomes: [
      {
        name: 'workshop',
        landscape: [
          { x: 0, y: GROUND, land: { surface: 'ground', subsurface: 'earth', filler: 'stone' } },
          { x: 1, y: GROUND },
        ],
      },
    ],
    fixed_structures: [...fixed_structure('workshop_grid', grid), ...fixed_structure('workshop_assets', baked.blocks)],
    details: baked.details,
    scenery: {
      waterfalls: [],
      spores: [],
      vines: baked.vines,
      plants: baked.plants,
      fires: baked.fires,
    },
  }
  const validation = validate_world_recipe(world)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  const focus = modules.find(({ asset }) => asset === recipe.workshop.focus)
  if (!focus) throw new Error('Workshop focus must name a displayed asset')
  return {
    world,
    camera: {
      ...camera,
      target: [focus.position[0] + camera.target[0], camera.target[1] + GROUND, focus.position[2] + camera.target[2]],
    },
    time_of_day: recipe.time_of_day,
    labels: modules.map(({ asset, label, pad }) => ({
      id: asset,
      position: label,
      area: pad,
      featured: asset === recipe.workshop.focus,
    })),
  }
}

export const generate_asset_workshop = (check = false) => {
  const scene = bake_workshop()
  const output = `${JSON.stringify(scene)}\n`
  const path = new URL('../seed/scenes/asset_workshop.json', import.meta.url)
  if (check) {
    if (readFileSync(path, 'utf8') !== output) throw new Error('Asset workshop is stale')
  } else writeFileSync(path, output)
  return { assets: scene.labels.length, gzip_bytes: gzipSync(output, { level: 9 }).length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(generate_asset_workshop(process.argv.includes('--check')))
