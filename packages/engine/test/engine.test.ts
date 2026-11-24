// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { world_center } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

import worlds from '../../../seed/content/worlds.json'
import {
  BIOME_SLOTS,
  client_world_position,
  compile_runtime_world_recipe,
  compile_world_recipe,
  get_quality_profile,
  landscape_height,
  MAX_SURFACE_Y,
  parse_world_recipe,
  sample_biome_cell,
  sample_biome_grid,
  sample_world_column,
  validate_world_recipe,
  world_biome_at_zone,
  world_city_areas,
  world_terrain,
  WORLD_HEIGHT,
  type WorldRecipe,
} from '../src/data.ts'
import { compile_city_structure } from '../src/cities/city_structure.ts'
import { greedy_mesh } from '../src/greedy_mesher.ts'
import { validate_height_grid } from '../src/height_grid.ts'
import { chunk_origin, generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import type { ChunkRenderData } from '../src/types.ts'
import { CHUNK_EDGE, pack_voxel_occupancy, voxel_index } from '../src/voxel_data.ts'
import { RUNTIME_WORLD_COLUMN_CACHE_CAPACITY } from '../src/world_recipe.ts'

const slots = (biome: string) =>
  Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, biome])) as WorldRecipe['biome_slots']
const shore_land = { surface: 'shore', subsurface: 'shore', filler: 'rock' } as const
const meadow_land = { surface: 'meadow', subsurface: 'soil', filler: 'rock' } as const
const RECIPE = {
  seed: 'first-shore',
  sea_level: 8,
  materials: {
    rock: { color: '#787878', preset: 'stone' },
    soil: { color: '#6e4f38', preset: 'earth' },
    meadow: { color: '#5c8c3c', preset: 'grass' },
    shore: { color: '#d6c794', preset: 'sand' },
    water: { color: '#2e609e', preset: 'water' },
    stone: { color: '#707777', preset: 'stone' },
  },
  liquid: 'water',
  biome_slots: { ...slots('meadow'), low_low: 'shore' },
  biomes: [
    {
      name: 'shore',
      landscape: [
        { x: 0, y: 10, land: shore_land },
        { x: 0.5, y: 10 },
        { x: 1, y: 10 },
      ],
    },
    {
      name: 'meadow',
      structure_packs: ['temperate_ruins'],
      landscape: [
        { x: 0, y: 30, land: meadow_land },
        { x: 0.5, y: 30, land: { ...meadow_land, surface: 'shore' }, variance: 0.04 },
        { x: 1, y: 30 },
      ],
    },
  ],
} as const satisfies WorldRecipe
type Climate = ReturnType<ReturnType<typeof compile_world_recipe>['sample_climate']>
const climate = (overrides: Partial<Climate>): Climate => ({
  temperature: 0.5,
  humidity: 0.5,
  ground: 0.5,
  amplitude: 0.5,
  transition: 0.5,
  ...overrides,
})
const controlled = (recipe: WorldRecipe, overrides: Partial<Climate>, ridge = 0.5) => ({
  ...compile_world_recipe(recipe),
  sample_climate: () => climate(overrides),
  sample_ridges: () => ridge,
})
const flat = (recipe: WorldRecipe, y: number, extra: Partial<WorldRecipe['biomes'][number]> = {}): WorldRecipe => ({
  ...recipe,
  biomes: recipe.biomes.map((biome) => ({
    ...biome,
    ...extra,
    landscape: biome.landscape.map((knot) => ({ ...knot, y })),
  })),
})
const nauvis = () => compile_world_recipe(world_terrain('nauvis'))

const FACE_DIRECTIONS = [
  [-1, 0, 0, 1],
  [1, 0, 0, 0],
  [0, -1, 0, 3],
  [0, 1, 0, 2],
  [0, 0, -1, 5],
  [0, 0, 1, 4],
] as const
const visible_faces = (solid: (x: number, y: number, z: number) => boolean): Set<string> =>
  new Set(
    Array.from({ length: CHUNK_EDGE ** 3 }, (_, cell) => [
      cell % CHUNK_EDGE,
      Math.floor(cell / CHUNK_EDGE ** 2),
      Math.floor(cell / CHUNK_EDGE) % CHUNK_EDGE,
    ])
      .filter(([x, y, z]) => solid(x!, y!, z!))
      .flatMap(([x, y, z]) =>
        FACE_DIRECTIONS.filter(([dx, dy, dz]) => !solid(x! + dx, y! + dy, z! + dz)).map(([, , , face]) =>
          [x, y, z, face].join(':')
        )
      )
  )
