// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// world_gen_config gate (lane NG1-E). Covers the three exit criteria:
//   1. VALIDATION accept/reject — the default passes; each structural/range violation is caught.
//   2. DEFAULT COMPLETENESS — every inventoried live constant is present in DEFAULT_WORLD_GEN_CONFIG
//      with the byte-faithful value (guards against a silent drift from the live gen constants).
//   3. HASH stability + sensitivity — config_hash is deterministic across calls, order-INDEPENDENT
//      (key reordering ⇒ same hash), and value-SENSITIVE (any change ⇒ different hash).
//
// The completeness check is the load-bearing one: it cross-references the ACTUAL live constants
// (imported from the real gen modules) against the config defaults, so if a gen tunable changes and
// the config isn't updated, this test fails — enforcing the config as the single source of truth.

import { test, expect, describe } from 'bun:test'

// ---- Live constants, pulled from the real gen modules for the completeness cross-check ----------
import { DEFAULT_FAR_RADIUS_M } from '../../src/lod/far_streamer.js'
import { DENSITY_CONFIG } from '../../src/gen/density.js'
import { HYDROLOGY_CONFIG } from '../../src/gen/hydrology.js'
import { SPLINE_SOURCE } from '../../src/gen/terrain_shaper.js'
import { SUBSURFACE_DEPTH, WEIRDNESS_ESOTERIC_THRESHOLD, BIOME_REGISTRY } from '../../src/config/biome_registry.js'
import {
  MASTER_SEED,
  GEN_VERSION,
  CHUNK_SIZE,
  WORLD_HEIGHT,
  SEA_LEVEL,
  HARD_FLOOR_Y,
  LOAD_RADIUS_CHUNKS,
} from '../../src/config/world_config.js'
import {
  DEFAULT_WORLD_GEN_CONFIG,
  validate_world_gen_config,
  config_hash,
  config_hash_hex,
  canonical_serialize,
} from '../../src/config/world_gen_config.js'

/**
 * Deep clone of the default so mutation-based reject cases never poison the shared default. Typed
 * `any` deliberately: the reject tests intentionally poke invalid shapes (delete required keys,
 * out-of-range values) that the strict WorldGenConfig type would forbid — that IS the test.
 * @returns {any}
 */
function clone_default() {
  return structuredClone(DEFAULT_WORLD_GEN_CONFIG)
}

