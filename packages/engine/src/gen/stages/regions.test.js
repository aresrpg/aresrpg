// S-25 SUB-BIOME REGION LAYER — the "world-as-planet" region field is a REAL, isolated, deterministic
// lever: enabling it on a massif world changes the generated columns (terrain + biome + palette), disabling
// it returns to the massif-only world byte-for-byte, and the same recipe reproduces the same world. Also
// proves the pattern-setter's INVARIANTS: identity-when-off, blended-params-stay-in-range, biome pins drive
// the column biome, intra-region variance differentiates same-class patches, and the OTHER four recipes are
// byte-unchanged (they carry no `regions` block).

import { createHash } from 'node:crypto'

import { test, expect, describe, afterAll } from 'bun:test'

import { create_gen_context, generate_column, biome_at, anchor_surface } from '../column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../config/world_gen_config.js'
import { EVEREST_WORLD } from '../../config/worlds/everest.js'
import { WORLD_CONFIGS, WORLD_NAMES } from '../../config/worlds/index.js'
import { set_gen_config } from '../world_gen.js'
import { CHUNKS_PER_COLUMN } from '../../config/world_config.js'

import { create_region_context, region_profile, IDENTITY_PROFILE } from './regions.js'

afterAll(() => set_gen_config(DEFAULT_WORLD_GEN_CONFIG))

/** Total id diff between two columns (same coords, two recipes). */
function column_diff(a, b) {
  let d = 0
  for (let cy = 0; cy < a.length; cy += 1)
    for (let i = 0; i < a[cy].ids.length; i += 1) if (a[cy].ids[i] !== b[cy].ids[i]) d += 1
  return d
}

/** sha256 over the ids of a full column (surface-identity fingerprint). */
function column_hash(col) {
  const h = createHash('sha256')
  for (const c of col) h.update(new Uint8Array(c.ids.buffer))
  return h.digest('hex')
}

const GRID = [
  [0, 0],
  [4, -3],
  [-6, 5],
  [9, 9],
  [-11, -2],
  [2, 13],
  [-14, 8],
  [7, -12],
  [15, 15],
  [-9, -15],
]

describe('S-25+ region-driven terrain on the CLASSIC spline path (drives_terrain gate)', () => {
  // A spline-path world (massif OFF, like every non-Everest world) with a region block. The gate:
  // biome-pin-only / knob-free regions ⇒ drives_terrain false ⇒ the spline path is byte-identical to legacy;
  // adding a terrain knob ⇒ drives_terrain true ⇒ the region field MOVES the surface (regions drive
  // terrain per world). No biome pins here so the ONLY variable is the terrain modulation itself.
  const SEED = 'spline-region-parity'
  const spline = { ...DEFAULT_WORLD_GEN_CONFIG, seed: SEED } // massif off ⇒ the classic spline raw_land
  const region_no_knobs = {
    enabled: true,
    field: { period: 800, octaves: 2 },
    blend: 0.05,
    classes: [
      { name: 'lo', upto: 0.5 },
      { name: 'hi', upto: 1.01 },
    ], // no pins, no terrain knobs
  }
  const region_knobs = {
    ...region_no_knobs,
    classes: [
      { name: 'lo', upto: 0.5, relief_scale: 0.3, height_bias: -20 }, // flatten + sink
      { name: 'hi', upto: 1.01, relief_scale: 1.8, height_bias: 20 }, // amplify + raise
    ],
  }

  test('drives_terrain is FALSE for knob-free regions, TRUE once any class (or variance) carries a terrain knob', () => {
    expect(create_region_context(region_no_knobs, [], SEED).drives_terrain).toBe(false)
    expect(create_region_context(region_knobs, [], SEED).drives_terrain).toBe(true)
    expect(
      create_region_context({ ...region_no_knobs, variance: { period: 200, bias: 4 } }, [], SEED).drives_terrain
    ).toBe(true)
    expect(create_region_context(undefined, [], SEED).drives_terrain).toBe(false) // disabled ⇒ false
  })

  test('PARITY — a knob-free region on a spline world is byte-identical to regions ABSENT (legacy path untouched)', () => {
    const absent = create_gen_context(spline)
    const knobfree = create_gen_context({ ...spline, regions: region_no_knobs })
    for (const [cx, cz] of GRID)
      expect(column_hash(generate_column(knobfree, cx, cz))).toBe(column_hash(generate_column(absent, cx, cz)))
  })

  test('SENSITIVITY — adding terrain knobs MOVES the surface on the spline path (regions drive terrain)', () => {
    const knobfree = create_gen_context({ ...spline, regions: region_no_knobs })
    const knobbed = create_gen_context({ ...spline, regions: region_knobs })
    let total = 0
    for (const [cx, cz] of GRID)
      total += column_diff(generate_column(knobfree, cx, cz), generate_column(knobbed, cx, cz))
    expect(total).toBeGreaterThan(0) // the region field genuinely reshapes the classic-spline surface
  })
})

