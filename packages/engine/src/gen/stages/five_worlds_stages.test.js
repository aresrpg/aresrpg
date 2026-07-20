// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIVE-WORLDS shared gated stages — per-stage sensitivity + parity gate (BIOMES_EXECUTION_PLAN §P3).
// For every stage: ENABLING it in a test config CHANGES the generated columns deterministically, and
// DISABLING it returns to the DEFAULT (parity) column byte-for-byte. The golden DEFAULT parity itself is
// held by gen/config_adoption.test.js; this file proves each stage is a REAL, isolated, deterministic lever.

import { test, expect, describe, afterAll } from 'bun:test'

import { create_gen_context, generate_column } from '../column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../config/world_gen_config.js'
import { SEA_LEVEL, CHUNKS_PER_COLUMN } from '../../config/world_config.js'
import { get_block_by_name } from '../../config/block_registry.js'
import { load_schematic, load_schematic_set, load_pool } from '../schematics/loader.js'
import { expand_placement } from '../schematics/stamper.js'
import { generate_world_chunk, set_gen_config } from '../world_gen.js'
import { configure_water_optics, current_water_optics } from '../../render/water_material.js'
import { create_biome_context, place_biome, place_biome_def, candidate_biomes } from '../biome_placer.js'
import { surface_flora } from '../surface_flora.js'
import { get_biome_by_name } from '../../config/biome_registry.js'
import { PARADISE_WORLD } from '../../config/worlds/paradise.js'

import { create_iceberg_context, iceberg_block } from './icebergs.js'

afterAll(() => set_gen_config(DEFAULT_WORLD_GEN_CONFIG))

/** Deep clone the default so a test config never poisons the shared default. */
const clone = () => structuredClone(DEFAULT_WORLD_GEN_CONFIG)

/** Count occurrences of a block id across every chunk of a generated column.
 * @param {any[]} column @param {number} id @returns {number} */
function count_block(column, id) {
  let n = 0
  for (const chunk of column) for (let i = 0; i < chunk.ids.length; i += 1) if (chunk.ids[i] === id) n += 1
  return n
}

/** Total id diff between two columns (same coords, two recipes).
 * @param {any[]} a @param {any[]} b @returns {number} */
function column_diff(a, b) {
  let d = 0
  for (let cy = 0; cy < a.length; cy += 1)
    for (let i = 0; i < a[cy].ids.length; i += 1) if (a[cy].ids[i] !== b[cy].ids[i]) d += 1
  return d
}

/** Sum a sentinel block id over a grid of chunk-columns for a config.
 * @param {any} config @param {number} sentinel_id @param {number[][]} chunks @returns {number} */
function scan_sentinel(config, sentinel_id, chunks) {
  const ctx = create_gen_context(config)
  let n = 0
  for (const [cx, cz] of chunks) n += count_block(generate_column(ctx, cx, cz), sentinel_id)
  return n
}

const GLOWSTONE = /** @type {number} */ (get_block_by_name('glowstone')?.id) // id 9 — NEVER produced by column_gen ⇒ a clean stage sentinel
const CHUNKS = [
  [-2, -2],
  [-1, -1],
  [0, 0],
  [1, 1],
  [2, 2],
  [-49, -49],
  [-2, 2],
  [2, -2],
]

describe('FIVE-WORLDS · STRATA BANDING (Riviera)', () => {
  test('enabling bands steep columns with the palette (sentinel appears); disabling ⇒ none', () => {
    const off = scan_sentinel(DEFAULT_WORLD_GEN_CONFIG, GLOWSTONE, CHUNKS)
    expect(off).toBe(0) // glowstone is never produced by the default column pipeline
    const on = clone()
    on.strata = { ...on.strata, enabled: true, slope_gate: 0.1, palette: ['snow', 'glowstone'] }
    expect(scan_sentinel(on, GLOWSTONE, CHUNKS)).toBeGreaterThan(0)
  })

  test('deterministic — same strata config reproduces the same column', () => {
    const cfg = clone()
    cfg.strata = { ...cfg.strata, enabled: true, slope_gate: 0.1, palette: ['snow', 'glowstone'] }
    const a = generate_column(create_gen_context(cfg), -49, -49)
    const b = generate_column(create_gen_context(cfg), -49, -49)
    expect(column_diff(a, b)).toBe(0)
  })

  test('disabled strata column is byte-identical to DEFAULT', () => {
    const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), -49, -49)
    const off = clone()
    off.strata = { ...off.strata, enabled: false }
    expect(column_diff(base, generate_column(create_gen_context(off), -49, -49))).toBe(0)
  })
})

