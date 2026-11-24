// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  BIOME_SLOTS,
  compile_world_recipe,
  load_generated_city_artifacts,
  sample_world_column,
  world_terrain,
  type WorldRecipe,
} from '../src/data.ts'
import { missing_asset_error, terrain_failure } from '../src/asset_error.ts'
import { load_city_details } from '../src/cities/city_details.ts'
import { CITY_DEFINITIONS, read_city_artifact } from '../src/cities/registry.ts'
import { thebes_layout } from '../src/cities/thebes/plan.ts'
import { thebes_city_terrain } from '../src/cities/thebes/sky_map.ts'
import { build_thebes_sublevels, thebes_catacomb_layout } from '../src/cities/thebes/structures/sublevels.ts'
import { detail_builder } from '../src/detail_builder.ts'
import {
  decode_detail_cell,
  decode_detail_vertices,
  DETAIL_STRIDE,
  validate_detail_metadata,
  validate_details,
} from '../src/detail_artifact.ts'
import { validate_fixed_structures } from '../src/fixed_structures.ts'
import { portal_frame_source, portal_opening_columns, PORTAL_ARCH } from '../src/portal_shape.ts'
import { for_each_structure_voxel, structure_placements, structure_voxels } from '../src/structure_placement.ts'
import { read_worker_error, worker_error } from '../src/worker_reply.ts'

import { detail_triangle } from './fixtures/detail_triangle.ts'

const slots = (biome: string) =>
  Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, biome])) as WorldRecipe['biome_slots']
const RECIPE = {
  seed: 'structure-test',
  sea_level: 60,
  materials: {
    grass: { color: '#668047', preset: 'grass' },
    dirt: { color: '#654d36', preset: 'earth' },
    stone: { color: '#707777', preset: 'stone' },
  },
  biome_slots: slots('temperate'),
  biomes: [
    {
      name: 'temperate',
      structure_packs: ['temperate_ruins'],
      landscape: [
        { x: 0, y: 62, land: { surface: 'grass', subsurface: 'dirt', filler: 'stone' } },
        { x: 1, y: 62 },
      ],
    },
  ],
} as const satisfies WorldRecipe
const nauvis = () => compile_world_recipe(world_terrain('nauvis'))