describe('S-25 region layer — unit (region_profile)', () => {
  test('absent / disabled config ⇒ IDENTITY profile (massif byte-parity)', () => {
    expect(create_region_context(undefined, [], 'seed').enabled).toBe(false)
    expect(region_profile(create_region_context(undefined, [], 'seed'), 100, 200)).toBe(IDENTITY_PROFILE)
    expect(region_profile(create_region_context({ enabled: false }, [], 'seed'), 100, 200)).toBe(IDENTITY_PROFILE)
    // enabled:true but no classes ⇒ still disabled (nothing to partition).
    expect(create_region_context({ enabled: true, classes: [] }, [], 'seed').enabled).toBe(false)
  })

  test('blended params stay within the class range; biome pin resolves from the world table', () => {
    const biomes = [
      { id: 7, name: 'taiga' },
      { id: 9, name: 'glacier' },
      { id: 13, name: 'alpine' },
    ]
    const cfg = {
      enabled: true,
      field: { period: 400, octaves: 2 },
      blend: 0.06,
      variance: { period: 120, relief: 0.1, rough: 0.1, bias: 4, ice: 10 },
      classes: [
        {
          name: 'glacier',
          upto: 0.34,
          biome: 'glacier',
          relief_scale: 0.4,
          roughness_scale: 0.5,
          ice_line_delta: -200,
        },
        { name: 'taiga', upto: 0.67, biome: 'taiga', relief_scale: 0.8, roughness_scale: 1.0, ice_line_delta: 0 },
        { name: 'peaks', upto: 1.01, biome: 'alpine', relief_scale: 1.0, roughness_scale: 1.4, ice_line_delta: 20 },
      ],
    }
    const rc = create_region_context(cfg, biomes, 'khumbu')
    const pins = new Set([7, 9, 13])
    let saw_intermediate = false
    for (let x = -600; x <= 600; x += 7) {
      for (let z = -600; z <= 600; z += 53) {
        const p = region_profile(rc, x, z)
        // relief within [min class × (1-variance), max class × (1+variance)] — a generous envelope.
        expect(p.relief_scale).toBeGreaterThan(0.3)
        expect(p.relief_scale).toBeLessThan(1.2)
        expect(pins.has(p.biome_id)).toBe(true)
        // a blended (non-endpoint) relief_scale proves the cross-fade runs somewhere.
        if (p.relief_scale > 0.45 && p.relief_scale < 0.78) saw_intermediate = true
      }
    }
    expect(saw_intermediate).toBe(true) // cross-fade produces intermediate terrain params at borders
  })

  test('deterministic — same recipe ⇒ same profile at the same coords', () => {
    const biomes = [
      { id: 7, name: 'taiga' },
      { id: 9, name: 'glacier' },
    ]
    const cfg = {
      enabled: true,
      field: { period: 500, octaves: 2 },
      blend: 0.05,
      classes: [
        { name: 'glacier', upto: 0.5, biome: 'glacier', relief_scale: 0.4 },
        { name: 'taiga', upto: 1.01, biome: 'taiga', relief_scale: 0.9 },
      ],
    }
    const a = create_region_context(cfg, biomes, 'khumbu')
    const b = create_region_context(cfg, biomes, 'khumbu')
    for (const [x, z] of [
      [10, 20],
      [333, -77],
      [-1000, 900],
    ]) {
      expect(region_profile(a, x, z)).toEqual(region_profile(b, x, z))
    }
  })

  test('intra-region VARIANCE differentiates same-class patches (no two locations the same)', () => {
    const biomes = [{ id: 7, name: 'taiga' }]
    // one class covering ALL of r ⇒ every column is "taiga"; only variance can differentiate them.
    const cfg = {
      enabled: true,
      field: { period: 800, octaves: 2 },
      variance: { period: 90, relief: 0.25, rough: 0.25, bias: 8, ice: 20 },
      classes: [{ name: 'taiga', upto: 1.01, biome: 'taiga', relief_scale: 0.8, roughness_scale: 1.0 }],
    }
    const rc = create_region_context(cfg, biomes, 'khumbu')
    const vals = new Set()
    for (let x = 0; x < 800; x += 40) vals.add(region_profile(rc, x, 0).relief_scale.toFixed(4))
    expect(vals.size).toBeGreaterThan(8) // same class, many distinct relief values ⇒ variance is live
  })
})

