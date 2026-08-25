// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import {
  compile_world_recipe,
  MAX_SURFACE_Y,
  parse_world_recipe,
  sample_biome_grid,
  sample_world_column,
} from '@aresrpg/engine'
import { gatherable_of } from '@aresrpg/immutable'

import worlds from '../../../../seed/content/worlds.json'
import mobs from '../../../../seed/content/mobs.json'
import {
  biome_map_color,
  biome_preview,
  move_spline_knot,
  terrain_patch,
  world_height_domain,
  world_height_graph_domain,
} from '../../src/editor/biome_editor.ts'

test('the biome preview is the engine biome grid with derived coverage', () => {
  const world = worlds.find(({ world }) => world === 'nauvis')
  if (!world?.terrain) throw new Error('Nauvis terrain missing')
  const exact = sample_biome_grid(parse_world_recipe(world.terrain), {
    world_size: 100_000,
    world_center: 50_000,
    cell_size: 512,
  })
  const preview = biome_preview(world.terrain)
  expect(preview.side).toBe(exact.side)
  expect(preview.cells).toEqual(exact.cells)
  expect(preview.coverage.reduce((sum, count) => sum + count, 0)).toBe(exact.cells.length)
})

test('spline knot movement preserves strict x ordering', () => {
  const knots = [
    [0, 1],
    [0.5, 2],
    [1, 3],
  ] as const
  expect(move_spline_knot(knots, 1, [2, 4])).toEqual([
    [0, 1],
    [0.9999, 4],
    [1, 3],
  ])
})

test('the spline graph keeps one world-wide elevation domain', () => {
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')

  expect(world_height_domain()).toEqual([0, 383])
  expect(world_height_graph_domain()).toEqual([0, 384])
})

test('Nauvis is the approved temperate land matrix with an elevation-selected ocean', () => {
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')

  expect(terrain.seed).toBe('ares-nauvis-europe')
  expect(terrain.biomes.map(({ name }) => name)).toEqual([
    'plains',
    'forest',
    'rainforest',
    'highlands',
    'desert',
    'ocean',
  ])
  expect(terrain.ocean).toEqual({ biome: 'ocean', ground_max: 0.27 })
  const colors = terrain.biomes.map((biome) => biome_map_color(parse_world_recipe(terrain), biome))
  expect(new Set(colors).size).toBeGreaterThanOrEqual(5)
  expect(colors.at(-1)).toBe(terrain.materials.water.color)
  expect(terrain.biome_slots).toEqual({
    low_low: 'highlands',
    low_mid: 'highlands',
    low_high: 'rainforest',
    mid_low: 'plains',
    mid_mid: 'plains',
    mid_high: 'forest',
    high_low: 'desert',
    high_mid: 'forest',
    high_high: 'rainforest',
  })
})

test('Nauvis places gathering tiers 1–3 while Yakutia keeps the remaining backup rows', () => {
  const nauvis = worlds.find(({ world }) => world === 'nauvis')!
  const yakutia = worlds.find(({ world }) => world === 'yakutia')!
  const tiers = (resources: typeof nauvis.resources, job: string) =>
    resources.flatMap(({ item_type }) => {
      const gatherable = gatherable_of(item_type)
      return gatherable?.job === job ? [gatherable.tier] : []
    })

  for (const job of ['FARMER', 'HERBALIST', 'MINER']) {
    expect(tiers(nauvis.resources, job)).toEqual([1, 2, 3])
    expect(tiers(yakutia.resources, job)).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
  }
  expect(yakutia.resources.every(({ biomes }) => biomes.length === 0)).toBeTrue()
  expect(
    [...nauvis.resources, ...yakutia.resources].every(
      (row) => Object.keys(row).toSorted().join() === 'biomes,item_type'
    )
  ).toBeTrue()
  expect(Object.fromEntries(nauvis.resources.map(({ item_type, biomes }) => [item_type, biomes]))).toEqual({
    wheat: ['plains'],
    green_mushroom: ['forest', 'rainforest'],
    quartz: ['highlands'],
    wheat_barley: ['plains'],
    red_orchid: ['rainforest'],
    amber: ['highlands'],
    wheat_malt: ['plains'],
    ivory_shrooms: ['forest', 'rainforest'],
    jade: ['desert'],
  })
})

test('Nauvis owns the exact curated roaming roster and keeps Araknomath as a boss', () => {
  const nauvis = worlds.find(({ world }) => world === 'nauvis')!
  const expected = {
    plains: ['aragne__earth', 'fuwa__white', 'misui__earth', 'moka', 'aragne__air', 'misui__wind'],
    forest: ['aragne__earth', 'misui__vitality', 'misui__earth', 'moka', 'fuwa__black', 'ant_red', 'misui__wind'],
    rainforest: ['aragne__water', 'cro_wani__green', 'misui__water', 'moka', 'fuwa__black', 'ant_red'],
    highlands: ['fuwa__white', 'cro_wani__white', 'moka', 'moyumi', 'ant_white', 'aragne__air', 'misui__wind'],
    desert: ['crab', 'cro_wani__green', 'aragne__fire', 'misui__fire', 'moka', 'moyumi'],
  } as const

  for (const [biome, mob_types] of Object.entries(expected))
    expect(
      nauvis.mobs
        .filter(({ biomes }) => biomes.includes(biome))
        .map(({ mob_type }) => mob_type)
        .toSorted()
    ).toEqual(mob_types.toSorted())
  expect(nauvis.mobs.some(({ mob_type }) => mob_type === 'araknomath')).toBeFalse()
  expect(mobs.find(({ mob_type }) => mob_type === 'araknomath')?.role).toBe('boss')
  expect(mobs.filter(({ role }) => role === 'archi').map(({ mob_type, name }) => ({ mob_type, name }))).toEqual([
    { mob_type: 'aragne__arakiri', name: 'Arakiri the Silkblade' },
    { mob_type: 'fuwa__fukuo', name: 'Fukuo the Ka' },
    { mob_type: 'misui__misunami', name: 'Misunami the Abyssal' },
  ])
})