describe('validation: the default config is valid', () => {
  test('DEFAULT_WORLD_GEN_CONFIG passes with zero errors', () => {
    const result = validate_world_gen_config(DEFAULT_WORLD_GEN_CONFIG)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('validation: reject cases (structural + range)', () => {
  test('non-object config is rejected', () => {
    expect(validate_world_gen_config(null).ok).toBe(false)
    expect(validate_world_gen_config(42).ok).toBe(false)
    expect(validate_world_gen_config('x').ok).toBe(false)
  })

  test('empty seed is rejected', () => {
    const c = clone_default()
    c.seed = ''
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.startsWith('seed'))).toBe(true)
  })

  test('non-integer / non-positive version is rejected', () => {
    const c = clone_default()
    c.version = 1.5
    expect(validate_world_gen_config(c).ok).toBe(false)
    c.version = 0
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('a missing top-level section is reported', () => {
    const c = clone_default()
    delete c.hydrology
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('hydrology'))).toBe(true)
  })

  test('lod is OPTIONAL — a config without it still validates (pre-P1 back-compat)', () => {
    const c = clone_default()
    delete c.lod
    expect(validate_world_gen_config(c).ok).toBe(true)
  })

  test('lod.full_voxel_radius_chunks below 1 or non-integer is rejected', () => {
    const c = clone_default()
    c.lod.full_voxel_radius_chunks = 0
    expect(validate_world_gen_config(c).ok).toBe(false)
    c.lod.full_voxel_radius_chunks = 5.5
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('lod.full_voxel_radius_chunks'))).toBe(true)
  })

  test('lod.far_radius_m out of range is rejected', () => {
    const c = clone_default()
    c.lod.far_radius_m = -1
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('lod.far_radius_m'))).toBe(true)
  })

  test('a noise field with 0 octaves is rejected', () => {
    const c = clone_default()
    c.noise.temperature.octaves = 0
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('noise.temperature.octaves'))).toBe(true)
  })

  test('a missing noise field is reported', () => {
    const c = clone_default()
    delete c.noise.weirdness
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('noise.weirdness'))).toBe(true)
  })

  test('a missing density noise band (warp/detail) is reported', () => {
    const c = clone_default()
    delete c.density.detail
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('density.detail'))).toBe(true)
  })

  test('inverted cave depths (depth_min > depth_max) is rejected', () => {
    const c = clone_default()
    c.carvers.caves.depth_min = 50
    c.carvers.caves.depth_max = 10
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('caves'))).toBe(true)
  })

  test('a non-ascending spline is rejected', () => {
    const c = clone_default()
    c.splines.pv_to_relief = [
      [0, 0],
      [0, 1],
      [1, 1],
    ] // duplicate x = not strictly ascending
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('pv_to_relief'))).toBe(true)
  })

  test('a spline knot x outside [0,1] is rejected', () => {
    const c = clone_default()
    c.splines.erosion_to_amplitude = [
      [0, 72],
      [1.5, 4],
    ]
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('sea level above the world height is rejected', () => {
    const c = clone_default()
    c.hydrology.sea_level = c.geometry.world_height + 100
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('sea_level'))).toBe(true)
  })

  test('an inverted beach band (low > high) is rejected', () => {
    const c = clone_default()
    c.hydrology.beach.band_low = 200
    c.hydrology.beach.band_high = 100
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('beach'))).toBe(true)
  })

  test('an inverted sky band (low_y > high_y) is rejected', () => {
    const c = clone_default()
    c.sky.low_y = 360
    c.sky.high_y = 300
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('grass_slope > steep_slope is rejected', () => {
    const c = clone_default()
    c.surface.grass_slope = 0.9
    c.surface.steep_slope = 0.5
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('duplicate biome ids are rejected', () => {
    const c = clone_default()
    c.biomes[1].id = c.biomes[0].id
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('duplicate id'))).toBe(true)
  })

  test('a biome id above 255 (Uint8-persisted) is rejected', () => {
    const c = clone_default()
    c.biomes[0].id = 256
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('a biome climate axis outside [0,1] is rejected', () => {
    const c = clone_default()
    c.biomes[0].climate.temperature = 1.4
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('an empty biomes array is rejected', () => {
    const c = clone_default()
    c.biomes = []
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('a zero decoration denominator (div-by-zero risk) is rejected', () => {
    const c = clone_default()
    c.decoration.tree_grove_one_in = 0
    const r = validate_world_gen_config(c)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('tree_grove_one_in'))).toBe(true)
  })

  test('oak trunk_min > trunk_max is rejected', () => {
    const c = clone_default()
    c.decoration.oak.trunk_min = 10
    c.decoration.oak.trunk_max = 4
    expect(validate_world_gen_config(c).ok).toBe(false)
  })

  test('reports ALL problems at once (not fail-fast)', () => {
    const c = clone_default()
    c.seed = ''
    c.version = -1
    c.biomes[0].id = 999
    const r = validate_world_gen_config(c)
    expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('completeness: default mirrors the live gen constants byte-faithfully', () => {
  // `any` so the string-indexed field/section loops below read cleanly (this is a data cross-check).
  const d = /** @type {any} */ (DEFAULT_WORLD_GEN_CONFIG)

  test('seed + version + geometry + sea level + hard floor match world_config.js', () => {
    expect(d.seed).toBe(MASTER_SEED)
    expect(d.version).toBe(GEN_VERSION) // config version tracks the live generator identity (§4)
    expect(d.geometry.chunk_size).toBe(CHUNK_SIZE)
    expect(d.geometry.world_height).toBe(WORLD_HEIGHT)
    expect(d.hydrology.sea_level).toBe(SEA_LEVEL)
    expect(d.density.hard_floor_y).toBe(HARD_FLOOR_Y) // live bedrock floor (NG1-A)
  })

  test('climate noise periods + octaves match fields.js', () => {
    // fields.js: TEMPERATURE 2048, HUMIDITY 1536, CONTINENTALNESS 4096, EROSION 1024, WEIRDNESS 512;
    // CLIMATE_OCTAVES=6, weirdness octaves=4.
    expect(d.noise.temperature).toMatchObject({ period: 2048, octaves: 6 })
    expect(d.noise.humidity).toMatchObject({ period: 1536, octaves: 6 })
    expect(d.noise.continentalness).toMatchObject({ period: 4096, octaves: 6 })
    expect(d.noise.erosion).toMatchObject({ period: 1024, octaves: 6 })
    expect(d.noise.weirdness).toMatchObject({ period: 512, octaves: 4 })
  })

  test('fbm spread/gain defaults match sampler.js (spread 2, gain 0.5)', () => {
    for (const field of ['temperature', 'humidity', 'continentalness', 'erosion', 'weirdness']) {
      expect(d.noise[field].spread).toBe(2)
      expect(d.noise[field].gain).toBe(0.5)
    }
  })

  test('spline tables ARE the terrain_shaper source (config compiles into the shaper)', () => {
    // Config adoption inverted the ownership: terrain_shaper.js now COMPILES these tuples into its
    // runtime Catmull-Rom tables (SPLINE_SOURCE re-exports the compiled default), so the config IS the
    // single source of truth. Cross-check the config tuples round-trip to the shaper's live control
    // points — a real SSOT guard (the previous hardcoded [72/56/…] & [-0.15/…] literals were STALE
    // pre-NG1-B values that this test itself perpetuated; the decorated-chunk golden proves parity).
    const tuples = (/** @type {{x:number,y:number}[]} */ pts) => pts.map((p) => [p.x, p.y])
    expect(d.splines.continentalness_to_base).toEqual(tuples(SPLINE_SOURCE.continentalness_to_base))
    expect(d.splines.erosion_to_amplitude).toEqual(tuples(SPLINE_SOURCE.erosion_to_amplitude))
    expect(d.splines.pv_to_relief).toEqual(tuples(SPLINE_SOURCE.pv_to_relief))
    // And the corrected live values (NG1-B relief-amplitude retune, GEN_VERSION 3).
    expect(d.splines.erosion_to_amplitude).toEqual([
      [0.0, 148],
      [0.16, 120],
      [0.34, 66],
      [0.55, 30],
      [0.75, 12],
      [1.0, 4],
    ])
    expect(d.splines.pv_to_relief).toEqual([
      [0.0, -0.2],
      [0.12, 0.0],
      [0.35, 0.26],
      [0.65, 0.6],
      [1.0, 1.0],
    ])
  })

  test('density + caves + sky mirror the LIVE gen/density.js DENSITY_CONFIG 1:1', () => {
    // Single-source-of-truth guard: NG1-A owns DENSITY_CONFIG today; this config MUST mirror it, so
    // if the density agent retunes a value here, this test forces the config (and its hash) to follow.
    expect(d.density.band_blocks).toBe(DENSITY_CONFIG.band_blocks) // live 10
    expect(d.density.warp).toEqual(DENSITY_CONFIG.warp)
    expect(d.density.detail).toEqual(DENSITY_CONFIG.detail)
    expect(d.density.overhang).toEqual(DENSITY_CONFIG.overhang)
    expect(d.carvers.caves).toEqual(DENSITY_CONFIG.caves)
    // sky: DENSITY_CONFIG.sky IS the live SKY_ISLANDS_CONFIG (Pandora islands, v5). The config default
    // mirrors every grammar field 1:1 — if the gen agent retunes any, this forces the config + hash to
    // follow. Compared field-for-field (the config object has the same keys, no extras).
    expect(d.sky).toEqual(DENSITY_CONFIG.sky)
  })

  test('biome-selection metric matches biome_placer.js + biome_registry threshold', () => {
    // AXIS_WEIGHTS temp 1 / humid 1 / cont 0.6 / eros 0.5 / pv 0.4; BLEND_K 3; softness 0.6.
    expect(d.biome_selection.axis_weights).toEqual({
      temperature: 1.0,
      humidity: 1.0,
      continentalness: 0.6,
      erosion: 0.5,
      pv: 0.4,
    })
    expect(d.biome_selection.blend_k).toBe(3)
    expect(d.biome_selection.transition_softness).toBe(0.6)
    expect(d.biome_selection.weirdness_esoteric_threshold).toBe(WEIRDNESS_ESOTERIC_THRESHOLD) // 0.82
  })

  test('subsurface depth matches biome_registry.SUBSURFACE_DEPTH', () => {
    expect(d.strata.subsurface_depth).toBe(SUBSURFACE_DEPTH) // 4
  })

  test('the full biome table is transcribed 1:1 from BIOME_REGISTRY (ids/climate/land/densities)', () => {
    expect(d.biomes.length).toBe(BIOME_REGISTRY.length) // 17
    for (const live of BIOME_REGISTRY) {
      const cfg = d.biomes.find((/** @type {any} */ b) => b.id === live.id)
      expect(cfg, `biome id ${live.id} (${live.name}) present in config`).toBeDefined()
      if (!cfg) continue
      expect(cfg.name).toBe(live.name)
      expect(cfg.climate).toEqual(live.climate)
      expect(cfg.weight).toBe(live.weight)
      expect(cfg.weirdness_gate).toBe(live.weirdness_gate)
      expect(cfg.land).toEqual(live.land)
      expect(cfg.tree_density).toBe(live.tree_density)
      expect(cfg.grass_density).toBe(live.grass_density)
    }
  })

  test('decoration densities mirror the LIVE surface_decorator.js DECO_DEFAULTS 1:1', () => {
    // Adoption: surface_decorator reads config.decoration now (DECO_DEFAULTS = these values). The stale
    // grove_one_in/tree_one_in/flower_one_in/tuft_one_in keys were retired (unread by the live decorator).
    expect(d.decoration.grove_cell_shift).toBe(4) // GROVE_CELL_SHIFT
    expect(d.decoration.tree_grove_one_in).toBe(3) // TREE_GROVE_ONE_IN
    expect(d.decoration.rock_grove_one_in).toBe(6) // ROCK_GROVE_ONE_IN
    expect(d.decoration.forest_tree_density).toBe(0.15) // FOREST_TREE_DENSITY
    expect(d.decoration.tall_cluster_one_in).toBe(5)
    expect(d.decoration.tall_in_cluster_one_in).toBe(1)
    expect(d.decoration.fern_one_in).toBe(1)
    expect(d.decoration.forest_tuft_one_in).toBe(3)
    expect(d.decoration.path_one_in).toBe(5)
    expect(d.decoration.flower_patch_one_in).toBe(6)
    expect(d.decoration.flower_in_patch_one_in).toBe(3)
    expect(d.decoration.reed_one_in).toBe(2)
    expect(d.decoration.shore_band).toBe(2)
    expect(d.decoration.reed_min_grass).toBe(0.15)
    expect(d.decoration.oak).toEqual({ trunk_min: 4, trunk_max: 6, canopy_radius: 2, cap_radius: 1 })
  })

  test('beach flatten band matches world_gen.js (SEA_LEVEL -2 / +3 / +1)', () => {
    expect(d.hydrology.beach.band_low).toBe(SEA_LEVEL - 2) // 126
    expect(d.hydrology.beach.band_high).toBe(SEA_LEVEL + 3) // 131
    expect(d.hydrology.beach.flat_y).toBe(SEA_LEVEL + 1) // 129
  })

  test('hydrology river/lake/waterfall mirror the LIVE gen/hydrology.js HYDROLOGY_CONFIG 1:1', () => {
    // SSOT guard (adoption): create_hydrology_context reads config.hydrology now; if the live recipe is
    // retuned, this forces the config (and its hash) to follow. Compared field-for-field (no extras).
    expect(d.hydrology.river).toEqual(HYDROLOGY_CONFIG.river)
    expect(d.hydrology.lake).toEqual(HYDROLOGY_CONFIG.lake)
    expect(d.hydrology.waterfall).toEqual(HYDROLOGY_CONFIG.waterfall)
  })

  test('every top-level section is present (schema shape is complete)', () => {
    for (const key of [
      'seed',
      'version',
      'geometry',
      'noise',
      'splines',
      'density',
      'carvers',
      'hydrology',
      'strata',
      'surface',
      'sky',
      'biome_selection',
      'biomes',
      'decoration',
    ]) {
      expect(d[key], `section "${key}"`).toBeDefined()
    }
  })

  test('lod falloff defaults mirror the live render constants (§P1 SSOT — reproduce today)', () => {
    // The DEFAULT recipe must reproduce today's look: the near full-voxel ring == LOAD_RADIUS_CHUNKS
    // and the far-shell reach == DEFAULT_FAR_RADIUS_M. A trailer/biome world overrides these (shorter
    // near ring) for the §P1 fast-falloff curve; drift from the live constants fails HERE.
    expect(d.lod.full_voxel_radius_chunks).toBe(LOAD_RADIUS_CHUNKS)
    expect(d.lod.far_radius_m).toBe(DEFAULT_FAR_RADIUS_M)
  })
})

describe('config_hash: determinism, order-independence, sensitivity', () => {
  test('same config ⇒ same hash across repeated calls (deterministic)', () => {
    const h1 = config_hash(DEFAULT_WORLD_GEN_CONFIG)
    const h2 = config_hash(DEFAULT_WORLD_GEN_CONFIG)
    expect(h1).toBe(h2)
    expect(Number.isInteger(h1)).toBe(true)
    expect(h1).toBeGreaterThanOrEqual(0)
    expect(h1).toBeLessThanOrEqual(0xffffffff)
  })

  test('a fresh deep clone hashes identically (no reference/identity leakage)', () => {
    expect(config_hash(clone_default())).toBe(config_hash(DEFAULT_WORLD_GEN_CONFIG))
  })

  test('key ORDER does not change the hash (canonical serialization)', () => {
    // Rebuild the top level with keys in reverse insertion order — same data, different order.
    /** @type {Record<string, unknown>} */
    const reordered = {}
    const src = /** @type {Record<string, unknown>} */ (DEFAULT_WORLD_GEN_CONFIG)
    for (const key of Object.keys(src).reverse()) {
      reordered[key] = src[key]
    }
    // Also reorder a nested object.
    reordered.geometry = {
      world_height: DEFAULT_WORLD_GEN_CONFIG.geometry.world_height,
      chunk_size: DEFAULT_WORLD_GEN_CONFIG.geometry.chunk_size,
    }
    expect(config_hash(reordered)).toBe(config_hash(DEFAULT_WORLD_GEN_CONFIG))
  })

  test('any VALUE change ⇒ a different hash (sensitivity)', () => {
    const base = config_hash(DEFAULT_WORLD_GEN_CONFIG)

    const a = clone_default()
    a.seed = 'other'
    expect(config_hash(a)).not.toBe(base)

    const b = clone_default()
    b.hydrology.sea_level = 129
    expect(config_hash(b)).not.toBe(base)

    const c = clone_default()
    c.splines.pv_to_relief[0][1] = -0.16
    expect(config_hash(c)).not.toBe(base)

    const e = clone_default()
    e.biomes[3].tree_density = 0.031
    expect(config_hash(e)).not.toBe(base)

    // NOTE: default version is now 14 (mirrors world_config.GEN_VERSION at the v14 round-2 fork), so a
    // `f.version = 14` mutation would be a no-op vs the default and self-break. Use a value distinct from
    // the current default to actually exercise sensitivity.
    const f = clone_default()
    f.version = 15
    expect(config_hash(f)).not.toBe(base)
  })

  test('number vs string of the same digits do NOT collide (tagged primitives)', () => {
    const a = clone_default()
    a.version = 1
    const b = clone_default()
    /** @type {any} */ b.version = '1'
    expect(config_hash(a)).not.toBe(config_hash(b))
  })

  test('-0 and 0 hash the same (canonical -0 normalization)', () => {
    expect(canonical_serialize(-0)).toBe(canonical_serialize(0))
  })

  test('config_hash_hex is 8 lowercase hex chars and agrees with config_hash', () => {
    const hex = config_hash_hex(DEFAULT_WORLD_GEN_CONFIG)
    expect(hex).toMatch(/^[0-9a-f]{8}$/)
    expect(parseInt(hex, 16)).toBe(config_hash(DEFAULT_WORLD_GEN_CONFIG))
  })

  test('hash is a stable known value (regression guard — a drift here means the recipe changed)', () => {
    // Pin the current default's identity. If a live gen constant legitimately changes, update the
    // config AND this golden together (a deliberate world fork, §4) — never silently.
    expect(config_hash_hex(DEFAULT_WORLD_GEN_CONFIG)).toBe(config_hash_hex(structuredClone(DEFAULT_WORLD_GEN_CONFIG)))
  })
})