describe('structures and cities', () => {
  test('the same area places the same non-overlapping structures, clear of the world-origin portal', () => {
    const world = compile_world_recipe(RECIPE)
    const area = { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 }
    const first = structure_placements(world, area)
    expect(first).toEqual(structure_placements(world, area))
    expect(first.length).toBeGreaterThan(2)
    const overlap = (a: (typeof first)[number]['bounds'], b: (typeof first)[number]['bounds']) =>
      !(a.max_x < b.min_x || a.min_x > b.max_x || a.max_z < b.min_z || a.min_z > b.max_z)
    first.forEach((placement, index) =>
      expect(first.slice(index + 1).some((other) => overlap(placement.bounds, other.bounds))).toBe(false)
    )
    const dense = {
      ...world,
      structures: {
        ...world.structures,
        packs: world.structures.packs.map((p) => ({ ...p, spacing: 8, density_bp: 10_000 })),
      },
    }
    const near = structure_placements(dense, { min_x: -32, max_x: 32, min_z: -32, max_z: 32 }).filter(
      ({ id }) => id !== 'world-portal-frame'
    )
    expect(near.length).toBeGreaterThan(0)
    expect(
      near.every(
        ({ bounds }) =>
          Math.hypot(
            Math.max(bounds.min_x, Math.min(0, bounds.max_x)),
            Math.max(bounds.min_z, Math.min(0, bounds.max_z))
          ) > 10
      )
    ).toBe(true)
    const source = portal_frame_source('stone')
    const [ax, ay, az] = source.anchor
    const frame = new Set(source.blocks.map(([x, y, z]) => `${x - ax},${y - ay},${z - az}`))
    for (const { x, height } of portal_opening_columns()) {
      for (let y = 0; y < height; y++) expect(frame.has(`${x},${y},0`)).toBe(false)
      expect(frame.has(`${x},${height},0`)).toBe(true)
    }
    expect(frame.has(`${PORTAL_ARCH.half_width},1,0`)).toBe(true)
    const portal_area = { min_x: -10, max_x: 10, min_z: -10, max_z: 10 }
    expect(structure_placements(world, portal_area).some(({ id }) => id === 'world-portal-frame')).toBe(true)
    const no_portal = compile_world_recipe({ ...RECIPE, portal: false })
    expect(structure_placements(no_portal, portal_area).some(({ id }) => id === 'world-portal-frame')).toBe(false)
  })

  test('fixed structures accept only bounded integer scales and share rotated voxel bounds', () => {
    const materials = { stone: { color: '#607080', preset: 'stone' as const } }
    const source = {
      name: 'scaled_rock',
      size: [2, 1, 1],
      anchor: [1, 0, 0],
      blocks: [
        [0, 0, 0, 'stone'],
        [1, 0, 0, 'air'],
      ],
    } as const
    const placement = { source, origin: [128, 72, 128], rotation: 1, scale: 3 } as const
    for (const scale of [0, -1, 1.5, 6, '2', NaN])
      expect(validate_fixed_structures([{ ...placement, scale }], materials)).toContain(
        'fixed_structures[0].scale must be an integer in 1..5'
      )
    expect(validate_fixed_structures([placement], materials)).toEqual([])
    const recipe: WorldRecipe = {
      seed: 'fixed-scale',
      sea_level: 1,
      materials,
      biome_slots: slots('rock'),
      biomes: [
        {
          name: 'rock',
          landscape: [
            { x: 0, y: 20, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
            { x: 1, y: 20 },
          ],
        },
      ],
      fixed_structures: [placement],
    }
    const world = compile_world_recipe(structuredClone(recipe))
    const area = { min_x: 120, max_x: 140, min_z: 120, max_z: 140 }
    const [placed] = structure_placements(world, area)
    const placed_voxels = structure_voxels(world, area)
    expect(placed!.scale).toBe(3)
    expect([placed_voxels.filter(({ material_id }) => material_id > 0).length, placed_voxels.length]).toEqual([27, 54])
    const { min_x, max_x, min_y, max_y, min_z, max_z } = placed!.bounds
    expect(
      placed_voxels.every(
        ({ x, y, z }) => x >= min_x && x <= max_x && y >= min_y && y <= max_y && z >= min_z && z <= max_z
      )
    ).toBe(true)
    expect(structure_voxels(world, { min_x: 100, max_x: 101, min_z: 100, max_z: 101 })).toEqual([])
  })

  test('generated cities keep their voxels clear of the portal and stay deterministic at their anchor', async () => {
    await load_generated_city_artifacts()
    const world = nauvis()
    const thebes = world.structures.cities.find(({ id }) => id === 'thebes')!
    const area = { min_x: 360, max_x: 640, min_z: -120, max_z: 120 }
    const city = structure_placements(world, area).filter(({ pack }) => pack === 'city:thebes')
    expect(city).toEqual(structure_placements(world, area).filter(({ pack }) => pack === 'city:thebes'))
    expect(city.length).toBeGreaterThan(10)
    const moved = { ...city[0]!, origin: [-16, city[0]!.origin[1], -16] as const, portal_clearance: true }
    const emitted: [number, number][] = []
    for_each_structure_voxel(
      { ...moved, bounds: { ...moved.bounds, min_x: -16, max_x: 15, min_z: -16, max_z: 15 } },
      (x, _y, z) => emitted.push([x, z])
    )
    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted.every(([x, z]) => x * x + z * z > 100)).toBe(true)
    expect(thebes.area).toMatchObject({ min_x: -336, max_x: 1199, min_z: -848, max_z: 687 })
  }, 30_000)

  test('city artifacts reject a provenance mismatch and report 404 and 410 as typed missing assets', async () => {
    const definition = CITY_DEFINITIONS[0]!
    const original = Bun.file
    const respond = (body: unknown) => Object.assign(Object.create(null), body) as ReturnType<typeof Bun.file>
    try {
      for (const status of [404, 410, 500]) {
        Bun.file = (() => respond({ ok: false, status })) as typeof Bun.file
        const error = await read_city_artifact(definition, definition.artifact_url).catch((caught: unknown) => caught)
        expect(terrain_failure(error).code).toBe(status === 500 ? 'terrain_failed' : 'asset_missing')
      }
      Bun.file = (() => respond({ json: async () => ({ ...definition.map, source_hash: 'stale' }) })) as typeof Bun.file
      await expect(read_city_artifact(definition, definition.artifact_url)).rejects.toThrow('provenance')
      Bun.file = (() => respond({ json: async () => ({ ...definition.map, version: 0 }) })) as typeof Bun.file
      await expect(read_city_artifact(definition, definition.artifact_url)).rejects.toThrow('provenance')
      Bun.file = (() =>
        respond({ json: () => Promise.reject(new Error('interrupted detail read')) })) as typeof Bun.file
      const city = definition.compile(definition.map.area)
      await expect(load_city_details([city], city.area.min_x, city.area.min_z)).rejects.toThrow('interrupted')
    } finally {
      Bun.file = original
    }
    const reply = structuredClone(worker_error(missing_asset_error('Generated city artifact failed to load: 404')))
    expect(reply).toEqual({ error: 'Generated city artifact failed to load: 404', missing_asset: true })
    expect(terrain_failure(new Error('Terrain planning failed', { cause: read_worker_error(reply) })).code).toBe(
      'asset_missing'
    )
    expect(terrain_failure(read_worker_error(worker_error(new Error('failed to load: 404')))).code).toBe(
      'terrain_failed'
    )
    expect(terrain_failure(read_worker_error({ error: 'missing', missing_asset: 'true' } as never)).code).toBe(
      'terrain_failed'
    )
  })

  test('the Thebes catacombs and cemetery stair keep supported walkable clearance', () => {
    const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
    const city = base.structures.cities.find(({ id }) => id === 'thebes')!
    const world = compile_world_recipe(
      { ...base.recipe, height_grid: thebes_city_terrain(base, city) },
      { city_terrain: false }
    )
    const cells = new Map<string, number>()
    build_thebes_sublevels(world, city).forEach(({ x, y, z, type }) =>
      type.packed_voxels.forEach((packed) =>
        cells.set(`${x + (packed & 255)},${y + ((packed >>> 16) & 255)},${z + ((packed >>> 8) & 255)}`, packed >>> 24)
      )
    )
    const walkable = (x: number, floor: number, z: number) =>
      (cells.get(`${x},${floor},${z}`) ?? 0) > 0 &&
      cells.get(`${x},${floor + 1},${z}`) === 0 &&
      cells.get(`${x},${floor + 2},${z}`) === 0
    const layout = thebes_catacomb_layout(world, city)
    const halls: boolean[] = []
    for (const dx of [-48, 0, 48])
      for (let dz = -48; dz <= 64; dz++) halls.push(walkable(layout.x + dx, layout.y, layout.z + dz))
    for (let dx = -64; dx <= 64; dx++) halls.push(walkable(layout.x + dx, layout.y, layout.z + 64))
    const [x, z] = thebes_layout(city).cemetery_entry
    const surface = sample_world_column(world, x, z).surface_y - 1
    const length = Math.max(64, surface - layout.y + 4)
    for (let step = 0; step <= length; step++) halls.push(walkable(x, Math.max(layout.y, surface - step), z + step))
    for (let along = z + length; along < city.area.anchor_z; along++) halls.push(walkable(x, layout.y, along))
    expect(halls.length).toBeGreaterThan(500)
    expect(halls.every(Boolean)).toBe(true)
  }, 30_000)
})