describe('S-25 region layer — integration (massif world)', () => {
  test('SENSITIVITY — enabling regions changes the everest world', () => {
    const on = create_gen_context(EVEREST_WORLD)
    const off_cfg = { ...structuredClone(EVEREST_WORLD), regions: { ...EVEREST_WORLD.regions, enabled: false } }
    const off = create_gen_context(off_cfg)
    let total = 0
    for (const [cx, cz] of GRID) total += column_diff(generate_column(on, cx, cz), generate_column(off, cx, cz))
    expect(total).toBeGreaterThan(0) // the region layer genuinely moves blocks
  })

  test('PARITY — regions.enabled:false ≡ regions absent (both take the massif-only legacy path)', () => {
    const disabled = { ...structuredClone(EVEREST_WORLD), regions: { ...EVEREST_WORLD.regions, enabled: false } }
    const absent = structuredClone(EVEREST_WORLD)
    delete absent.regions
    const a = create_gen_context(disabled)
    const b = create_gen_context(absent)
    for (const [cx, cz] of GRID)
      expect(column_hash(generate_column(a, cx, cz))).toBe(column_hash(generate_column(b, cx, cz)))
  })

  test('BIOME PINS drive the column biome; the world shows MULTIPLE regions (variety)', () => {
    const ctx = create_gen_context(EVEREST_WORLD)
    // Every everest region class pins a biome ⇒ every column's biome ∈ the pinned set.
    const pinned = new Set(
      EVEREST_WORLD.regions.classes.map((c) => EVEREST_WORLD.biomes.find((b) => b.name === c.biome)?.id)
    )
    const seen = new Set()
    // biome_at is the region-pinned dominant biome (cheap — no column fill); scan a WIDE span so the
    // low-freq region field crosses several bands (a small near-origin grid sits in a single region).
    for (let x = -3200; x <= 3200; x += 160) {
      for (let z = -3200; z <= 3200; z += 320) seen.add(biome_at(ctx, x, z))
    }
    for (const id of seen) expect(pinned.has(id)).toBe(true) // every observed biome is a pinned region biome
    expect(seen.size).toBeGreaterThanOrEqual(4) // 4+ distinct region biomes ⇒ a varied world, not one massif
  })

  test('TERRAIN VARIETY — region surface heights span a wide range (peaks tower over basins)', () => {
    const ctx = create_gen_context(EVEREST_WORLD)
    // anchor_surface is the decorator's per-column surface probe (region-modulated, no fill). A wide sparse
    // scan measures the height envelope: flattened glacier/wasteland basins vs the full-relief peaks.
    let lo = Infinity
    let hi = -Infinity
    for (let x = -3200; x <= 3200; x += 128) {
      for (let z = -3200; z <= 3200; z += 256) {
        const y = anchor_surface(ctx, x, z).surface_y
        if (y < lo) lo = y
        if (y > hi) hi = y
      }
    }
    expect(hi - lo).toBeGreaterThan(150) // dramatic peaks vs flat basins — the "lot of terrain variety" bar
  })
})

describe('S-25 region layer — NO DRIFT for the UNTOUCHED recipes', () => {
  // S-25 fan-out (every world a multi-biome planet): the region layer now rides FOUR
  // recipes — everest (massif world: pins biome + MODULATES terrain) and the three release worlds paradise/
  // rainforest/ember_steppe (classic-spline worlds: the region BIOME PIN executes on the spline path too —
  // column_gen line ~360 runs whenever regions.enabled, independent of massif — while the region TERRAIN
  // knobs stay inert, only massif_surface reads them). The UNTOUCHED recipes are everglades + DEFAULT: they
  // carry NEITHER a regions block NOR a massif, so no S-25 code path runs ⇒ byte-identical (DEFAULT byte-
  // parity itself is held by gen/config_adoption.test.js GOLDEN_DECORATED).
  // The 04/05/06 fan-out (mistral_heights / drowned_fen / pandora_reach) rides the same spline-path pin.
  const REGION_WORLDS = new Set([
    'everest',
    'paradise',
    'rainforest',
    'ember_steppe',
    'mistral_heights',
    'drowned_fen',
    'pandora_reach',
    'charnel_marches',
    'cinderforge_depths',
    'palewood',
    'coral_throne',
    'sunspire_dunes',
    'rootheart',
    'static_fields',
    'mirrormere',
    'silent_atoll',
    'the_sundering',
    'obsidian_choir',
    'abyssal_weald',
    'hollow_crown',
    'zenith_scar',
  ])

  test('the untouched recipes (everglades + DEFAULT) carry no regions block AND no enabled massif', () => {
    for (const name of WORLD_NAMES) {
      if (REGION_WORLDS.has(name)) continue
      const w = WORLD_CONFIGS[name]
      expect(w.regions, `${name} has no regions block`).toBeUndefined()
      expect(w.massif?.enabled ?? false, `${name} massif is off`).toBe(false)
    }
    expect(DEFAULT_WORLD_GEN_CONFIG.regions, 'DEFAULT has no regions block').toBeUndefined()
    expect(DEFAULT_WORLD_GEN_CONFIG.massif.enabled, 'DEFAULT massif is off').toBe(false)
  })

  test('every region world carries an enabled regions block with a non-empty class list', () => {
    for (const name of REGION_WORLDS) {
      const w = WORLD_CONFIGS[name]
      expect(w.regions?.enabled, `${name} regions enabled`).toBe(true)
      expect(w.regions.classes.length, `${name} has classes`).toBeGreaterThanOrEqual(5)
    }
  })
})