describe('FIVE-WORLDS · CANYON STAGE (Riviera, additive)', () => {
  test('enabling the additive canyon deepens the gated inland columns (column changes)', () => {
    const on = clone()
    // Width 0.25 > the baseline 0.17 ⇒ a strict superset of carved columns, so the additive carve is
    // guaranteed to change some inland column across the scanned chunks (deterministic diff).
    on.carvers = { ...on.carvers, canyon: { enabled: true, width: 0.25, depth: 70, wall_steepness: 2, warp: true } }
    let total = 0
    for (const [cx, cz] of CHUNKS) {
      const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), cx, cz)
      total += column_diff(base, generate_column(create_gen_context(on), cx, cz))
    }
    expect(total).toBeGreaterThan(0)
  })

  test('disabled canyon stage is byte-identical to DEFAULT (baseline canyon untouched)', () => {
    const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), -49, -49)
    const off = clone()
    off.carvers = { ...off.carvers, canyon: { ...off.carvers.canyon, enabled: false } }
    expect(column_diff(base, generate_column(create_gen_context(off), -49, -49))).toBe(0)
  })
})

describe('FIVE-WORLDS · SLOPE/SNOW SURFACE (Everest)', () => {
  test('enabling the snow cap paints high flat tops (sentinel snow_block appears); disabling ⇒ none', () => {
    const off = clone()
    off.surface = { ...off.surface, snow_enabled: false, slope_enabled: false }
    expect(scan_sentinel(off, GLOWSTONE, CHUNKS)).toBe(0)
    const on = clone()
    on.surface = {
      ...on.surface,
      snow_enabled: true,
      snow_line: 135,
      grass_slope: 2.0,
      steep_slope: 3.0,
      snow_block: 'glowstone',
    }
    expect(scan_sentinel(on, GLOWSTONE, CHUNKS)).toBeGreaterThan(0)
  })

  test('bare-rock override paints steep faces (sentinel rock_block appears)', () => {
    const on = clone()
    on.surface = { ...on.surface, slope_enabled: true, steep_slope: 0.3, rock_block: 'glowstone' }
    expect(scan_sentinel(on, GLOWSTONE, CHUNKS)).toBeGreaterThan(0)
  })
})

describe('FIVE-WORLDS · ICEBERG PLACER (Everest oceans)', () => {
  const cfg = {
    enabled: true,
    region_size: 384,
    region_rate: 1,
    blobs_min: 3,
    blobs_max: 3,
    radius_min: 12,
    radius_max: 12,
    freeboard: 0.4,
    draft: 0.9,
  }
  const ICE = /** @type {number} */ (get_block_by_name('ice')?.id)
  const PACKED = /** @type {number} */ (get_block_by_name('packed_ice')?.id)

  test('ice appears at sea level in an iceberg region; ICE above the waterline, PACKED below', () => {
    const ic = create_iceberg_context({ carvers: 0xabcdef }, cfg, SEA_LEVEL)
    // Find a column near a blob CENTER — one deep enough that the keel (SEA_LEVEL-4) is PACKED_ICE AND the
    // freeboard (SEA_LEVEL+2) is ICE (a rim column would fail both, which is the correct dome behaviour).
    let center = null
    for (let z = 0; z < 384 && !center; z += 1)
      for (let x = 0; x < 384; x += 1) {
        if (iceberg_block(ic, x, SEA_LEVEL - 4, z) === PACKED && iceberg_block(ic, x, SEA_LEVEL + 2, z) === ICE) {
          center = [x, z]
          break
        }
      }
    expect(center, 'a region_rate:1 iceberg region has a deep blob (keel packed_ice, freeboard ice)').not.toBeNull()
  })

  test('disabled placer never places ice', () => {
    const ic = create_iceberg_context({ carvers: 0xabcdef }, { ...cfg, enabled: false }, SEA_LEVEL)
    let any = false
    for (let z = 0; z < 384 && !any; z += 4)
      for (let x = 0; x < 384; x += 4) if (iceberg_block(ic, x, SEA_LEVEL, z) >= 0) any = true
    expect(any).toBe(false)
  })
})