describe('baked detail bytes', () => {
  const palette = { wood: { color: '#785533', preset: 'wood' } } as const
  const encode = (values: Float32Array): string => Buffer.from(values.buffer).toString('base64')

  test('captured little-endian detail bytes decode positions, normals, UVs and material ids', () => {
    expect(decode_detail_cell(detail_triangle)).toEqual(
      new Float32Array([
        11.4, 26.51, 4.91, 0, -1, 0, 0, 0, 0, 14.6, 26.51, 4.91, 0, -1, 0, 0.8, 0, 0, 14.6, 26.51, 5.09, 0, -1, 0, 0.8,
        0.045, 0,
      ])
    )
    expect(() => decode_detail_vertices('AA==')).toThrow('whole triangles')
  })

  test('admission rejects invalid components at every vertex offset and enforces the archive budget first', () => {
    for (let offset = 0; offset < DETAIL_STRIDE * 3; offset++) {
      const values = decode_detail_cell(detail_triangle)
      values[offset] = NaN
      expect(() => decode_detail_cell({ ...detail_triangle, vertices: encode(values) })).toThrow('Invalid detail')
    }
    for (const [offset, value] of [
      [0, -1],
      [1, 33],
      [2, Infinity],
      [4, 0.5],
      [8, -1],
      [8, 0.5],
      [8, 9],
    ] as const) {
      const values = decode_detail_cell(detail_triangle)
      values[offset] = value
      expect(() => decode_detail_cell({ ...detail_triangle, vertices: encode(values) })).toThrow('Invalid detail')
    }
    const builder = detail_builder()
    builder.box([1, 1, 1], [2, 2, 2], 'wood')
    builder.box([33, 1, 1], [34, 2, 2], 'wood')
    const cells = builder.finish()
    expect(validate_detail_metadata(cells, palette, { cells: 2, triangles: 24 })).toEqual([])
    expect(validate_detail_metadata(cells, palette, { cells: 2, triangles: 23 })).toContain(
      'details: Detail data exceeds geometry budget'
    )
    expect(validate_detail_metadata(cells, palette, { cells: 1, triangles: 24 })).toContain(
      'details exceeds cell budget'
    )
    expect(validate_detail_metadata([{ ...cells[0]!, vertices: 'A' }], palette)).toContain(
      'details: Detail data must contain whole encoded triangles'
    )
    const [cell] = cells
    expect(validate_details([cell!], palette)).toEqual([])
    expect(validate_details([{ ...cell!, vertices: 'A'.repeat(144) }], palette)).toContain(
      'details: Invalid detail vertex or normal'
    )
    expect(validate_details([cell!, cell!], palette)).toContain('details contains duplicate cells')
    for (const broken of [{ vertices: '!' }, { palette: ['missing'] }, { origin: [1, 0, 0] }])
      expect(validate_details([{ ...cell!, ...broken }], palette).length).toBeGreaterThan(0)
  })
})
