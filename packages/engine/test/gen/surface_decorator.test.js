// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// surface_decorator.js gate (VEG PHASE B) — proves the schematic-forest swap: the biome→species
// mapping is coherent, the cross-chunk HALO makes wide canopies straddle chunk borders identically
// regardless of stream order, stamped canopies actually MESH (the historic bald-tree/invisible-canopy
// occupancy lesson), and the whole decorated path stays deterministic. The stamper's own cross-border
// clip/union proof lives in schematics/stamper.test.js; this file is the DECORATOR-level contract.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE } from '../../src/config/world_config.js'
import { create_chunk_record, local_index, column_index } from '../../src/chunks/format.js'
import { get_block_by_name } from '../../src/config/block_registry.js'
import { mesh_chunk } from '../../src/mesh/mesher.js'
import { decode_quad } from '../../src/mesh/quad_buffer.js'
import { get_biome_by_name } from '../../src/config/biome_registry.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { load_schematic, load_schematic_set, voxel_count } from '../../src/gen/schematics/loader.js'
import { select_schematic, stamp_into_chunk } from '../../src/gen/schematics/stamper.js'
import {
  create_gen_context,
  anchor_surface,
  build_column_profile,
  fill_chunk_from_profile,
} from '../../src/gen/column_gen.js'
import { generate_world_chunk } from '../../src/gen/world_gen.js'
import {
  BIOME_SCHEMATICS,
  filter_by_prefix,
  decorate_chunk,
  decoration_availability,
} from '../../src/gen/surface_decorator.js'
import { surface_flora } from '../../src/gen/surface_flora.js'
import { surface_moisture } from '../../src/gen/surface_density.js'
import { generate_tree } from '../../src/gen/trees/tree_gen.js'
import { SPECIES } from '../../src/gen/trees/species.js'

const LEAVES = /** @type {number} */ (get_block_by_name('leaves')?.id)
// D164 species mapping: taiga → leaves_conifer, savanna → leaves_dry. Family-counting helper so the
// spill/coverage asserts survive species reassignment (the mapping is the feature, not drift).
const LEAF_IDS = ['leaves', 'leaves_conifer', 'leaves_dry'].map((n) => /** @type {number} */ (get_block_by_name(n)?.id))
/** @param {import('../../src/chunks/format.js').ChunkRecord} c @returns {number} */
const leaf_quads_of = (c) => LEAF_IDS.reduce((n, id) => n + quads_of(c, id), 0)
const LOG = /** @type {number} */ (get_block_by_name('log')?.id)
const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const TREE_SET = load_schematic_set('tree')
const ROCK_SET = load_schematic_set('rock')

/**
 * Counts the quads a chunk meshes for a given block id (isolated chunk — null halos; border faces
 * fall back internally). This is the mesh-LEVEL occupancy proof: a block with no occupancy bits emits
 * ZERO quads (the bald-tree defect), so a positive count proves the stamper set occupancy correctly.
 * @param {import('../../src/chunks/format.js').ChunkRecord} chunk
 * @param {number} block_id
 * @returns {number}
 */
function quads_of(chunk, block_id) {
  const { quad_buffer, quad_count } = mesh_chunk(chunk, undefined)
  let n = 0
  for (let i = 0; i < quad_count; i += 1) {
    if (decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]).block_id === block_id) n += 1
  }
  return n
}

describe('loaded sets + availability', () => {
  test('both schematic sets loaded (bundle present)', () => {
    const a = decoration_availability()
    expect(a.trees_enabled).toBe(true)
    expect(a.rocks_enabled).toBe(true)
    // FIVE-WORLDS P2: the bundle now ships the FULL legacy library (was a curated 34). The decorator's
    // BIOME_SCHEMATICS still PLACES only a climate-curated subset; the rest are library assets wired
    // into biome_registry.structure_pools for phase-3 pool-aware placement.
    // FIVE-WORLDS §P3: +6 hand-composed trees (4 palms + 2 mangroves) ⇒ 114 → 120.
    expect(a.tree_species).toBe(120)
    expect(a.rock_species).toBe(148)
    expect(a.tree_halo).toBeGreaterThan(0)
    expect(a.rock_halo).toBeGreaterThan(0)
  })
})