// Expands each packed quad into the unit faces it covers, counting repeats.
const meshed_faces = (mesh: ReturnType<typeof greedy_mesh>): Map<string, number> => {
  const covered = new Map<string, number>()
  for (let index = 0; index < mesh.quad_count; index += 1) {
    const word = mesh.quads[index * 2]!
    const face = (word >>> 28) & 0x7
    const [u_axis, v_axis] = (
      [
        [1, 2],
        [0, 2],
        [0, 1],
      ] as const
    )[face >>> 1]!
    const cells = (((word >>> 23) & 0x1f) + 1) * (((word >>> 18) & 0x1f) + 1)
    for (let cell = 0; cell < cells; cell += 1) {
      const position = [word & 0x3f, (word >>> 6) & 0x3f, (word >>> 12) & 0x3f]
      position[u_axis]! += cell % (((word >>> 18) & 0x1f) + 1)
      position[v_axis]! += Math.floor(cell / (((word >>> 18) & 0x1f) + 1))
      const key = [...position, face].join(':')
      covered.set(key, (covered.get(key) ?? 0) + 1)
    }
  }
  return covered
}

describe('world', () => {
  test('a recipe compiles once, samples deterministically and validates every authored rule', () => {
    const world = compile_world_recipe(RECIPE)
    const first = sample_world_column(world, 137, -91)
    expect(first).toEqual(sample_world_column(world, 137, -91))
    expect(first.surface_y).toBeInteger()
    expect(first.surface_id).toBe(world.materials.id_for(first.land.surface, 'surface', first.land.subsurface))
    expect(structuredClone(RECIPE)).toEqual(RECIPE)
    expect(parse_world_recipe(structuredClone(RECIPE))).toEqual(RECIPE)
    expect(validate_world_recipe(RECIPE)).toEqual({ ok: true, errors: [] })
    const invalid = validate_world_recipe({
      ...RECIPE,
      noise: {},
      vertical_chunks: [0],
      biome_slots: { ...RECIPE.biome_slots, high_high: 'missing' },
      biomes: [
        {
          ...RECIPE.biomes[0],
          mountain_passes: 'yes',
          ravines: 'yes',
          structure_packs: ['missing_pack'],
          landscape: [
            { x: 0.5, y: 1, land: { ...shore_land, surface: 'missing' } },
            { x: 0.5, y: 2 },
          ],
        },
      ],
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        'noise is engine-owned and must not be authored',
        'vertical_chunks is engine-owned and must not be authored',
        'biomes[0].mountain_passes must be a boolean',
        'biomes[0].ravines must be a boolean',
        'biomes[0].structure_packs[0] references unknown pack "missing_pack"',
        'biomes[0].landscape[0].land.surface references unknown material "missing"',
        'biomes[0].landscape[1].x must be strictly greater than the previous x',
        'biome_slots.high_high must reference an authored biome',
      ])
    )
    expect(() => compile_runtime_world_recipe({ ...RECIPE, noise: {} })).toThrow()
    const points = [
      [0, 10],
      [0.25, 20],
      [0.75, 30],
      [1, 40],
    ] as const
    expect([-1, 0.25, 0.5, 1].map((x) => landscape_height(points, x))).toEqual([10, 20, 25, 40])
  })

  test('climate blends biomes, selects real oceans and keeps one clamped 384-block height domain', () => {
    expect(sample_world_column(controlled(RECIPE, { temperature: 0.35, humidity: 0.35 }), 0, 0).surface_y).toBe(25)
    const ocean_recipe = {
      ...RECIPE,
      ocean: { biome: 'ocean', ground_max: 0.25 },
      biomes: [
        ...RECIPE.biomes,
        {
          name: 'ocean',
          landscape: [
            { x: 0, y: 2, land: shore_land },
            { x: 1, y: 7 },
          ],
        },
      ],
    } satisfies WorldRecipe
    const ocean = sample_world_column(controlled(ocean_recipe, { ground: 0.2 }), 0, 0)
    expect(ocean.biome.name).toBe('ocean')
    expect(ocean.surface_y).toBeLessThan(RECIPE.sea_level)
    expect(sample_world_column(controlled(ocean_recipe, { ground: 0.4 }), 0, 0).biome.name).toBe('meadow')
    expect(sample_world_column(controlled(RECIPE, { ground: 0.49, transition: 1 }), 0, 0).land.surface).toBe('meadow')
    expect(sample_world_column(controlled(RECIPE, { ground: 0.53, transition: 1 }), 0, 0).land.surface).toBe('shore')
    expect([WORLD_HEIGHT, MAX_SURFACE_Y]).toEqual([384, 383])
    const floor = controlled(RECIPE, { ground: 0, amplitude: 0 })
    expect(sample_world_column(floor, 0, 0).surface_y).toBeGreaterThanOrEqual(1)
    const ceiling = controlled(flat(RECIPE, MAX_SURFACE_Y), { ground: 1, amplitude: 1 })
    expect(sample_world_column(ceiling, 0, 0).surface_y).toBe(MAX_SURFACE_Y)
    const ridge_range = (height: number) => {
      const recipe = { ...flat(RECIPE, height), sea_level: 60 }
      const valley = sample_world_column(controlled(recipe, { ground: 1 }, 0), 0, 0).surface_y
      return sample_world_column(controlled(recipe, { ground: 1 }, 1), 0, 0).surface_y - valley
    }
    expect(ridge_range(90)).toBeLessThanOrEqual(12)
    expect(ridge_range(260)).toBeGreaterThanOrEqual(120)
    for (const [feature, height, x, z, below] of [
      ['mountain_passes', 260, 984, 398, 220],
      ['ravines', 180, 760, 480, 120],
    ] as const) {
      const recipe = { ...flat(RECIPE, height), seed: feature === 'ravines' ? 'ravine-0' : 'pass-0', sea_level: 60 }
      const carved = { ...recipe, biomes: recipe.biomes.map((b) => ({ ...b, [feature]: b.name === 'meadow' })) }
      expect(sample_world_column(controlled(recipe, { ground: 1 }, 0.44), x, z).surface_y).toBe(height)
      expect(sample_world_column(controlled(carved, { ground: 1 }, 0.44), x, z).surface_y).toBeLessThan(below)
      expect(sample_world_column(controlled(carved, { ground: 1 }, 0.44), 0, 0).surface_y).toBe(height)
    }
  })

  test('the published chain biome grid and city areas come from the same compiled sampler', () => {
    const grid = sample_biome_grid(RECIPE, { world_size: 1024, world_center: 512, cell_size: 512 })
    expect([grid.side, grid.cells.length]).toEqual([2, 4])
    const surface_only = compile_world_recipe(RECIPE, { structures: false })
    expect(sample_biome_cell(surface_only, 1, 0, { world_center: 512, cell_size: 512 })).toBe(grid.cells[1])
    expect(surface_only.sample_climate(123, -456)).toEqual(compile_world_recipe(RECIPE).sample_climate(123, -456))
    const published = compile_runtime_world_recipe(worlds.find(({ world }) => world === 'nauvis')!.terrain, {
      structures: false,
    })
    for (const [zone_x, zone_z] of [
      [97, 97],
      [98, 97],
      [70, 40],
    ] as const) {
      const cell = sample_biome_cell(published, zone_x, zone_z, { world_center, cell_size: ZONE_SIZE })
      expect(world_biome_at_zone('nauvis', zone_x, zone_z)).toBe(published.biomes[cell]!.name)
    }
    expect(world_biome_at_zone('missing', 0, 0)).toBeNull()
    expect(client_world_position(50_512, 50_000)).toEqual([512, 0])
    expect(world_city_areas('nauvis').find(({ id }) => id === 'thebes')).toMatchObject({
      min_x: -336,
      max_x: 1199,
      min_z: -848,
      max_z: 687,
      anchor_x: 512,
      anchor_z: 0,
    })
    expect(world_city_areas(null)).toEqual([])
  })

  test('malformed height grids fail at the boundary and retained columns stay bounded', () => {
    const grid = {
      min_x: 0,
      min_z: 0,
      cell_size: 8,
      width: 2,
      depth: 2,
      target_heights: [64, 64, 64, 64],
      cut_cells: [],
    }
    const recipe = parse_world_recipe(world_terrain('nauvis'))
    for (const change of [
      { target_heights: [64] },
      { target_heights: Array(4) },
      { target_heights: [64, NaN, 64, 64] },
      { target_heights: [64, 384, 64, 64] },
      { cell_size: 0 },
      { width: 1.5 },
      { min_x: Infinity },
      { cut_cells: [4] },
      { width: 100_000, depth: 100_000 },
    ]) {
      expect(validate_height_grid({ ...grid, ...change }).length).toBeGreaterThan(0)
      expect(() => compile_runtime_world_recipe({ ...recipe, height_grid: { ...grid, ...change } })).toThrow()
    }
    expect(validate_height_grid({ ...grid, target_heights: [-1, 64, 64, 64], cut_cells: [0] })).toEqual([])
    const shaped = compile_runtime_world_recipe({ ...recipe, height_grid: grid })
    expect(sample_world_column(shaped, 8, 8).surface_y).toBe(64)
    const source = compile_runtime_world_recipe(RECIPE, { structures: false })
    let sampled = 0
    const counted = { ...source, sample_climate: (x: number, z: number) => (sampled++, source.sample_climate(x, z)) }
    const first = sample_world_column(counted, 0, 0)
    for (let x = 1; x <= RUNTIME_WORLD_COLUMN_CACHE_CAPACITY; x += 1) sample_world_column(counted, x, 0)
    expect(sample_world_column(counted, 0, 0)).toEqual(first)
    expect(sampled).toBe(RUNTIME_WORLD_COLUMN_CACHE_CAPACITY + 2)
  })
})

