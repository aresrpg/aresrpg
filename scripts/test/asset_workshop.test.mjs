// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import source from '../../seed/structures/workshop.recipe.json'
import {
  compile_runtime_world_recipe,
  validate_world_recipe,
  sample_world_column,
} from '../../packages/engine/src/world_recipe.ts'
import { decode_detail_vertices } from '../../packages/engine/src/detail_artifact.ts'
import { bake_workshop, generate_asset_workshop } from '../generate_asset_workshop.mjs'
import { bake_schematic } from '../bake_schematic.mjs'
import { compile_neighborhood } from '../compile_neighborhood.mjs'

const recipe = { ...source, assets: compile_neighborhood(source) }

test('unknown assets fail instead of baking empty previews', () => {
  expect(() => bake_schematic(recipe.assets, 'missing')).toThrow('Unknown schematic')
})

test('house architecture uses only the approved grid pieces', () => {
  const buildings = Object.values(recipe.assets).filter(({ kind }) => kind === 'building')
  expect(buildings.length).toBeGreaterThan(0)
  for (const building of buildings) {
    expect(building.details).toBeUndefined()
    expect(building.voxels).toBeUndefined()
    for (const [shape, origin] of building.pieces ?? []) {
      expect(['block', 'slab', 'stair', 'stair_inner', 'stair_outer']).toContain(shape)
      expect(origin.every(Number.isInteger)).toBe(true)
    }
  }
})

test('the exterior stair begins at terrain height and shares its supporting masonry', () => {
  const { pieces } = recipe.assets.house_architecture
  const stairs = pieces.filter(([shape, , material]) => shape === 'stair' && material === 'stone')
  expect(stairs.length).toBeGreaterThan(0)
  expect(Math.min(...stairs.map(([, [, y]]) => y))).toBe(0)
  stairs
    .filter(([, [, y]]) => y > 0)
    .forEach(([, [x, y, z], material]) => {
      expect(
        pieces.some(
          ([shape, p, m]) => shape === 'block' && p[0] === x && p[1] === y - 1 && p[2] === z && m === material
        )
      ).toBe(true)
    })
})

test('porch posts have a bottom course touching the path', () => {
  const { pieces } = recipe.assets.house_architecture
  for (const x of [-3, 3]) {
    expect(
      pieces.some(
        ([shape, p, material]) => shape === 'block' && p[0] === x && p[1] === 0 && p[2] === -5 && material === 'wood'
      )
    ).toBe(true)
    expect(
      pieces.some(
        ([shape, p, material]) => shape === 'block' && p[0] === x && p[1] === -1 && p[2] === -5 && material === 'stone'
      )
    ).toBe(true)
  }
})

test('plants root on terrain or an authored supporting block', () => {
  const asset = bake_workshop()
  const world = compile_runtime_world_recipe(asset.world)
  const supports = new Set(
    asset.world.fixed_structures.flatMap(({ source, origin }) =>
      source.blocks.map(([x, y, z]) => [x + origin[0], y + origin[1] + 1, z + origin[2]].join(','))
    )
  )
  for (const {
    center: [x, y, z],
  } of asset.world.scenery.plants)
    expect(
      y === sample_world_column(world, x, z).surface_y || supports.has([Math.floor(x), y, Math.floor(z)].join(','))
    ).toBe(true)
})

test('the kit keeps only assets reachable from its published previews', () => {
  const used = new Set()
  const visit = (name) => {
    if (used.has(name)) return
    used.add(name)
    recipe.assets[name].parts?.forEach(({ asset }) => visit(asset))
  }
  recipe.workshop.assets.forEach(visit)
  expect([...used].sort()).toEqual(Object.keys(recipe.assets).sort())
})

test('campfire flames are emitters, not solid architectural geometry', () => {
  const fire = bake_schematic(recipe.assets, 'campfire')
  expect(fire.fires).toHaveLength(1)
  expect(recipe.assets.campfire.details.some((row) => row.at(-1) === 'flame')).toBe(false)
})

test('one deterministic workshop contains every asset on a separate grass-grid cell', () => {
  const scene = bake_workshop()
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(digest(scene)).toBe(digest(bake_workshop()))
  expect(validate_world_recipe(scene.world)).toEqual({ ok: true, errors: [] })
  expect(scene.labels.map(({ id }) => id)).toEqual(recipe.workshop.assets)
  expect(new Set(scene.labels.map(({ position }) => position.join(','))).size).toBe(scene.labels.length)
  expect(new Set(scene.world.details.map(({ origin }) => origin.join(','))).size).toBe(scene.world.details.length)
  expect(gzipSync(JSON.stringify(scene)).length).toBeLessThan(1_048_576)
  const triangles = scene.world.details.reduce(
    (sum, cell) => sum + decode_detail_vertices(cell.vertices).length / 27,
    0
  )
  expect(triangles).toBeLessThan(100_000)
}, 20_000)

test('the complete kit compiles independently with the same geometry budget', () => {
  for (const id of recipe.workshop.assets) {
    const asset = bake_schematic(recipe.assets, id, [16, 32, 16])
    const triangles = asset.details.reduce((sum, cell) => sum + decode_detail_vertices(cell.vertices).length / 27, 0)
    if (asset.blocks.length === 0) expect(triangles).toBeLessThanOrEqual(384)
    asset.details.forEach((cell) =>
      expect(decode_detail_vertices(cell.vertices).length / 27).toBeLessThanOrEqual(4_096)
    )
  }
})

test('the checked-in workshop is fresh', () => {
  expect(generate_asset_workshop(true).assets).toBe(recipe.workshop.assets.length)
})