describe('FIVE-WORLDS · WATER-ANCHOR STAMPING (Everglades mangroves)', () => {
  test('mangroves are flagged water_anchor; palms/trees are not', () => {
    expect(load_schematic('MANGROVE_G1').water_anchor).toBe(true)
    expect(load_schematic('MANGROVE_G2').water_anchor).toBe(true)
    expect(load_schematic('PALM_TREE_G1').water_anchor).toBe(false)
    // No non-mangrove tree accidentally flagged.
    expect(load_schematic_set('tree').filter((s) => s.water_anchor && !s.name.startsWith('MANGROVE')).length).toBe(0)
  })

  test('a mangrove anchored on a below-sea seabed roots underwater with canopy above the waterline', () => {
    const m = load_schematic('MANGROVE_G2')
    const seabed = SEA_LEVEL - 4 // flooded column: base 4 blocks under the surface
    const voxels = expand_placement(0, 0, seabed, m, 0)
    const min_y = Math.min(...voxels.map((v) => v.wy))
    const max_y = Math.max(...voxels.map((v) => v.wy))
    expect(min_y).toBeLessThan(SEA_LEVEL) // roots flooded
    expect(max_y).toBeGreaterThan(SEA_LEVEL) // canopy above water
  })
})

describe('FIVE-WORLDS · BIOME-PLACER config adoption (single-family pin)', () => {
  /** @param {object} o @returns {any} a full ClimateSample */
  const climate = (o) => ({
    temperature: 0.5,
    humidity: 0.5,
    continentalness: 0.65,
    erosion: 0.6,
    pv: 0.5,
    weirdness: 0.5,
    ...o,
  })
  const TROPICAL = /** @type {number} */ (get_biome_by_name('tropical')?.id)
  const tropical_family = DEFAULT_WORLD_GEN_CONFIG.biomes.filter((b) => [0, 1, 2, 12].includes(b.id))

  test('the default context reads config.biomes and equals the registry default (parity)', () => {
    const from_cfg = create_biome_context(DEFAULT_WORLD_GEN_CONFIG.biomes, DEFAULT_WORLD_GEN_CONFIG.biome_selection)
    const c = climate({ temperature: 0.3, continentalness: 0.7, pv: 0.55 })
    expect(place_biome(c, from_cfg)).toBe(place_biome(c)) // config-built == module-default
  })

  test('a TRIMMED biome table restricts the candidate set (single-family pin)', () => {
    const ctx = create_biome_context(tropical_family)
    const cands = candidate_biomes(0.5, ctx)
    expect(cands.length).toBe(4) // only the trimmed family, never the full 17-registry set
    expect(cands.some((b) => b.name === 'taiga')).toBe(false)
  })

  test('climate_bias pins the family (tropical wins where without-bias it does not)', () => {
    const no_bias = create_biome_context(tropical_family)
    const pinned = create_biome_context(tropical_family, { climate_bias: { temperature: 0.4, humidity: 0.4 } })
    const c = climate({ temperature: 0.5, humidity: 0.5 }) // mid climate: tropical (0.85) is NOT nearest
    expect(place_biome(c, no_bias)).not.toBe(TROPICAL)
    expect(place_biome(c, pinned)).toBe(TROPICAL) // the bias shifts the sample hot+humid ⇒ tropical
  })

  test('place_biome_def returns the CONFIG biome def (a world can retune land/densities)', () => {
    const retuned = tropical_family.map((b) => (b.id === TROPICAL ? { ...b, tree_density: 0.99 } : b))
    const ctx = create_biome_context(retuned, { climate_bias: { temperature: 0.4, humidity: 0.4 } })
    const def = place_biome_def(climate({ temperature: 0.5, humidity: 0.5 }), ctx)
    expect(def.id).toBe(TROPICAL)
    expect(def.tree_density).toBe(0.99) // the config value, not the registry's 0.28
  })
})

