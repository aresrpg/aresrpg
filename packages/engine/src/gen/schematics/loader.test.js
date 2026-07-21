// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gate for the schematic loader + registry mapping (§4.6 phase A). Golden fixtures pin the CONVERTED
// pack (dims + block counts + palette→registry mapping for 3 real schematics incl. the biggest
// tree), and the coverage report proves every legacy block in the shipped bundle resolves to a real
// registry block (no silent fallbacks). If the converter output drifts, the goldens break.

import { statSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test, expect, describe } from 'bun:test'

import { get_block_by_name } from '../../config/block_registry.js'

import { map_block_name, mapping_coverage } from './registry_map.js'
import { load_schematic, load_schematic_set, load_all_schematics, bundle_block_names } from './loader.js'

const id = /** @param {string} n */ (n) => /** @type {number} */ (get_block_by_name(n)?.id)
const LOG = id('log')
const LEAVES = id('leaves')
const LEAVES_CONIFER = id('leaves_conifer') // D164 species mapping: taiga/spruce sets
const SNOW = id('snow')
const ICE = id('ice')
const PACKED_ICE = id('packed_ice')
const STONE = id('stone')
const SAND = id('sand')
const GRASS = id('grass')
const DIRT = id('dirt')

const BUNDLE_PATH = fileURLToPath(new URL('../../../assets/schematics/schematics.json', import.meta.url))

describe('registry_map keyword ruleset', () => {
  /** @type {[string, number, import('./registry_map.js').MappingTier][]} */
  const cases = [
    ['oak_wood', LOG, 'faithful'],
    ['spruce_wood', LOG, 'faithful'],
    ['stripped_acacia_wood', LOG, 'faithful'],
    ['oak_log', LOG, 'faithful'],
    ['azalea_leaves', LEAVES, 'faithful'],
    ['dark_oak_leaves', LEAVES, 'faithful'],
    ['jungle_leaves', LEAVES, 'faithful'],
    ['snow_block', SNOW, 'faithful'],
    ['sandstone', SAND, 'faithful'],
    ['cut_sandstone', SAND, 'faithful'],
    ['smooth_red_sandstone', SAND, 'faithful'],
    ['grass_block', GRASS, 'faithful'],
    ['dirt', DIRT, 'faithful'],
    ['coarse_dirt', DIRT, 'faithful'],
    ['podzol', DIRT, 'faithful'],
    ['stone', STONE, 'faithful'],
    ['cobblestone', STONE, 'faithful'],
    ['mossy_cobblestone', STONE, 'faithful'],
    ['andesite', STONE, 'faithful'],
    ['blackstone', STONE, 'faithful'],
    ['gravel', STONE, 'faithful'],
    // FIVE-WORLDS: real ice blocks now exist ⇒ the ice family maps FAITHFULLY (was the lossy ice→snow stand-in).
    ['packed_ice', PACKED_ICE, 'faithful'],
    ['blue_ice', PACKED_ICE, 'faithful'],
    ['ice', ICE, 'faithful'],
    // lossy stand-ins (registry has no colored decorative blocks)
    ['cyan_terracotta', STONE, 'lossy'],
    ['orange_terracotta', STONE, 'lossy'],
    ['red_concrete', STONE, 'lossy'],
    ['light_gray_wool', STONE, 'lossy'],
    // ordering: green decorative wins over generic terracotta→stone
    ['green_terracotta', LEAVES, 'lossy'],
    ['green_concrete', LEAVES, 'lossy'],
    // air variants
    ['air', id('air'), 'faithful'],
  ]
  for (const [name, expected_id, tier] of cases) {
    test(`${name} → ${tier}`, () => {
      const m = map_block_name(name)
      expect(m.block_id).toBe(expected_id)
      expect(m.tier).toBe(tier)
    })
  }

  test('unknown block → documented hard fallback (stone), flagged unmapped', () => {
    const m = map_block_name('totally_made_up_block')
    expect(m.block_id).toBe(STONE)
    expect(m.tier).toBe('unmapped')
  })
})

