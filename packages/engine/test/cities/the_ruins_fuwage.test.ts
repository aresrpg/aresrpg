// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import worlds from '../../../../seed/content/worlds.json'
import { plan_the_ruins, terrain_the_ruins } from '../../src/cities/the_ruins/generate.ts'
import { compile_the_ruins } from '../../src/cities/the_ruins/runtime.ts'
import { ruins_surface_height } from '../../src/cities/the_ruins/terrain.ts'
import { plan_fuwage, terrain_fuwage } from '../../src/cities/fuwage/generate.ts'
import type { CityPlacementDraft, CompiledCity } from '../../src/cities/types.ts'
import { compile_world_recipe, parse_world_recipe, type CompiledWorld } from '../../src/world_recipe.ts'

const city_world = (
  id: 'the_ruins' | 'fuwage',
  area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number; anchor_x: number; anchor_z: number }>
): Readonly<{ world: CompiledWorld; city: CompiledCity }> => {
  const nauvis = worlds.find(({ world }) => world === 'nauvis')
  if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
  const terrain = {
    ...structuredClone(nauvis.terrain),
    structure_areas: [{ id, ...area, structure_packs: [] }],
  }
  const world = compile_world_recipe(parse_world_recipe(terrain), { city_terrain: false })
  const [city] = world.structures.cities
  if (!city) throw new Error(`${id} did not compile`)
  return Object.freeze({ world, city })
}

const the_ruins_world = () =>
  city_world('the_ruins', {
    min_x: -14_672,
    max_x: -13_137,
    min_z: -1_872,
    max_z: -337,
    anchor_x: -13_936,
    anchor_z: -1_328,
  })

const fuwage_world = () =>
  city_world('fuwage', {
    min_x: -36_688,
    max_x: -35_153,
    min_z: -27_984,
    max_z: -26_449,
    anchor_x: -35_760,
    anchor_z: -27_312,
  })

const operation_voxels = (drafts: readonly CityPlacementDraft[], material_id: number): ReadonlySet<string> => {
  const voxels = new Set<string>()
  drafts.forEach((draft) => {
    const [anchor_x, anchor_y, anchor_z] = draft.type.anchor
    draft.type.packed_voxels.forEach((packed) => {
      if (packed >>> 24 !== material_id) return
      voxels.add(
        `${draft.x + (packed & 0xff) - anchor_x}:${draft.y! + ((packed >>> 16) & 0xff) - anchor_y}:${draft.z + ((packed >>> 8) & 0xff) - anchor_z}`
      )
    })
  })
  return voxels
}