describe('FIVE-WORLDS · STRUCTURE-POOL OVERRIDES (config-only decorator hook)', () => {
  test('load_pool resolves bundle pools; unknown ⇒ empty', () => {
    expect(load_pool('pool_mangrove').length).toBe(2)
    expect(load_pool('pool_palms').length).toBe(4)
    expect(load_pool('pool_palms').every((s) => s.category === 'tree')).toBe(true)
    expect(load_pool('nope_not_a_pool')).toEqual([])
  })

  test('an override maps a biome to a pool config-only (adds palms to forest/grassland; empty = parity)', () => {
    const CHUNKS = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [1, 3],
      [3, 1],
      [2, 0],
      [0, 2],
    ]
    const PALM_LOG = /** @type {number} */ (get_block_by_name('palm_log')?.id)
    const PALM_LEAF = /** @type {number} */ (get_block_by_name('palm_leaves')?.id)
    const count_palms = () => {
      let n = 0
      for (const [cx, cz] of CHUNKS)
        for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1) {
          const c = generate_world_chunk(cx, cy, cz)
          for (let i = 0; i < c.ids.length; i += 1) if (c.ids[i] === PALM_LOG || c.ids[i] === PALM_LEAF) n += 1
        }
      return n
    }
    // This hook is the SCHEMATIC tree-pool merge. Since C4 made procedural trees the default, the proc pick
    // shadows the schematic branch on LAND columns (it fires first + returns) — so exercise the schematic
    // override with procedural OFF, its actual domain (rock pools + water-anchored tree pools are unaffected).
    // SPAWN CLEARING opted OUT (GEN_VERSION 13): the canonical chunk set includes [0,0] — inside the spawn
    // glade — and the override's ONLY stamp in this sparse area lands there (probed: 36 palm voxels, all in
    // [0,0]), which the clearing correctly suppresses. This test's subject is the OVERRIDE hook, not the
    // clearing (which has its own proof), so isolate it — same idiom as the procedural:false opt-out above.
    const no_clearing = { ...DEFAULT_WORLD_GEN_CONFIG.decoration, spawn_clear_radius: 0 }
    set_gen_config({ ...DEFAULT_WORLD_GEN_CONFIG, trees: { procedural: false }, decoration: no_clearing })
    const base = count_palms() // schematic palms grow only on beaches ⇒ ~0 in this inland region
    set_gen_config({
      ...DEFAULT_WORLD_GEN_CONFIG,
      trees: { procedural: false },
      decoration: no_clearing,
      structure_pool_overrides: {
        grassland: ['pool_palms'],
        temperate_forest: ['pool_palms'],
        dense_forest: ['pool_palms'],
      },
    })
    const overridden = count_palms()
    expect(overridden).toBeGreaterThan(base) // the override merged pool_palms onto those biomes' trees
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
  })
})

describe('FIVE-WORLDS · SPRITE SELECTION (per-biome clutter)', () => {
  const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
  const TALL = /** @type {number} */ (get_block_by_name('tall_grass')?.id)
  const FERN = /** @type {number} */ (get_block_by_name('fern')?.id)
  const meadow = /** @type {any} */ ({
    name: 'tropical',
    grass_density: 0.9,
    tree_density: 0.05,
    land: { surface: 'grass' },
  })
  /** Count the flora ids surface_flora emits over a grid for a deco. */
  const flora_hist = (deco) => {
    /** @type {Record<number, number>} */
    const h = {}
    for (let x = 0; x < 160; x += 1)
      for (let z = 0; z < 160; z += 1) {
        const f = surface_flora(GRASS, meadow, false, x, z, 42, 140, deco)
        h[f] = (h[f] ?? 0) + 1
      }
    return h
  }

  test('default (no sprites map) emits tall_grass + fern (parity)', () => {
    const h = flora_hist(undefined)
    expect(h[TALL]).toBeGreaterThan(0)
    expect(h[FERN]).toBeGreaterThan(0)
  })

  test('disabling a sprite kind removes it (Paradise: no temperate tall grass); tufts survive', () => {
    const off = flora_hist({ sprites: { tall_grass: false, fern: false } })
    expect(off[TALL] ?? 0).toBe(0) // no temperate tall grass
    expect(off[FERN] ?? 0).toBe(0)
    expect(off[/** @type {number} */ (get_block_by_name('grass_tuft')?.id)]).toBeGreaterThan(0) // short carpet remains
  })
})