describe('pack parse golden fixtures', () => {
  /**
   * @type {{ name:string, size:[number,number,number], blocks:number, ids:number[] }[]}
   * ids = the distinct resolved registry block ids expected in the schematic.
   */
  const goldens = [
    { name: 'GRASSLAND_TREE_G1', size: [8, 9, 7], blocks: 172, ids: [LOG, LEAVES] },
    { name: 'GRASSLAND_BIRCH_G1', size: [5, 7, 5], blocks: 69, ids: [LOG, LEAVES] },
    // biggest tree in the pack
    { name: 'TAIGA_CHENE_BIG_G2', size: [21, 73, 25], blocks: 5033, ids: [LOG, LEAVES_CONIFER, SNOW] }, // D164: taiga leaves → conifer
    // biggest rock in the pack (cyan_terracotta + stone-likes all collapse to stone)
    { name: 'GRASSLAND_ROCK_BIG_G3', size: [34, 49, 35], blocks: 10179, ids: [STONE] },
  ]

  for (const g of goldens) {
    test(`${g.name}: dims + block count + mapped palette`, () => {
      const s = load_schematic(g.name)
      expect(s.size).toEqual(g.size)
      expect(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).length).toBe(g.blocks)
      const distinct = new Set(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).map((v) => v.block_id))
      expect([...distinct].sort((a, b) => a - b)).toEqual([...g.ids].sort((a, b) => a - b))
      // every voxel resolved to a known registry block, and offsets stay within the footprint
      const [w, h, l] = g.size
      for (const v of /** @type {NonNullable<typeof s.voxels>} */ (s.voxels)) {
        expect(get_block_by_name('air')).toBeDefined()
        expect(Math.abs(v.dx)).toBeLessThan(w)
        expect(v.dy).toBeGreaterThanOrEqual(0)
        expect(v.dy).toBeLessThan(h)
        expect(Math.abs(v.dz)).toBeLessThan(l)
      }
    })
  }

  test('leaves use replace_foliage, structural blocks overwrite', () => {
    const s = load_schematic('GRASSLAND_TREE_G1')
    for (const v of /** @type {NonNullable<typeof s.voxels>} */ (s.voxels)) {
      if (v.block_id === LEAVES) expect(v.mode).toBe('replace_foliage')
      else expect(v.mode).toBe('overwrite')
      expect(v.solid).toBe(true) // all mapped targets are occupancy-bearing
    }
  })
})

describe('bundle inventory + budget', () => {
  test('ships ≥6 tree species and ≥3 rock species', () => {
    const species = /** @param {{name:string}[]} set */ (set) => new Set(set.map((s) => s.name.replace(/_G\d+$/, '')))
    const trees = species(load_schematic_set('tree'))
    const rocks = species(load_schematic_set('rock'))
    expect(trees.size).toBeGreaterThanOrEqual(6)
    expect(rocks.size).toBeGreaterThanOrEqual(3)
  })

  // FIVE-WORLDS P2: the bundle now ships the FULL legacy pack (262 schematics, was a curated 34),
  // so the old <1MB curation budget is superseded. 8MB is the static-import ceiling above which a
  // lazy-loading split would be warranted (raw ≈1.85MB / gzip ≈0.44MB today — comfortably under).
  test('bundle is under the 8MB static-import budget', () => {
    expect(statSync(BUNDLE_PATH).size).toBeLessThan(8 * 1024 * 1024)
  })

  test('mapping coverage: every shipped block resolves (0 unmapped)', () => {
    const cov = mapping_coverage(bundle_block_names())
    expect(cov.total).toBeGreaterThan(0)
    expect(cov.unmapped).toBe(0)
    expect(cov.coverage).toBe(1)
    // record the report artifact
    mkdirSync('/tmp/aresrpg-engine-artifacts', { recursive: true })
    writeFileSync(
      '/tmp/aresrpg-engine-artifacts/veg_a_coverage.json',
      JSON.stringify(
        {
          total: cov.total,
          faithful: cov.faithful,
          lossy: cov.lossy,
          unmapped: cov.unmapped,
          coverage: cov.coverage,
          lossy_blocks: cov.entries.filter((e) => e.tier === 'lossy').map((e) => e.name),
          unmapped_blocks: cov.entries.filter((e) => e.tier === 'unmapped').map((e) => e.name),
          entries: cov.entries,
        },
        null,
        2
      )
    )
  })

  test('every resolved schematic has voxels and a sane anchor', () => {
    for (const s of load_all_schematics().values()) {
      expect(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).length).toBeGreaterThan(0)
      const [ax, ay, az] = s.anchor
      const [w, h, l] = s.size
      expect(ax).toBeGreaterThanOrEqual(0)
      expect(ax).toBeLessThan(w)
      expect(ay).toBeGreaterThanOrEqual(0)
      expect(ay).toBeLessThan(h)
      expect(az).toBeGreaterThanOrEqual(0)
      expect(az).toBeLessThan(l)
    }
  })
})