test('the terrain patch uses exact engine columns for its live voxel preview', () => {
  const terrain = worlds[0]?.terrain
  if (!terrain) throw new Error('first terrain missing')
  const patch = terrain_patch(terrain, { center_x: 128, center_z: -64, side: 3, spacing: 32 })
  const [, , , , middle] = patch.columns
  const exact = sample_world_column(compile_world_recipe(parse_world_recipe(terrain)), 128, -64)
  expect(middle).toMatchObject({ x: 128, z: -64, surface_y: exact.surface_y, biome: exact.biome.name })
  expect(middle.color).toBe(parse_world_recipe(terrain).materials[exact.land.surface]?.color)
})

test('Nauvis reads as varied coherent geography at world scale', () => {
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')
  const world = compile_world_recipe(parse_world_recipe(terrain))
  const side = 196
  const spacing = 512
  const columns = Array.from({ length: side * side }, (_, index) => {
    const x = (index % side) * spacing - 50_000
    const z = Math.floor(index / side) * spacing - 50_000
    return sample_world_column(world, x, z)
  })
  const heights = columns.map(({ surface_y }) => surface_y).sort((left, right) => left - right)
  const count_by = (key: (column: (typeof columns)[number]) => string) =>
    columns.reduce<Record<string, number>>((counts, column) => {
      const value = key(column)
      return { ...counts, [value]: (counts[value] ?? 0) + 1 }
    }, {})
  const biome_counts_by_name = count_by(({ biome }) => biome.name)
  const biome_counts = Object.values(biome_counts_by_name)
  const surface_counts = Object.values(count_by(({ land }) => land.surface))
  const meaningful = (counts: readonly number[]) => counts.filter((count) => count / columns.length >= 0.01).length
  const matching_neighbors = columns.reduce(
    (matches, column, index) =>
      matches +
      (index % side > 0 && columns[index - 1]?.biome.name === column.biome.name ? 1 : 0) +
      (index >= side && columns[index - side]?.biome.name === column.biome.name ? 1 : 0),
    0
  )
  const neighbor_count = 2 * side * (side - 1)
  const land_share = columns.filter(({ surface_y }) => surface_y >= terrain.sea_level).length / columns.length
  const beach_share =
    columns.filter(
      ({ surface_y, land }) =>
        surface_y >= terrain.sea_level &&
        surface_y <= terrain.sea_level + 8 &&
        ['sand', 'wet_sand'].includes(land.surface)
    ).length / columns.length
  const snow_share = columns.filter(({ land }) => land.surface === 'snow').length / columns.length

  expect(Object.keys(biome_counts_by_name).toSorted()).toEqual([
    'desert',
    'forest',
    'highlands',
    'ocean',
    'plains',
    'rainforest',
  ])
  expect(meaningful(biome_counts)).toBe(6)
  expect((biome_counts_by_name.ocean ?? 0) / columns.length).toBeGreaterThanOrEqual(0.04)
  expect((biome_counts_by_name.ocean ?? 0) / columns.length).toBeLessThanOrEqual(0.1)
  expect(Math.max(...biome_counts) / columns.length).toBeLessThanOrEqual(0.45)
  expect(meaningful(surface_counts)).toBeGreaterThanOrEqual(6)
  expect(matching_neighbors / neighbor_count).toBeGreaterThanOrEqual(0.55)
  expect(land_share).toBeGreaterThanOrEqual(0.88)
  expect(land_share).toBeLessThanOrEqual(0.97)
  expect(beach_share).toBeGreaterThanOrEqual(0.015)
  expect(beach_share).toBeLessThanOrEqual(0.12)
  expect(snow_share).toBeGreaterThan(0)
  expect(snow_share).toBeLessThanOrEqual(0.005)
  expect(heights[Math.floor(heights.length * 0.05)]).toBeLessThanOrEqual(70)
  expect(heights[Math.floor(heights.length * 0.95)]).toBeGreaterThanOrEqual(120)
  expect(heights.at(-1)).toBeGreaterThanOrEqual(320)
  expect(heights.at(-1)).toBeLessThanOrEqual(MAX_SURFACE_Y)

  const spawn = sample_world_column(world, 0, 0)
  expect(spawn.biome.name).toBe('plains')
  expect(spawn.surface_y).toBeGreaterThanOrEqual(terrain.sea_level)
})

test('Nauvis shoreline splines stay within the one-block traversal step', () => {
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')
  const world = compile_world_recipe(parse_world_recipe(terrain), { structures: false })
  const rises: number[] = []

  for (let z = -1024; z < -768; z += 1)
    for (let x = -1024; x < -768; x += 1) {
      const height = sample_world_column(world, x, z).surface_y
      const neighbours = [
        sample_world_column(world, x + 1, z).surface_y,
        sample_world_column(world, x, z + 1).surface_y,
      ]
      neighbours.forEach((neighbour) => {
        if (
          Math.min(height, neighbour) <= terrain.sea_level + 8 &&
          Math.max(height, neighbour) >= terrain.sea_level - 2
        )
          rises.push(Math.abs(height - neighbour))
      })
    }

  expect(Math.max(...rises)).toBeLessThanOrEqual(1)
})