describe('biome → species mapping', () => {
  test('every mapped biome name is a real registry biome', () => {
    for (const name of Object.keys(BIOME_SCHEMATICS)) {
      expect(get_biome_by_name(name)).toBeDefined()
    }
  })

  test('every mapped prefix resolves to at least one loaded schematic (no dead prefixes)', () => {
    for (const rule of Object.values(BIOME_SCHEMATICS)) {
      for (const p of rule.trees) {
        expect(TREE_SET.some((s) => s.name.startsWith(p))).toBe(true)
      }
      for (const p of rule.rocks) {
        expect(ROCK_SET.some((s) => s.name.startsWith(p))).toBe(true)
      }
    }
  })

  test('SCHEMATIC TREE STAMPS RETIRED — every biome trees list is empty (proc-tree default, GEN_VERSION 8)', () => {
    // Trees are grown procedurally now (the per-biome tree_species roster; the climate→species mapping moved
    // there). BIOME_SCHEMATICS keeps only rocks + the tree_one_in DENSITY gate the proc pick reads — so NO
    // biome carries schematic tree assets any more. ?proctrees=0 (procedural OFF) therefore grows no trees.
    for (const [name, rule] of Object.entries(BIOME_SCHEMATICS)) {
      expect(rule.trees, `biome "${name}" schematic trees`).toEqual([])
    }
    // The tree_one_in DENSITY gate (now the PROC-tree density) still encodes climate: deserts sparser than forests.
    expect(BIOME_SCHEMATICS.desert.tree_one_in).toBeGreaterThan(BIOME_SCHEMATICS.dense_forest.tree_one_in)
  })

  test('forest biomes are DENSER than sparse ones (dense forests, sparse deserts)', () => {
    // smaller one_in ⇒ denser. dense_forest is the densest, desert/arctic the sparsest.
    expect(BIOME_SCHEMATICS.dense_forest.tree_one_in).toBeLessThan(BIOME_SCHEMATICS.grassland.tree_one_in)
    expect(BIOME_SCHEMATICS.temperate_forest.tree_one_in).toBeLessThan(BIOME_SCHEMATICS.grassland.tree_one_in)
    expect(BIOME_SCHEMATICS.desert.tree_one_in).toBeGreaterThan(BIOME_SCHEMATICS.taiga.tree_one_in)
  })

  test('ocean / river / alpine absent; beach stays in the table (rocks + proc density) with trees retired', () => {
    expect(BIOME_SCHEMATICS.ocean).toBeUndefined()
    expect(BIOME_SCHEMATICS.river).toBeUndefined()
    expect(BIOME_SCHEMATICS.alpine).toBeUndefined()
    // beach stays in the table (its tree_one_in drives Paradise's proc palms) but its schematic trees are retired.
    expect(BIOME_SCHEMATICS.beach?.trees).toEqual([])
    expect(BIOME_SCHEMATICS.beach?.tree_one_in).toBeGreaterThan(0) // proc palm density gate survives
  })

  test('filter_by_prefix preserves set order and matches all size variants', () => {
    const g = filter_by_prefix(TREE_SET, ['GRASSLAND_TREE'])
    // Full pack ships all four growth variants (was G1/G4 only in the curated set).
    expect(g.map((s) => s.name).sort()).toEqual([
      'GRASSLAND_TREE_G1',
      'GRASSLAND_TREE_G2',
      'GRASSLAND_TREE_G3',
      'GRASSLAND_TREE_G4',
    ])
    // order preserved: filtered order is a subsequence of the source order
    const idx = g.map((s) => TREE_SET.indexOf(s))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(filter_by_prefix(TREE_SET, [])).toEqual([])
  })
})

describe('every PLACED schematic variant is reachable (no dead art among wired families)', () => {
  // select_schematic picks by column hash; over a wide hash sweep of each biome's resolved set, EVERY
  // variant of EVERY family BIOME_SCHEMATICS references must be selectable — else a WIRED .schem is dead.
  // FIVE-WORLDS P2: the bundle is now the full legacy library (114 trees/148 rocks); the decorator places
  // a climate-curated SUBSET and the rest are library assets wired into biome_registry.structure_pools for
  // phase-3 pool-aware placement. So this guards the PLACED families (the union of the resolved biome sets),
  // not the whole bundle — an unreferenced library schematic is intentionally unplaced, not a bug.
  test('every variant referenced by BIOME_SCHEMATICS is selectable from some biome set', () => {
    const ctx = create_gen_context()
    const seed = ctx.seeds.decorators
    const reachable = new Set()
    const placed_trees = new Set()
    const placed_rocks = new Set()
    for (const rule of Object.values(BIOME_SCHEMATICS)) {
      const trees = filter_by_prefix(TREE_SET, rule.trees)
      const rocks = filter_by_prefix(ROCK_SET, rule.rocks)
      for (const s of trees) placed_trees.add(s.name)
      for (const s of rocks) placed_rocks.add(s.name)
      for (let i = 0; i < 6000; i += 1) {
        const wx = i * 7 - 20000
        const wz = i * 13 - 15000
        if (trees.length) {
          const p = select_schematic(seed, wx, wz, trees)
          if (p) reachable.add(p.schematic.name)
        }
        if (rocks.length) {
          const p = select_schematic(seed, wx + 1, wz + 1, rocks)
          if (p) reachable.add(p.schematic.name)
        }
      }
    }
    // Schematic TREE stamps are RETIRED (C4) — no biome references tree families now, so no tree art is
    // "placed" here (trees are procedural). The dead-art guard now covers the still-wired ROCK families.
    expect(placed_trees.size).toBe(0)
    expect(placed_rocks.size).toBeGreaterThan(0)
    for (const name of placed_rocks) expect(reachable.has(name)).toBe(true)
  })
})

