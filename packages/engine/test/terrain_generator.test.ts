// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import worlds from '../../../seed/content/worlds.json'
import { flat_burn_field } from '../src/flat_nodes.ts'
import { greedy_mesh } from '../src/greedy_mesher.ts'
import { get_quality_profile } from '../src/quality.ts'
import { structure_placements } from '../src/structure_placement.ts'
import { create_terrain_planner } from '../src/terrain_planner.ts'
import { chunk_origin, generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import { TERRAIN_POOL_LAYOUT } from '../src/terrain_pool.ts'
import {
  BIOME_SLOTS,
  compile_world_recipe,
  far_shell_y,
  parse_world_recipe,
  sample_world_column,
  type CompiledWorld,
  type WorldRecipe,
} from '../src/world_recipe.ts'
import { CHUNK_EDGE, voxel_index } from '../src/voxel_data.ts'

const WORLD = compile_world_recipe({
  seed: 'terrain-test',
  sea_level: 8,
  materials: {
    rock: { color: '#787878', preset: 'stone' },
    soil: { color: '#6e4f38', preset: 'earth' },
    meadow: { color: '#5c8c3c', preset: 'grass' },
    blades: { color: '#668844', preset: 'grass' },
  },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'test',
      landscape: [
        { x: 0, y: 0, land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' } },
        { x: 1, y: 20 },
      ],
    },
  ],
})

describe('terrain generation', () => {
  test('uses absolute 32-block chunk layers inside the 384-block world', () => {
    expect(chunk_origin({ x: 2, y: 11, z: -3 })).toEqual([64, 352, -96])
    expect(surface_chunk_layers(WORLD, 0, 0)).toEqual([0])
  })

  test('derives every vertical layer crossed by a tall surface cliff', () => {
    const cliff = {
      ...WORLD,
      biomes: WORLD.biomes.map((biome) => ({
        ...biome,
        height_points: [
          [0, 1],
          [1, 100],
        ] as const,
      })),
      sample_climate: (x: number) => ({
        temperature: 0.5,
        humidity: 0.5,
        ground: x < 16 ? 0 : 1,
        amplitude: 0.5,
        transition: 0.5,
      }),
      sample_ridges: () => 0.5,
    }

    expect(surface_chunk_layers(cliff, 0, 0)).toEqual([0, 1, 2, 3])
  })

  test('steep tops expose filler while level tops retain their authored cover', () => {
    const cliff: CompiledWorld = {
      ...WORLD,
      biomes: WORLD.biomes.map((biome) => ({
        ...biome,
        height_points: [
          [0, 1],
          [1, 100],
        ] as const,
      })),
      sample_climate: (x: number) => ({
        temperature: 0.5,
        humidity: 0.5,
        ground: x < 16 ? 0 : 1,
        amplitude: 0.5,
        transition: 0.5,
      }),
      sample_ridges: () => 0.5,
    }
    const chunk = generate_chunk(cliff, { key: '0:3:0', coordinate: { x: 0, y: 3, z: 0 }, lod: 'near' })

    expect(chunk.material_ids[voxel_index(16, 3, 0)]).toBe(cliff.materials.id_for('rock', 'filler'))
    expect(chunk.material_ids[voxel_index(17, 3, 0)]).toBe(cliff.materials.id_for('meadow', 'surface', 'soil'))
  })

  test('never plans chunks outside the authored world-height domain', () => {
    const floor = compile_world_recipe({
      ...WORLD.recipe,
      biomes: WORLD.recipe.biomes.map((biome) => ({
        ...biome,
        landscape: biome.landscape.map((knot) => ({ ...knot, y: 0 })),
      })),
    })

    expect(surface_chunk_layers(floor, 0, 0)).toEqual([0])
  })

  test('plans the voxel below a surface on an exact chunk boundary', () => {
    const boundary = compile_world_recipe({
      ...WORLD.recipe,
      biomes: WORLD.recipe.biomes.map((biome) => ({
        ...biome,
        landscape: biome.landscape.map((knot) => ({ ...knot, y: CHUNK_EDGE })),
      })),
    })

    expect(surface_chunk_layers(boundary, 0, 0)).toEqual([0])
  })

  test('terrain and its neighbour halo are deterministic', () => {
    const request = { key: '-2:0:5', coordinate: { x: -2, y: 0, z: 5 }, lod: 'mid' as const }
    const first = generate_chunk(WORLD, request)

    expect(first).toEqual(generate_chunk(WORLD, request))
    expect(first.occupancy[0]).toHaveLength(1024)
    expect(first.material_ids).toHaveLength(32 ** 3)
    expect(new Set(first.material_ids).size).toBeGreaterThan(2)
    expect(first.halo_occupancy).toHaveLength(Math.ceil(34 ** 3 / 32))
  })

  test('direct terrain labels keep one crack-free voxel resolution', () => {
    const coordinate = { x: 0, y: 0, z: 0 }
    const chunks = (['near', 'mid', 'far'] as const).map((lod) =>
      generate_chunk(WORLD, { key: `0:0:0:${lod}`, coordinate, lod })
    )

    expect(new Set(chunks.map(({ resolution }) => resolution))).toEqual(new Set([32]))
    expect(new Set(chunks.map(({ cell_size }) => cell_size))).toEqual(new Set([1]))
  })

  test('the flat transition field is continuous in world space', () => {
    const sample = flat_burn_field(73.25, -41.5)
    const adjacent = flat_burn_field(73.26, -41.5)

    expect(Math.abs(adjacent - sample)).toBeLessThan(0.01)
    expect(flat_burn_field(180, 90)).not.toBeCloseTo(sample, 3)
  })
})