const connected_voxels = (voxels: ReadonlySet<string>, start: string): ReadonlySet<string> => {
  const visited = new Set(voxels.has(start) ? [start] : [])
  const queue = [...visited]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y, z] = queue[cursor]!.split(':').map(Number) as [number, number, number]
    for (const [dx, dy, dz] of [
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ] as const) {
      const neighbour = `${x + dx}:${y + dy}:${z + dz}`
      if (voxels.has(neighbour) && !visited.has(neighbour)) {
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  return visited
}

describe('The Ruins city', () => {
  test('shapes ravines, sinkholes, and raised supernatural monuments around the dungeon anchor', () => {
    const { world, city } = the_ruins_world()
    const first = terrain_the_ruins(world, city)
    const second = terrain_the_ruins(world, city)
    const anchor_index =
      Math.floor((city.area.anchor_z - first.min_z) / first.cell_size) * first.width +
      Math.floor((city.area.anchor_x - first.min_x) / first.cell_size)

    expect(first).toEqual(second)
    expect(first.cell_size).toBe(8)
    expect(first.cut_cells.length).toBeGreaterThan(10_000)
    expect(first.target_heights.filter((height) => height >= 0).length).toBeGreaterThan(14_000)
    expect(
      Math.max(...first.target_heights) - Math.min(...first.target_heights.filter((height) => height >= 0))
    ).toBeGreaterThan(60)
    expect(first.target_heights[anchor_index]).toBeGreaterThan(world.recipe.sea_level)
  })

  test('builds one connected detailed mine beneath a dense ruined stronghold', () => {
    const { world, city } = the_ruins_world()
    const terrain = terrain_the_ruins(world, city)
    const floor_y =
      terrain.target_heights[
        Math.floor((city.area.anchor_z - terrain.min_z) / terrain.cell_size) * terrain.width +
          Math.floor((city.area.anchor_x - terrain.min_x) / terrain.cell_size)
      ]!
    const drafts = plan_the_ruins(world, city)
    const air = operation_voxels(drafts, 0)
    const connected = connected_voxels(air, `${city.area.anchor_x}:${floor_y}:${city.area.anchor_z + 20}`)

    expect(air.size).toBeGreaterThan(300_000)
    expect(connected.size).toBe(air.size)
    expect(drafts.filter(({ id }) => id.includes(':ruin:')).length).toBeGreaterThan(40)
    expect(drafts.filter(({ id }) => id.includes(':ancient-tower:'))).toHaveLength(11)
    expect(drafts.filter(({ id }) => id.includes(':fortress-'))).toHaveLength(9)
    expect(drafts.filter(({ id }) => id.includes(':broken-wall:'))).toHaveLength(8)
    expect(drafts.filter(({ id }) => id.includes(':ritual-fang:'))).toHaveLength(8)
    expect(drafts.filter(({ id }) => id.includes(':monumental-stair:'))).toHaveLength(3)
    expect(operation_voxels(drafts, world.materials.id_for('the_ruins_bone')).size).toBeGreaterThan(4_000)
    drafts.forEach(({ type }) => type.size.forEach((size) => expect(size).toBeLessThanOrEqual(256)))
  })

  test('routes cobwebs through the standard ground-scatter grammar', () => {
    const { city } = the_ruins_world()
    const ruins = compile_the_ruins(city.area)

    expect(ruins.nature_at('ravine').some(({ kind }) => kind === 'cobweb')).toBeTrue()
    expect(ruins.nature_at('fortress').some(({ kind }) => kind === 'cobweb')).toBeTrue()
  })

  test('anchors surviving fortress walls instead of bridging terrain cuts', () => {
    const { world, city } = the_ruins_world()
    const terrain = terrain_the_ruins(world, city)
    const unsupported: string[] = []
    plan_the_ruins(world, city)
      .filter(({ id }) => id.includes(':fortress-'))
      .forEach((placement) => {
        const bottoms = new Map<string, number>()
        placement.type.packed_voxels.forEach((packed) => {
          const x = placement.x + (packed & 0xff)
          const y = placement.y! + ((packed >>> 16) & 0xff)
          const z = placement.z + ((packed >>> 8) & 0xff)
          const key = `${x}:${z}`
          bottoms.set(key, Math.min(bottoms.get(key) ?? y, y))
        })
        bottoms.forEach((bottom, key) => {
          const [x, z] = key.split(':').map(Number) as [number, number]
          if (bottom > ruins_surface_height(world, terrain, x, z)) unsupported.push(`${placement.id}:${key}`)
        })
      })

    expect(unsupported.slice(0, 10)).toEqual([])
  })
})

describe('Fuwage city', () => {
  test('turns the natural summit into one level fortress plateau', () => {
    const { world, city } = fuwage_world()
    const terrain = terrain_fuwage(world, city)
    const heights = [-192, -96, 0, 96, 192].flatMap((z) =>
      [-192, -96, 0, 96, 192].map((x) => {
        const cell_x = Math.floor((city.area.anchor_x + x - terrain.min_x) / terrain.cell_size)
        const cell_z = Math.floor((city.area.anchor_z + z - terrain.min_z) / terrain.cell_size)
        return terrain.target_heights[cell_z * terrain.width + cell_x]
      })
    )

    expect(new Set(heights).size).toBe(1)
    expect(heights[0]).toBeGreaterThan(300)
  })

  test('builds a closed rampart with one causeway gate and bounded structure pieces', () => {
    const { world, city } = fuwage_world()
    const drafts = plan_fuwage(world, city)
    const walls = drafts.filter(({ id }) => id.includes(':wall:'))
    const causeways = drafts.filter(({ id }) => id.includes(':causeway:'))

    expect(walls).toHaveLength(8)
    expect(causeways.length).toBeGreaterThan(1)
    drafts.forEach(({ type }) => type.size.forEach((size) => expect(size).toBeLessThanOrEqual(256)))
  })
})