describe('OCCUPANCY LESSON: stamped canopy meshes (bald-tree regression guard)', () => {
  test('a grassland tree stamped into a chunk emits >0 leaf quads AND >0 log quads', () => {
    const s = load_schematic('GRASSLAND_TREE_G4')
    const c = create_chunk_record(0, 4, 0)
    const written = stamp_into_chunk(c, 0, 4, 0, 16, 16, 130, s, 0)
    expect(written).toBe(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).length) // whole tree fits in-bounds
    expect(quads_of(c, LEAVES)).toBeGreaterThan(0) // canopy is NOT invisible
    expect(quads_of(c, LOG)).toBeGreaterThan(0) // trunk renders
  })

  test('a stamped rock emits >0 solid (stone) quads', () => {
    const s = load_schematic('TEMPERATE_ROCK_G6')
    const c = create_chunk_record(0, 4, 0)
    stamp_into_chunk(c, 0, 4, 0, 16, 16, 130, s, 0)
    expect(quads_of(c, STONE)).toBeGreaterThan(0)
  })
})

describe('HALO: giant tree straddling 4 chunks (TAIGA_CHENE_BIG_G2, 21×73×25)', () => {
  // Anchor at the shared corner of the four XZ chunks (0,0)(1,0)(0,1)(1,1); the 21-wide, 73-tall tree
  // (reach 12) spills into every one of them, across ~3 vertical chunks. The stamper clips each chunk
  // to its own bounds; the union must tile the whole tree with NO overlaps and NO holes, and the result
  // must be independent of the order chunks are generated in (decoration is a pure fn of world coords).
  const NAME = 'TAIGA_CHENE_BIG_G2'
  const WX = 31
  const WZ = 31
  const SY = 130
  const s = load_schematic(NAME)
  const CY0 = 4
  const CY1 = Math.floor((SY + s.size[1]) / CHUNK_SIZE) // top chunk the canopy reaches

  /** Stamp the tree into one chunk (isolated) and return its non-air world-cell map. */
  const stamp_chunk = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ cz) => {
    const c = create_chunk_record(cx, cy, cz)
    stamp_into_chunk(c, cx, cy, cz, WX, WZ, SY, s, 0)
    /** @type {Map<string, number>} */
    const m = new Map()
    for (let ly = 0; ly < CHUNK_SIZE; ly += 1)
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1)
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const b = c.ids[local_index(lx, ly, lz)]
          if (b !== 0) m.set(`${cx * CHUNK_SIZE + lx},${cy * CHUNK_SIZE + ly},${cz * CHUNK_SIZE + lz}`, b)
        }
    return m
  }

  test('the tree spills leaves into all 4 XZ chunks (canopy truly crosses both borders)', () => {
    for (const [cx, cz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      let leaf = 0
      for (let cy = CY0; cy <= CY1; cy += 1) {
        const c = create_chunk_record(cx, cy, cz)
        stamp_into_chunk(c, cx, cy, cz, WX, WZ, SY, s, 0)
        leaf += leaf_quads_of(c)
      }
      expect(leaf).toBeGreaterThan(0)
    }
  })

  test('union of clipped chunks == the whole tree, disjoint, stream-order independent', () => {
    /** @type {[number,number][]} */
    const xz = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]
    /** Build the union in a given (cx,cz,cy) traversal order. */
    const build_union = (/** @type {[number,number][]} */ order) => {
      /** @type {Map<string, number>} */
      const u = new Map()
      let dup = 0
      for (const [cx, cz] of order)
        for (let cy = CY0; cy <= CY1; cy += 1)
          for (const [k, id] of stamp_chunk(cx, cy, cz)) {
            if (u.has(k)) dup += 1
            u.set(k, id)
          }
      return { u, dup }
    }
    const forward = build_union(xz)
    const reversed = build_union([...xz].reverse())
    expect(forward.dup).toBe(0) // disjoint slices, no double-write
    // stream order cannot change the result (pure function of coords)
    expect(forward.u.size).toBe(reversed.u.size)
    for (const [k, id] of forward.u) expect(reversed.u.get(k)).toBe(id)
    // and the union equals the schematic's full non-air voxel count (nothing lost to clipping)
    expect(forward.u.size).toBe(/** @type {NonNullable<typeof s.voxels>} */ (s.voxels).length)
  })
})