describe('far terrain parity', () => {
  const FAR_WORLD = compile_world_recipe({
    seed: 'far-parity',
    sea_level: 10,
    materials: {
      rock: { color: '#787878', preset: 'stone' },
      soil: { color: '#6e4f38', preset: 'earth' },
      meadow: { color: '#5c8c3c', preset: 'grass' },
    },
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'ground'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'ground',
        landscape: [
          { x: 0, y: 0, land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' } },
          { x: 0.5, y: 12 },
          { x: 1, y: 24 },
        ],
      },
    ],
  })

  test('the overlapping shell stays half a block below the exact voxel surface', () => {
    for (let z = -256; z <= 256; z += 8) {
      for (let x = -256; x <= 256; x += 8) {
        const surface = sample_world_column(FAR_WORLD, x, z).surface_y
        expect(far_shell_y(FAR_WORLD, x, z)).toBe(surface - 0.5)
      }
    }
  })
})

describe('terrain streaming', () => {
  const PLANNER_WORLD: WorldRecipe = {
    seed: 'planner-test',
    sea_level: 0,
    materials: { stone: { color: '#777777', preset: 'stone' } },
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'test',
        landscape: [
          { x: 0, y: 1, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
          { x: 1, y: 1 },
        ],
      },
    ],
  }

  test('terrain planning keeps only one active and the latest queued focus', async () => {
    const messages: unknown[] = []
    const listeners = new Map<string, (event: MessageEvent) => void>()
    const worker = {
      postMessage: (message: unknown) => messages.push(message),
      addEventListener: ((type: string, listener: (event: MessageEvent) => void) =>
        listeners.set(type, listener)) as Worker['addEventListener'],
      terminate: () => {},
    }
    const planner = create_terrain_planner(PLANNER_WORLD, () => worker)
    const first = planner.plan([{ x: 0, z: 0 }])
    const superseded = planner.plan([{ x: 1, z: 0 }]).catch((error: Error) => error.message)
    const latest = planner.plan([{ x: 2, z: 0 }])

    expect(messages).toEqual([
      { type: 'initialize', world: PLANNER_WORLD },
      { type: 'plan', id: 1, columns: [{ x: 0, z: 0 }] },
    ])
    expect(await superseded).toBe('terrain plan was superseded by a newer focus')

    listeners.get('message')?.(new MessageEvent('message', { data: { id: 1, plans: [] } }))
    await first
    expect(messages.at(-1)).toEqual({ type: 'plan', id: 3, columns: [{ x: 2, z: 0 }] })

    listeners.get('message')?.(new MessageEvent('message', { data: { id: 3, plans: [] } }))
    await latest
    planner.dispose()
  })

  test('the shared terrain pool fits Nauvis high-quality residency with movement headroom', () => {
    const first_world = worlds.find(({ world }) => world === 'nauvis')
    if (!first_world) throw new Error('Nauvis is missing')
    const compiled = compile_world_recipe(parse_world_recipe(first_world.terrain))
    const radius = get_quality_profile('high').chunks.far_radius
    let required_slots = 0

    for (let z = -radius; z <= radius; z += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const structures = structure_placements(compiled, {
          min_x: x * CHUNK_EDGE - 1,
          max_x: (x + 1) * CHUNK_EDGE,
          min_z: z * CHUNK_EDGE - 1,
          max_z: (z + 1) * CHUNK_EDGE,
        })
        surface_chunk_layers(compiled, x, z, structures).forEach((y) => {
          const request = { key: `${x}:${y}:${z}`, coordinate: { x, y, z }, lod: 'near' as const }
          const { quad_count } = greedy_mesh(generate_chunk(compiled, request, structures))
          required_slots += Math.ceil(quad_count / TERRAIN_POOL_LAYOUT.slot_quads)
        })
      }
    }

    expect(required_slots).toBeLessThanOrEqual(TERRAIN_POOL_LAYOUT.max_slots)
    expect(required_slots / TERRAIN_POOL_LAYOUT.max_slots).toBeLessThanOrEqual(0.75)
    // 60s runway: the workload includes the 2026-08-19 ridged-noise + scatter cost; the seal
    // is the SLOT ARITHMETIC, not generation speed (the runtime's budget lives in the engine).
  }, 60_000)
})