describe('chunks and meshing', () => {
  const STEP = {
    seed: 'terrain-test',
    sea_level: 8,
    materials: { ...RECIPE.materials },
    biome_slots: slots('test'),
    biomes: [
      {
        name: 'test',
        landscape: [
          { x: 0, y: 0, land: meadow_land },
          { x: 1, y: 20 },
        ],
      },
    ],
  } satisfies WorldRecipe
  const world = compile_world_recipe(STEP)

  test('chunk planning covers every crossed layer inside the world and generation is deterministic', () => {
    expect(chunk_origin({ x: 2, y: 11, z: -3 })).toEqual([64, 352, -96])
    expect(surface_chunk_layers(world, 0, 0)).toEqual([0])
    const cliff = {
      ...world,
      biomes: world.biomes.map((biome) => ({
        ...biome,
        height_points: [
          [0, 1],
          [1, 100],
        ] as const,
      })),
      sample_climate: (x: number) => climate({ ground: x < 16 ? 0 : 1 }),
      sample_ridges: () => 0.5,
    }
    expect(surface_chunk_layers(cliff, 0, 0)).toEqual([0, 1, 2, 3])
    const top = generate_chunk(cliff, { key: '0:3:0', coordinate: { x: 0, y: 3, z: 0 }, lod: 'near' })
    expect(top.material_ids[voxel_index(16, 3, 0)]).toBe(cliff.materials.id_for('rock', 'filler'))
    expect(top.material_ids[voxel_index(17, 3, 0)]).toBe(cliff.materials.id_for('meadow', 'surface', 'soil'))
    expect(surface_chunk_layers(compile_world_recipe(flat(STEP, 0)), 0, 0)).toEqual([0])
    expect(surface_chunk_layers(compile_world_recipe({ ...flat(STEP, CHUNK_EDGE), portal: false }), 0, 0)).toEqual([0])
    const request = { key: '-2:0:5', coordinate: { x: -2, y: 0, z: 5 }, lod: 'mid' as const }
    const first = generate_chunk(world, request)
    expect(first).toEqual(generate_chunk(world, request))
    expect([first.occupancy[0].length, first.material_ids.length, first.halo_occupancy.length]).toEqual([
      1024,
      32 ** 3,
      Math.ceil(34 ** 3 / 32),
    ])
    expect(new Set(first.material_ids).size).toBeGreaterThan(2)
    const lods = (['near', 'mid', 'far'] as const).map((lod) =>
      generate_chunk(world, { key: lod, coordinate: { x: 0, y: 0, z: 0 }, lod })
    )
    expect(new Set(lods.flatMap(({ resolution, cell_size }) => [resolution, cell_size]))).toEqual(new Set([32, 1]))
    const type = compile_city_structure(
      { name: 'air', size: [1, 1, 1], anchor: [0, 0, 0], blocks: [[0, 0, 0, 'air']] },
      world.materials
    )
    const bounds = { min_x: 16, max_x: 16, min_y: 5, max_y: 5, min_z: 16, max_z: 16 }
    const air = {
      id: 'air',
      pack: 'city:test',
      type,
      origin: [16, 5, 16] as const,
      rotation: 0 as const,
      scale: 1,
      bounds,
    }
    const solid = generate_chunk(world, { key: 'air', coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' })
    const carved = generate_chunk(world, { key: 'air', coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' }, [
      { ...air, overlap_bounds: bounds },
    ])
    expect(solid.material_ids[voxel_index(16, 5, 16)]).not.toBe(0)
    expect(carved.material_ids[voxel_index(16, 5, 16)]).toBe(0)
  })

  test('the far shell sits half a block below the exact voxel surface', async () => {
    const far = new Worker(new URL('../src/far_worker.ts', import.meta.url), { type: 'module' })
    try {
      const reply = new Promise<{ heights: Float32Array }>((resolve) =>
        far.addEventListener('message', ({ data }) => resolve(data), { once: true })
      )
      far.postMessage({ type: 'initialize', world: STEP })
      far.postMessage({ type: 'sample', id: 1, quality: 'low', center: [0, 0] })
      const { heights } = await reply
      const { horizon_radius, horizon_step } = get_quality_profile('low').chunks
      const side = (horizon_radius * 2) / horizon_step + 1
      const exact = compile_runtime_world_recipe(STEP, { structures: false })
      for (const index of [0, 77, Math.floor(heights.length / 2), heights.length - 1]) {
        const x = -horizon_radius + (index % side) * horizon_step
        const z = -horizon_radius + Math.floor(index / side) * horizon_step
        expect(heights[index]).toBe(sample_world_column(exact, x, z).surface_y - 0.5)
      }
    } finally {
      far.terminate()
    }
  })

  const voxels = (solid_at: (x: number, y: number, z: number) => boolean, material = 3): ChunkRenderData => {
    const material_ids = new Uint16Array(CHUNK_EDGE ** 3)
    for (let y = 0; y < CHUNK_EDGE; y += 1)
      for (let z = 0; z < CHUNK_EDGE; z += 1)
        for (let x = 0; x < CHUNK_EDGE; x += 1) if (solid_at(x, y, z)) material_ids[voxel_index(x, y, z)] = material
    return {
      key: '0:0:0',
      coordinate: { x: 0, y: 0, z: 0 },
      origin: [0, 0, 0],
      lod: 'near',
      resolution: CHUNK_EDGE,
      cell_size: 1,
      material_ids,
      ...pack_voxel_occupancy(solid_at),
    }
  }

  test('the greedy mesher covers every visible face once and never merges materials or occluding foliage', () => {
    const terrain = (x: number, y: number, z: number): boolean =>
      y >= 0 && y < 6 + Math.round(Math.sin(x * 0.4) * 2 + Math.cos(z * 0.3) * 2)
    const covered = meshed_faces(greedy_mesh(voxels(terrain)))
    expect(new Set(covered.keys())).toEqual(visible_faces(terrain))
    expect([...covered.values()].every((count) => count === 1)).toBe(true)
    expect(greedy_mesh(voxels(() => true)).quad_count).toBe(0)
    const single = greedy_mesh(voxels((x, y, z) => x === 2 && y === 3 && z === 4))
    expect(single.quads[0]).toBe((2 | (3 << 6) | (4 << 12) | (1 << 28)) >>> 0)
    const pair = voxels((x, y, z) => y === 0 && z === 0 && x >= 0 && x < 2)
    pair.material_ids[voxel_index(0, 0, 0)] = 2
    const pair_mesh = greedy_mesh(pair)
    const ids = Array.from({ length: pair_mesh.quad_count }, (_, index) => pair_mesh.quads[index * 2 + 1]! & 0xfff)
    expect([new Set(ids), pair_mesh.quad_count]).toEqual([new Set([2, 3]), 10])
    const leaf = (x: number, y: number, z: number) => x === 4 && z === 4 && y === 1
    const covered_soil = voxels((x, y, z) => x === 4 && z === 4 && y <= 1)
    covered_soil.material_ids[voxel_index(4, 1, 4)] = 2
    const tops = (data: ChunkRenderData) => {
      const result = greedy_mesh(data)
      return Array.from({ length: result.quad_count }, (_, i) => [
        result.quads[i * 2]!,
        result.quads[i * 2 + 1]!,
      ]).filter(([a, b]) => a! >>> 28 === 2 && (b! & 0xfff) === 3).length
    }
    expect(tops({ ...covered_soil, foliage: pack_voxel_occupancy(leaf) })).toBe(1)
    expect(tops(covered_soil)).toBe(0)
  })
})