describe('FIVE-WORLDS · SUBMERGED CORAL (Paradise reef sprites)', () => {
  const CORALS = ['coral_pink', 'coral_purple', 'coral_teal'].map((n) => get_block_by_name(n)?.id)
  const CORAL_SET = new Set(CORALS.filter((id) => id !== undefined))
  const count_coral = (cfg) => {
    set_gen_config(cfg)
    let n = 0
    for (let cx = -2; cx <= 2; cx += 1)
      for (let cz = -2; cz <= 2; cz += 1)
        for (const cy of [3, 4]) {
          const chunk = generate_world_chunk(cx, cy, cz)
          for (let i = 0; i < chunk.ids.length; i += 1) if (CORAL_SET.has(chunk.ids[i])) n += 1
        }
    return n
  }

  test('Paradise grows submerged coral fans (opt-in sprites.coral)', () => {
    expect(count_coral(PARADISE_WORLD)).toBeGreaterThan(0)
  })

  test('without sprites.coral the reef is empty (opt-in ⇒ default OFF ⇒ parity)', () => {
    const no_coral = structuredClone(PARADISE_WORLD)
    delete (/** @type {any} */ (no_coral.decoration).sprites.coral)
    expect(count_coral(no_coral)).toBe(0)
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG) // restore global gen state for the rest of the suite
  })
})

describe('FIVE-WORLDS · PER-CONFIG WATER OPTICS', () => {
  test('defaults equal the live constants; configure changes them; reverting restores byte-identical', () => {
    const before = current_water_optics()
    expect(before.body_color).toEqual([0.03, 0.105, 0.15])
    expect(before.sigma).toEqual([0.9, 0.62, 0.48])
    configure_water_optics({
      body_color: [0.4, 0.28, 0.1],
      shallow_color: [0.5, 0.4, 0.2],
      sigma: [2.2, 1.6, 1.1],
      fade_start: 1,
      tint_depth: 3,
      deep_floor: 0.35,
    })
    const after = current_water_optics()
    expect(after.body_color[0]).toBeCloseTo(0.4)
    expect(after.sigma[0]).toBeCloseTo(2.2)
    expect(after.fade_start).toBe(1)
    // Revert to the DEFAULT recipe's water (== the constants) — byte-identical DEFAULT water.
    configure_water_optics(DEFAULT_WORLD_GEN_CONFIG.water)
    expect(current_water_optics().body_color).toEqual([0.03, 0.105, 0.15])
    expect(current_water_optics().fade_start).toBe(2.5)
  })
})

describe('FIVE-WORLDS · new blocks (ice / packed_ice / palm_log / palm_leaves)', () => {
  test('all four resolve in the registry with the expected classes', () => {
    expect(get_block_by_name('ice')?.class).toBe('solid')
    expect(get_block_by_name('packed_ice')?.class).toBe('solid')
    expect(get_block_by_name('palm_log')?.class).toBe('solid')
    expect(get_block_by_name('palm_leaves')?.class).toBe('solid')
  })

  test('palm schematics resolve their palette to the real palm blocks (not generic log/leaves)', () => {
    const palm = load_schematic('PALM_TREE_G2')
    const ids = new Set(palm.voxels.map((v) => v.block_id))
    expect(ids.has(/** @type {number} */ (get_block_by_name('palm_log')?.id))).toBe(true)
    expect(ids.has(/** @type {number} */ (get_block_by_name('palm_leaves')?.id))).toBe(true)
    expect(ids.has(/** @type {number} */ (get_block_by_name('log')?.id))).toBe(false)
  })
})