describe('decorate_chunk determinism (decorated path is a pure fn of world coords)', () => {
  test('regenerating a decorated chunk yields byte-identical ids', () => {
    const a = generate_world_chunk(3, 4, 3)
    const b = generate_world_chunk(3, 4, 3)
    expect(Buffer.from(a.ids.buffer)).toEqual(Buffer.from(b.ids.buffer))
  })

  test('a chunk decorated at two different seeds differs (seed is actually folded in)', () => {
    // Same terrain fill, two decoration seeds: the decoration hashes fold the seed, so placements move.
    const ctx = create_gen_context()
    const [cx, cy, cz] = [3, 4, 3]
    const profile = build_column_profile(ctx, cx, cz)
    /** decorate a fresh fill of the SAME column at an explicit seed → its ids */
    const decorate_seeded = (/** @type {number} */ seed) => {
      const chunk = fill_chunk_from_profile(ctx, profile, cx, cy, cz)
      decorate_chunk(chunk, profile, cx, cy, cz, seed, ctx)
      return chunk.ids
    }
    expect(Buffer.from(decorate_seeded(1).buffer)).not.toEqual(Buffer.from(decorate_seeded(2).buffer))
  })
})

describe('anchor_surface is the single source of truth (in-chunk == halo probe)', () => {
  test('anchor_surface matches the built profile surface on land columns', () => {
    const ctx = create_gen_context()
    // A land chunk footprint; compare anchor_surface(wx,wz) to profile.surface_y for every column.
    const cx = 3
    const cz = 3
    const profile = build_column_profile(ctx, cx, cz)
    let checked = 0
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const wx = cx * CHUNK_SIZE + lx
        const wz = cz * CHUNK_SIZE + lz
        const ci = column_index(lx, lz)
        // Only assert on non-beach land columns (beach is flattened in world_gen, not in the profile
        // here; and beaches grow no trees so the anchor value is irrelevant there).
        if (profile.biome_id[ci] === /** @type {number} */ (get_biome_by_name('beach')?.id)) continue
        const a = anchor_surface(ctx, wx, wz)
        expect(a.surface_y).toBe(profile.surface_y[ci])
        expect(a.biome_id).toBe(profile.biome_id[ci])
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('schematic trees appear in-world through the full generate_world_chunk path', () => {
  // End-to-end: real forest chunk columns near origin (taiga/temperate for the "aresrpg" seed) must
  // mesh leaf quads — the whole pipeline (fill → decorate → halo → stamp → occupancy → mesher) works,
  // not just the isolated stamper. Coords found by a forest-chunk scan. (The exhaustive "all 10 tree
  // families + ≥5 rock families spawn" world survey is the exit probe veg_b_report.json — too heavy
  // for the fast unit suite; family REACHABILITY is already proven above.)
  test('forest chunk columns emit >0 leaf quads over their surface stack', () => {
    /** @type {[number,number][]} known-forest chunk columns for the hardcoded seed */
    const forest_columns = [
      [-4, 0],
      [-3, 0],
      [-4, 1],
    ]
    for (const [cx, cz] of forest_columns) {
      let leaf = 0
      for (let cy = 4; cy <= 6; cy += 1) {
        leaf += leaf_quads_of(generate_world_chunk(cx, cy, cz))
      }
      expect(leaf).toBeGreaterThan(0)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DIVERGENCE WAVE — the grass OCEAN (surface_flora placement rule + end-to-end mesh proof)
// ══════════════════════════════════════════════════════════════════════════════════════════════

const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const TALL_GRASS = /** @type {number} */ (get_block_by_name('tall_grass')?.id)
const REED = /** @type {number} */ (get_block_by_name('reed')?.id)
const FERN = /** @type {number} */ (get_block_by_name('fern')?.id)
const TUFT = /** @type {number} */ (get_block_by_name('grass_tuft')?.id)

/** A representative low-meadow surface_y for the flora sweeps: just above sea level, where the organic
 *  density field's altitude falloff is at full lushness (so the sweep measures the moisture-driven band,
 *  not an altitude-thinned one). SEA_LEVEL 128 + 12. */
const MEADOW_SURFACE_Y = 140

/**
 * Sweep a side×side world-column grid through surface_flora → { coverage, counts by block id }. All
 * columns are sampled at MEADOW_SURFACE_Y (low, lush) so the measurement isolates the moisture field.
 * @param {number} surface_block
 * @param {import('../../src/config/biome_registry.js').BiomeDef | undefined} biome
 * @param {boolean} is_shore
 * @param {number} [side]
 * @param {number} [surface_y]
 */
function flora_stats(surface_block, biome, is_shore, side = 48, surface_y = MEADOW_SURFACE_Y) {
  /** @type {Map<number, number>} */
  const counts = new Map()
  let planted = 0
  for (let wz = 0; wz < side; wz += 1) {
    for (let wx = 0; wx < side; wx += 1) {
      const id = surface_flora(surface_block, biome, is_shore, wx, wz, 12345, surface_y)
      counts.set(id, (counts.get(id) ?? 0) + 1)
      if (id !== 0) planted += 1
    }
  }
  return { coverage: planted / (side * side), counts }
}

describe('surface_flora: the grass-ocean placement rule (pure, per-column)', () => {
  const grassland = get_biome_by_name('grassland') // tree_density 0.03 → open MEADOW
  const dense_forest = get_biome_by_name('dense_forest') // tree_density 0.35 → FOREST floor
  const river = get_biome_by_name('river') // grass_density 0.3, sand margin → reeds
  const beach = get_biome_by_name('beach') // grass_density 0.05 → below the reed floor

  test('open meadow reads FULL as a SPECIES-MIXED herb layer — grass dominant, weeds + blooms as seasoning', () => {
    // side=256 spans several MOIST_PERIOD_BIG (88-block) moisture wavelengths, so the estimate averages
    // across humid hollows + dry rises instead of landing inside one patch (a small window swings widely
    // BY DESIGN now — that organic variance IS the feature; see the border-continuity test below).
    const { coverage, counts } = flora_stats(GRASS, grassland, false, 256)
    // [2026-07-05 owner] the carpet is gated by a CONTINUOUS organic density field (humidity + altitude +
    // random; coverage_probability) — humid hollows near-full, dry rises thin, high ground sparse. At the
    // low MEADOW_SURFACE_Y this humid-leaning region near origin nets ~0.52; the band pins the design
    // (organic, NOT the old plant-on-every-column >0.95 and NOT sparse-empty) with room for the field's
    // per-region moisture spread. The missing-chunks defect (a chunk-sized bare macro cell) is gone —
    // coverage is column-continuous, never chunk-quantized (proven in the border-continuity test below).
    expect(coverage).toBeGreaterThan(0.35)
    expect(coverage).toBeLessThan(0.7)
    // OWNER REF #2 ("5-8 visibly different plants… grass dominant, weeds/flowers as seasoning"): the
    // short grass tuft is the plurality; tall_grass, wild flowers, and the broad-leaf weed (fern art)
    // all appear MIXED per-cell so neighbours read as different species, not one grass at N sizes.
    const tuft = counts.get(TUFT) ?? 0
    const tall = counts.get(TALL_GRASS) ?? 0
    const fern = counts.get(FERN) ?? 0
    const flowers = [...counts.entries()]
      .filter(([id]) => id !== TUFT && id !== TALL_GRASS && id !== FERN && id !== 0)
      .reduce((s, [, n]) => s + n, 0)
    expect(tuft).toBeGreaterThan(tall) // grass dominant
    expect(tuft).toBeGreaterThan(fern) // grass dominant over the weed
    expect(tall).toBeGreaterThan(0) // tall accent present
    expect(fern).toBeGreaterThan(0) // broad-leaf weed mixed in (ref #2 — NOT forest-only)
    expect(flowers).toBeGreaterThan(0) // wild blooms seasoning the meadow
    // ≥4 distinct species share the meadow → visibly varied, not a monoculture.
    expect(counts.size).toBeGreaterThanOrEqual(4)
  })

  test('forest floor (dense_forest) grows a low fern carpet, NOT the meadow, with bare readable paths', () => {
    // Sweep wide (160² ⇒ ~100 grove cells) so the ~1/5 bare-path cells reliably appear (a small sweep
    // can miss them all and read 100%).
    const { coverage, counts } = flora_stats(GRASS, dense_forest, false, 160)
    expect(counts.get(FERN) ?? 0).toBeGreaterThan(0)
    expect(counts.get(TALL_GRASS) ?? 0).toBe(0) // canopy biomes never grow the open-meadow tall accent
    expect(coverage).toBeGreaterThan(0.5) // a furnished low fern carpet
    expect(coverage).toBeLessThan(0.95) // but grove PATHS stay bare so trunks + lanes read
  })

  test('water margins grow reeds; the same surface off the shore band does not', () => {
    // river margins are SAND (river biome surface), grass_density 0.3 ≥ the reed floor.
    expect(flora_stats(SAND, river, true).counts.get(REED) ?? 0).toBeGreaterThan(0)
    expect(flora_stats(SAND, river, false).counts.get(REED) ?? 0).toBe(0) // reeds are a waterline fringe
  })

  test('reeds skip arid margins (beach grass_density below the vegetation floor)', () => {
    expect(flora_stats(SAND, beach, true).counts.get(REED) ?? 0).toBe(0)
  })

  test('is a pure deterministic function of its inputs (integer hashing, §3.7)', () => {
    for (let i = 0; i < 300; i += 1) {
      const wx = i * 37 - 1500
      const wz = i * 53 - 900
      const sy = 135 + (i % 40)
      expect(surface_flora(GRASS, grassland, false, wx, wz, 7, sy)).toBe(
        surface_flora(GRASS, grassland, false, wx, wz, 7, sy)
      )
    }
  })

  test('coverage is ORGANIC + chunk-border-continuous: no 32-block periodicity, no chunk-square holes', () => {
    // The old defect: a 37-block macro coverage cell (> a 32-block chunk) blanked whole chunk footprints.
    // The field is now continuous world-coord noise. Prove it two ways at a fixed low altitude.
    // (1) NO chunk-aligned holes: scan a wide low-meadow strip in 32-chunk tiles; NO tile is fully bare
    //     (the old macro cell produced 0% tiles). Humid variance means some tiles are sparse, none empty.
    let fully_bare = 0
    const tiles = 24
    for (let tz = 0; tz < 4; tz += 1) {
      for (let tx = 0; tx < tiles; tx += 1) {
        let planted = 0
        for (let lz = 0; lz < 32; lz += 1) {
          for (let lx = 0; lx < 32; lx += 1) {
            if (surface_flora(GRASS, grassland, false, tx * 32 + lx, tz * 32 + lz, 12345, MEADOW_SURFACE_Y) !== 0)
              planted += 1
          }
        }
        if (planted === 0) fully_bare += 1
      }
    }
    expect(fully_bare).toBe(0) // a chunk-sized bare macro cell would show up here; the field can't produce one

    // (2) CONTINUITY across a chunk border (x=32): the coverage PROBABILITY either side of the border is
    //     nearly equal (continuous field), unlike the old macro cell that stepped at its 37-block edge.
    const p_at = (/** @type {number} */ x) => surface_moisture(x, 17, 12345)
    let max_step = 0
    for (let x = 28; x <= 36; x += 1) max_step = Math.max(max_step, Math.abs(p_at(x) - p_at(x + 1)))
    expect(max_step).toBeLessThan(0.05) // adjacent columns across the border differ only slightly
  })

  test('ALTITUDE falloff: the same moisture region is lusher LOW than HIGH (sparser on rises)', () => {
    // Sweep the identical XZ window at a low vs a high surface_y — high ground must be measurably thinner.
    const low = flora_stats(GRASS, grassland, false, 128, 138).coverage
    const high = flora_stats(GRASS, grassland, false, 128, 210).coverage
    expect(low).toBeGreaterThan(high + 0.1) // altitude visibly thins coverage on high ground
  })

  test('decoration_availability reports the new cross-flora blocks baked', () => {
    const a = decoration_availability()
    expect(a.tall_grass).toBe(true)
    expect(a.reed).toBe(true)
    expect(a.fern).toBe(true)
    expect(a.meadow_flowers).toBeGreaterThanOrEqual(2)
  })
})

describe('grass ocean reaches the mesh end-to-end (decorate → mesh, pinned columns for the seed)', () => {
  // Columns found by a world scan (a local flora scan): the densest tall_grass / reed / fern chunks
  // near origin for the hardcoded "aresrpg" seed. Proves the full pipeline (fill → decorate → mesh) puts
  // each flora on the GPU buffer at its registry cross_height (h≥2 for tall_grass/reed).
  test('a meadow chunk meshes the waist-high carpet (h=2) plus chest-high tall_grass accents (h=3)', () => {
    let tall = 0
    let carpet = 0
    for (const q of decode_all(mesh_chunk(generate_world_chunk(3, 4, -4)))) {
      if (q.face < 6) continue
      if (q.block_id === TALL_GRASS) {
        tall += 1
        expect(q.h).toBe(3) // the tall accent is chest-high (deliberately taller)
      }
      if (q.block_id === TUFT) {
        carpet += 1
        expect(q.h).toBe(2) // the carpet is now waist-high (was a squat 1-block lawn)
      }
    }
    expect(tall).toBeGreaterThan(40) // scattered tall accent stands are present
    expect(carpet).toBeGreaterThan(40) // and the dense low carpet is the bulk
  })

  test('a shore chunk meshes reeds (h=3) and a forest chunk meshes fern undergrowth', () => {
    let reed = 0
    for (const q of decode_all(mesh_chunk(generate_world_chunk(-4, 4, -3)))) {
      if (q.block_id === REED && q.face >= 6) {
        reed += 1
        expect(q.h).toBe(3)
      }
    }
    expect(reed).toBeGreaterThan(0)

    let fern = 0
    for (const q of decode_all(mesh_chunk(generate_world_chunk(1, 4, -3)))) {
      if (q.block_id === FERN && q.face >= 6) fern += 1
    }
    expect(fern).toBeGreaterThan(0)
  })
})

/** Decode every quad of a mesh result. @param {{quad_buffer: Uint32Array, quad_count: number}} r */
function decode_all({ quad_buffer, quad_count }) {
  /** @type {import('../../src/mesh/quad_buffer.js').QuadFields[]} */
  const out = []
  for (let i = 0; i < quad_count; i += 1) out.push(decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]))
  return out
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROCEDURAL TREES (ENGINE_AAA_PLAN §3.5, lane B1) — the ?proctrees=1 pick-gate + memo + halo.
// The frozen-default byte-identity proof is the WHOLE suite above running green on the DEFAULT config
// (which now carries trees.procedural:false): decoration is byte-identical to the pre-wiring schematic
// world. These tests add the flag-ON contract: the pick swaps to a synthesized tree, it MESHES (trunk +
// canopy occupancy), the path stays deterministic, the roster is coherent, and a synthesized GIANT tiles
// across chunks through the same halo/union machinery (A2's reach_cap feeds the halo governor).
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Decorate a cy 4..6 forest-column stack under `config` → { leaf, log, buf } (mesh quad counts + ids).
 *  @param {import('../../src/config/world_gen_config.js').WorldGenConfig} config @param {number} cx @param {number} cz */
function decorate_forest_stack(config, cx, cz) {
  const ctx = create_gen_context(config)
  const seed = ctx.seeds.decorators
  let leaf = 0
  let log = 0
  /** @type {Buffer[]} */
  const bufs = []
  for (let cy = 4; cy <= 6; cy += 1) {
    const profile = build_column_profile(ctx, cx, cz)
    const chunk = fill_chunk_from_profile(ctx, profile, cx, cy, cz)
    decorate_chunk(chunk, profile, cx, cy, cz, seed, ctx)
    leaf += leaf_quads_of(chunk)
    log += quads_of(chunk, LOG)
    bufs.push(Buffer.from(chunk.ids.buffer.slice(0)))
  }
  return { leaf, log, buf: Buffer.concat(bufs) }
}

/** A proctrees-ON LIVE-PATH clone (baked_variants unset ⇒ 0 ⇒ per-column synthesis — the ?baketrees=0
 *  escape). The GEN_VERSION 9 DEFAULT bakes 32 variants; the BAKED-default contract is tested below. */
const PROCTREES_ON = { ...structuredClone(DEFAULT_WORLD_GEN_CONFIG), trees: { procedural: true } }
/** A proctrees-OFF clone — the ?proctrees=0 escape (procedural OFF ⇒ a rock-only, TREELESS world: the
 *  schematic tree stamps are retired, so OFF grows no trees, not legacy ones). */
const PROCTREES_OFF = { ...structuredClone(DEFAULT_WORLD_GEN_CONFIG), trees: { procedural: false } }

describe('PROCTREES C4: procedural trees are the DEFAULT (schematic tree stamps retired)', () => {
  test('DEFAULT_WORLD_GEN_CONFIG ships procedural ON + a populated per-biome roster', () => {
    expect(DEFAULT_WORLD_GEN_CONFIG.trees?.procedural).toBe(true) // C4: proc trees are the default world
    expect(Object.keys(DEFAULT_WORLD_GEN_CONFIG.tree_species ?? {}).length).toBeGreaterThan(0) // the live roster
    // GEN_VERSION 9: trees are pre-baked 32-variants-per-species and stamped.
    expect(DEFAULT_WORLD_GEN_CONFIG.trees?.baked_variants).toBe(32)
  })

  test('BAKED DEFAULT decorates deterministically and the stamped variant MESHES (trunk + canopy)', () => {
    // The shipping recipe (baked 32 + rotation): same forest stack twice ⇒ byte-identical; leaf AND log
    // quads both mesh (occupancy set — no bald/holey regression through the baked+rotated stamp path).
    const baked_cfg = structuredClone(DEFAULT_WORLD_GEN_CONFIG)
    const a = decorate_forest_stack(baked_cfg, -4, 0)
    decorate_forest_stack(baked_cfg, 50, 50) // busts the size-1 column cache between the two scans
    const b = decorate_forest_stack(baked_cfg, -4, 0)
    expect(a.buf.equals(b.buf)).toBe(true)
    expect(a.leaf).toBeGreaterThan(0)
    expect(a.log).toBeGreaterThan(0)
    // and the baked world differs from the LIVE-path world (the pick + rotation actually engaged)
    const live = decorate_forest_stack(PROCTREES_ON, -4, 0)
    expect(a.buf.equals(live.buf)).toBe(false)
  })

  test('the roster is COHERENT: every biome is real, every species exists, weights are positive ints', () => {
    const roster = DEFAULT_WORLD_GEN_CONFIG.tree_species ?? {}
    for (const [biome_name, entries] of Object.entries(roster)) {
      expect(get_biome_by_name(biome_name), `biome "${biome_name}"`).toBeDefined()
      for (const e of entries) {
        expect(SPECIES[e.species], `species "${e.species}"`).toBeDefined()
        expect(Number.isInteger(e.weight) && e.weight > 0).toBe(true)
      }
    }
  })
})

describe('PROCTREES flag ON: the pick swaps to a synthesized tree that MESHES', () => {
  // A forest column that grows NO trees with procedural OFF (schematic stamps retired) must grow a synthesized
  // tree ON — different ids, and the canopy AND trunk both mesh (>0 leaf and >0 log quads = occupancy set, no
  // bald/holey regression). Same grove+density gate, so a column that hit before hits the proc pick now.
  test('a forest column decorates DIFFERENTLY ON vs OFF, and the synthesized tree renders trunk + canopy', () => {
    const off = decorate_forest_stack(PROCTREES_OFF, -4, 0)
    const on = decorate_forest_stack(PROCTREES_ON, -4, 0)
    expect(off.buf.equals(on.buf)).toBe(false) // the pick actually swapped
    expect(on.leaf).toBeGreaterThan(0) // synthesized canopy meshes (not invisible)
    expect(on.log).toBeGreaterThan(0) // synthesized voxel trunk/branches mesh (not bald)
  })

  test('the procedural path is DETERMINISTIC (fresh scans, same config+seed ⇒ byte-identical ids)', () => {
    const a = decorate_forest_stack(PROCTREES_ON, -4, 0)
    decorate_forest_stack(PROCTREES_ON, 50, 50) // busts the size-1 column cache between the two scans
    const b = decorate_forest_stack(PROCTREES_ON, -4, 0)
    expect(a.buf.equals(b.buf)).toBe(true)
  })
})

describe('HALO §3.5.4: a SYNTHESIZED giant tiles across chunks (proc-tree union proof)', () => {
  // A2's reach data feeds the halo governor: pine_cathedral (reach_cap 12) synthesized at the shared corner
  // of the four XZ chunks spills into all of them across several vertical chunks. The stamper clips each
  // chunk to its own bounds; the union must equal the whole tree — no overlaps, no holes, stream-order
  // independent — exactly the guarantee the schematic HALO test proves, now for procedural output.
  const seed = 12345
  const WX = 31
  const WZ = 31
  const SY = 130
  const giant = generate_tree(seed, WX, WZ, 'pine_cathedral') // mature: ~23×62×22, reach 11
  const CY0 = Math.floor(SY / CHUNK_SIZE)
  const CY1 = Math.floor((SY + giant.size[1]) / CHUNK_SIZE)

  test('the synthesized giant is tall, within its reach_cap (the halo governor), and not bald', () => {
    expect(giant.size[1]).toBeGreaterThan(CHUNK_SIZE) // a true giant: crosses >= 2 vertical chunks
    expect(giant.reach).toBeLessThanOrEqual(SPECIES.pine_cathedral.reach_cap) // fits the halo
    expect(voxel_count(giant)).toBeGreaterThan(SPECIES.pine_cathedral.voxel_floor) // not holey/occupancy-missed
  })

  /** Stamp the giant into one isolated chunk → its non-air world-cell map. */
  const stamp_chunk = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ cz) => {
    const c = create_chunk_record(cx, cy, cz)
    stamp_into_chunk(c, cx, cy, cz, WX, WZ, SY, giant, 0)
    /** @type {Map<string, number>} */
    const m = new Map()
    for (let ly = 0; ly < CHUNK_SIZE; ly += 1)
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1)
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const b = c.ids[local_index(lx, ly, lz)]
          if (b !== 0) m.set(`${cx * CHUNK_SIZE + lx},${cy * CHUNK_SIZE + ly},${cz * CHUNK_SIZE + lz}`, b)
        }
    return m
  }

  test('union of clipped chunks == the whole synthesized tree, disjoint, stream-order independent', () => {
    /** @type {[number,number][]} */
    const xz = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]
    const build_union = (/** @type {[number,number][]} */ order) => {
      /** @type {Map<string, number>} */
      const u = new Map()
      let dup = 0
      for (const [cx, cz] of order)
        for (let cy = CY0; cy <= CY1; cy += 1)
          for (const [k, id] of stamp_chunk(cx, cy, cz)) {
            if (u.has(k)) dup += 1
            u.set(k, id)
          }
      return { u, dup }
    }
    const forward = build_union(xz)
    const reversed = build_union([...xz].reverse())
    expect(forward.dup).toBe(0) // disjoint slices, no double-write
    expect(forward.u.size).toBe(reversed.u.size) // stream order cannot change the result
    for (const [k, id] of forward.u) expect(reversed.u.get(k)).toBe(id)
    expect(forward.u.size).toBe(voxel_count(giant)) // nothing lost to clipping — the union IS the tree
  })
})
