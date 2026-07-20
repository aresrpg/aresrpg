// GLACIAL GENERATION shared stages — per-stage sensitivity + parity + the plan's oracles (§A crag/micro,
// §B.1 trough, §B.2 cirque, §B.3 glacier, §B.4 scree, §C snow-score). Every stage: ENABLING it changes the
// world deterministically; DISABLING it returns byte-for-byte to the DEFAULT column. Oracles are mostly
// pure-function tests (deterministic, no world hunting) plus a few integration probes over generate_column.
// The DEFAULT parity itself is held by gen/column_gen.test.js (terrain golden) + config_adoption.test.js.

import { test, expect, describe } from 'bun:test'

import { create_gen_context, generate_column, build_column_profile } from '../column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../config/world_gen_config.js'
import { get_block_by_name } from '../../config/block_registry.js'
import { column_index } from '../../chunks/format.js'
import { CHUNK_SIZE } from '../../config/world_config.js'

import { create_crag_context, crag_height_delta } from './crag.js'
import { create_trough_context, trough_carve } from './trough.js'
import { create_cirque_context, cirque_carve } from './cirque.js'
import { create_glacier_context, glacier_surface_block } from './glacier.js'
import { create_surface_context, surface_by_slope_block, scree_apron_delta } from './surface_by_slope.js'

const clone = () => structuredClone(DEFAULT_WORLD_GEN_CONFIG)
const SEEDS = { carvers: 0x1234_5678, decorators: 0x0bad_f00d }

/** Total id diff between two columns (same coords, two recipes). @param {any[]} a @param {any[]} b @returns {number} */
function column_diff(a, b) {
  let d = 0
  for (let cy = 0; cy < a.length; cy += 1)
    for (let i = 0; i < a[cy].ids.length; i += 1) if (a[cy].ids[i] !== b[cy].ids[i]) d += 1
  return d
}
/** Count a block id across a column. @param {any[]} col @param {number} id @returns {number} */
function count_block(col, id) {
  let n = 0
  for (const c of col) for (let i = 0; i < c.ids.length; i += 1) if (c.ids[i] === id) n += 1
  return n
}

// ── §A CRAG / GULLY + MICRO ─────────────────────────────────────────────────────────────────────
describe('GLACIAL §A · crag/micro spectrum repair', () => {
  test('disabled ⇒ zero delta (parity); enabled ⇒ relief-scaled crag + everywhere micro', () => {
    const off = create_crag_context({ enabled: false }, SEEDS)
    expect(crag_height_delta(off, 100, 100, 1)).toBe(0)
    const on = create_crag_context(
      { enabled: true, band_amp: 30, micro_amp: 2.5, relief_floor: 0.12, relief_gain: 0.5 },
      SEEDS
    )
    // Valley (relief 0): only the micro term rides (|delta| ≤ micro_amp). Crest (relief 1): crag dominates.
    let max_valley = 0
    let max_crest = 0
    for (let x = 0; x < 200; x += 7) {
      max_valley = Math.max(max_valley, Math.abs(crag_height_delta(on, x, 13, 0)))
      max_crest = Math.max(max_crest, Math.abs(crag_height_delta(on, x, 13, 1)))
    }
    expect(max_valley).toBeGreaterThan(0) // micro present everywhere (kills terrace furrows)
    expect(max_valley).toBeLessThanOrEqual(2.5 + 1e-6) // valley damped to micro only
    expect(max_crest).toBeGreaterThan(5) // crag jags the crests
  })

  test('LADDER: base/roll amp 0 ⇒ delta byte-parity with the pre-ladder stage (back-compat)', () => {
    const legacy_shape = { enabled: true, band_amp: 30, micro_amp: 2.5, relief_floor: 0.12, relief_gain: 0.5 }
    const legacy = create_crag_context(legacy_shape, SEEDS)
    const zeroed = create_crag_context(
      {
        ...legacy_shape,
        base_period: 250,
        base_octaves: 4,
        base_amp: 0,
        roll_period: 60,
        roll_octaves: 3,
        roll_amp: 0,
      },
      SEEDS
    )
    for (let x = 0; x < 300; x += 11)
      for (const relief of [0, 0.4, 1])
        expect(crag_height_delta(zeroed, x, -x, relief)).toBe(crag_height_delta(legacy, x, -x, relief))
  })

  test('LADDER: base + roll ride UNSCALED (present at relief 0 — the anti-boulder-on-plain terms)', () => {
    const net = create_crag_context({ enabled: true, band_amp: 0, micro_amp: 0, base_amp: 20 }, SEEDS)
    const drum = create_crag_context({ enabled: true, band_amp: 0, micro_amp: 0, roll_amp: 6 }, SEEDS)
    let max_net = 0
    let max_drum = 0
    for (let x = 0; x < 500; x += 7) {
      max_net = Math.max(max_net, Math.abs(crag_height_delta(net, x, 13, 0)))
      max_drum = Math.max(max_drum, Math.abs(crag_height_delta(drum, x, 13, 0)))
    }
    expect(max_net).toBeGreaterThan(5) // ridge network threads valley floors too
    expect(max_net).toBeLessThanOrEqual(20 + 1e-6)
    expect(max_drum).toBeGreaterThan(1.5) // drumlin roll present everywhere
    expect(max_drum).toBeLessThanOrEqual(6 + 1e-6)
  })

  test('LADDER: base_amp > 0 changes generated columns; base_amp 0 reproduces the band-only column', () => {
    const band_only = clone()
    band_only.crag = { ...band_only.crag, enabled: true, base_amp: 0, roll_amp: 0 }
    const with_net = structuredClone(band_only)
    with_net.crag = { ...with_net.crag, base_amp: 25 }
    const a = generate_column(create_gen_context(band_only), 30, -50)
    const b = generate_column(create_gen_context(with_net), 30, -50)
    expect(column_diff(a, b)).toBeGreaterThan(0) // the network genuinely moves terrain
    const a2 = generate_column(create_gen_context(structuredClone(band_only)), 30, -50)
    expect(column_diff(a, a2)).toBe(0) // deterministic + zero-amp terms inert
  })

  test('ORACLE: the DEFAULT ladder roughens the surface AND shortens terrace runs vs ladder-off (20°-ish strip)', () => {
    // Since the realism-baseline fork the ladder is ON in DEFAULT — the parity direction inverts:
    // `base` is the ladder-DISABLED world, `withc` is the ladder ON. This isolates the ladder's SPECTRUM
    // (base/roll/micro roughening), so flat-smooth (GEN_VERSION 12) is DISABLED here
    // (flat_hi:0) — (30,-50) is a low-relief column the live default now smooths; the flat-smooth gate is
    // proven separately (config_adoption re-bless + a local roughness probe: flats 0.412→0.227).
    const off_cfg = clone()
    off_cfg.crag = { ...off_cfg.crag, enabled: false }
    const on_cfg = clone()
    on_cfg.crag = { ...on_cfg.crag, flat_hi: 0 }
    const base = build_column_profile(create_gen_context(off_cfg), 30, -50)
    const withc = build_column_profile(create_gen_context(on_cfg), 30, -50)
    const run = (/** @type {Int16Array} */ h) => {
      // longest run of equal consecutive surface_y along z at x=16
      let best = 1,
        cur = 1
      for (let z = 1; z < CHUNK_SIZE; z += 1) {
        if (h[column_index(16, z)] === h[column_index(16, z - 1)]) {
          cur += 1
          best = Math.max(best, cur)
        } else cur = 1
      }
      return best
    }
    const variance = (/** @type {Int16Array} */ h) => {
      // adjacent |Δ| sum along z (roughness / spectral energy proxy)
      let s = 0
      for (let z = 1; z < CHUNK_SIZE; z += 1) s += Math.abs(h[column_index(16, z)] - h[column_index(16, z - 1)])
      return s
    }
    expect(variance(withc.surface_y)).toBeGreaterThan(variance(base.surface_y)) // more mid-freq energy (fills the hole)
    expect(run(withc.surface_y)).toBeLessThanOrEqual(12) // no terrace run > 12 cells with micro on
  })
})

// ── §B.1 TROUGH ─────────────────────────────────────────────────────────────────────────────────
describe('GLACIAL §B.1 · trough U-profile', () => {
  test('disabled ⇒ 0 carve (parity)', () => {
    expect(trough_carve(create_trough_context({ enabled: false }), 0)).toBe(0)
  })
  test('ORACLE: flat full-depth floor + monotone concave wall + 0 on ridges (U cross-section)', () => {
    const t = create_trough_context({ enabled: true, depth: 30, floor_pv: 0.06, wall_pv: 0.34 })
    expect(trough_carve(t, 0.0)).toBe(30)
    expect(trough_carve(t, 0.05)).toBe(30) // flat floor plateau (constant depth)
    expect(trough_carve(t, 0.4)).toBe(0) // ridge untouched
    let prev = 30
    for (let pv = 0.06; pv <= 0.34; pv += 0.02) {
      // wall: monotone non-increasing (steep U side)
      const d = trough_carve(t, pv)
      expect(d).toBeLessThanOrEqual(prev + 1e-9)
      prev = d
    }
    expect(trough_carve(t, 0.2)).toBeGreaterThan(0) // mid-wall carved (not a cliff step)
  })
})

// ── §B.2 CIRQUE ─────────────────────────────────────────────────────────────────────────────────
describe('GLACIAL §B.2 · cirque scoop', () => {
  test('disabled ⇒ 0 carve (parity)', () => {
    const qc = create_cirque_context({ enabled: false }, SEEDS)
    expect(cirque_carve(qc, 0, 0, () => 300)).toBe(0)
  })
  test('ORACLE: bowls carve high terrain (flat floor + steep headwall); altitude gate blocks lowland', () => {
    const cfg = {
      enabled: true,
      region_size: 200,
      region_rate: 1,
      per_region: 3,
      radius_min: 30,
      radius_max: 50,
      depth: 34,
      floor_ratio: 0.35,
      lip: 3,
      min_altitude: 180,
    }
    const high = create_cirque_context(cfg, SEEDS)
    let carved = 0
    let max_depth = 0
    for (let x = 0; x < 600; x += 4)
      for (let z = 0; z < 600; z += 4) {
        const d = cirque_carve(high, x, z, () => 250) // high probe everywhere ⇒ cirques placed
        if (d > 0) {
          carved += 1
          max_depth = Math.max(max_depth, d)
        }
      }
    expect(carved).toBeGreaterThan(0) // bowls exist
    expect(max_depth).toBeGreaterThan(20) // reach the flat-floor full depth somewhere
    // Altitude gate: same coords with a LOW terrain probe ⇒ no cirques placed anywhere.
    const low = create_cirque_context(cfg, SEEDS)
    let low_carved = 0
    for (let x = 0; x < 600; x += 8)
      for (let z = 0; z < 600; z += 8) if (cirque_carve(low, x, z, () => 120) > 0) low_carved += 1
    expect(low_carved).toBe(0)
  })
})

// ── §B.3 GLACIER RIBBON + MORAINES ──────────────────────────────────────────────────────────────
describe('GLACIAL §B.3 · glacier ribbon + moraines', () => {
  const ICE = /** @type {number} */ (get_block_by_name('ice')?.id)
  const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
  test('disabled ⇒ -1 (parity); enabled ⇒ ice on flat valley floor, moraine at centreline, gated elsewhere', () => {
    const off = create_glacier_context({ enabled: false })
    expect(glacier_surface_block(off, 200, 0.1, 0.1)).toBe(-1)
    const gc = create_glacier_context(
      {
        enabled: true,
        ice_low: 150,
        ice_high: 260,
        flat_gate: 0.35,
        valley_pv: 0.28,
        medial_pv: 0.05,
        lateral_band: 0.06,
        crevasse_period: 9,
        terminal_band: 12,
        firn_band: 24,
      },
      128
    )
    expect(glacier_surface_block(gc, 200, 0.1, 0.15)).toBeGreaterThanOrEqual(0) // flat valley floor in band ⇒ glacier surface
    expect(glacier_surface_block(gc, 200, 0.1, 0.02)).toBe(STONE) // medial moraine (pv ≤ medial_pv) = dark debris
    expect(glacier_surface_block(gc, 200, 0.9, 0.15)).toBe(-1) // too steep ⇒ not a floor
    expect(glacier_surface_block(gc, 200, 0.1, 0.5)).toBe(-1) // ridge (pv > valley_pv) ⇒ not a floor
    expect(glacier_surface_block(gc, 300, 0.1, 0.15)).toBe(-1) // above the ice band ⇒ not glacier
    expect(glacier_surface_block(gc, 120, 0.1, 0.15)).toBe(-1) // below sea level ⇒ land-ice only
  })
  test('ORACLE: enabling glows a glacier ribbon into the world (sentinel ice appears); disabled ⇒ none', () => {
    const on = clone()
    // Generous gate so the fixed-seed terrain has qualifying flat valley floors; unique ice sentinel.
    on.glacier = {
      ...on.glacier,
      enabled: true,
      ice_low: 130,
      ice_high: 320,
      flat_gate: 1.0,
      valley_pv: 0.5,
      ice_block: 'glowstone',
      firn_block: 'glowstone',
      crevasse_block: 'glowstone',
    }
    const GLOW = /** @type {number} */ (get_block_by_name('glowstone')?.id)
    const ctx = create_gen_context(on)
    let ice = 0
    for (const [cx, cz] of [
      [0, 0],
      [1, 1],
      [-1, -1],
      [2, -2],
      [-49, -49],
    ])
      ice += count_block(generate_column(ctx, cx, cz), GLOW)
    expect(ice).toBeGreaterThan(0)
    // DEFAULT never emits glowstone.
    const base = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)
    let none = 0
    for (const [cx, cz] of [
      [0, 0],
      [1, 1],
      [-1, -1],
      [2, -2],
      [-49, -49],
    ])
      none += count_block(generate_column(base, cx, cz), GLOW)
    expect(none).toBe(0)
    expect(ICE).toBeGreaterThanOrEqual(0)
  })
})

// ── §B.4 SCREE APRON ────────────────────────────────────────────────────────────────────────────
describe('GLACIAL §B.4 · scree apron mound', () => {
  test('0 when relief off / outside band (parity); peaks toward the cliff foot when on', () => {
    const off = create_surface_context({ scree_enabled: true, scree_relief: 0, grass_slope: 0.2, steep_slope: 0.7 })
    expect(scree_apron_delta(off, 0.4)).toBe(0)
    const on = create_surface_context({ scree_enabled: true, scree_relief: 6, grass_slope: 0.2, steep_slope: 0.7 })
    expect(scree_apron_delta(on, 0.1)).toBe(0) // below the scree band
    expect(scree_apron_delta(on, 0.9)).toBe(0) // above (bare cliff, no apron)
    expect(scree_apron_delta(on, 0.65)).toBeGreaterThan(scree_apron_delta(on, 0.3)) // grows toward cliff foot
  })
})

// ── §C SNOW-SCORE ───────────────────────────────────────────────────────────────────────────────
describe('GLACIAL §C · snow-score dressing', () => {
  const SNOW = /** @type {number} */ (get_block_by_name('snow')?.id)
  const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
  const base_ss = { slope_enabled: true, snow_enabled: false, snow_block: 'snow', rock_block: 'stone' }
  test('disabled ⇒ legacy hard threshold (parity path unchanged)', () => {
    const legacy = create_surface_context({ ...base_ss, snow_enabled: true, snow_line: 190, grass_slope: 0.2 })
    expect(legacy.snow_score.enabled).toBe(false)
    expect(surface_by_slope_block(legacy, 200, 0.1)).toBe(SNOW) // flat high ⇒ snow (hard threshold)
    expect(surface_by_slope_block(legacy, 100, 0.1)).toBe(-1) // below snow_line ⇒ biome
  })
  test('ORACLE: transition is a SPECKLE (both snow & rock in the mid band) vs a clean threshold band', () => {
    const cfg = {
      ...base_ss,
      snow_score: {
        enabled: true,
        band_low: 170,
        band_high: 240,
        slope_max: 0.9,
        speckle_period: 40,
        speckle_octaves: 4,
        speckle_amp: 0.7,
        threshold: 0.5,
      },
    }
    const sc = create_surface_context(cfg, 384, SEEDS)
    expect(sc.snow_score.enabled).toBe(true)
    // Below band_low ⇒ biome cover (four-band grammar: valley/biome first band).
    expect(surface_by_slope_block(sc, 150, 0.1, 0.5)).toBe(-1)
    // Mid-band, moderate slope: sweep the speckle input — BOTH snow and rock appear (salt-and-pepper).
    let snow = 0,
      rock = 0
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const b = surface_by_slope_block(sc, 205, 0.35, s)
      if (b === SNOW) snow += 1
      else if (b === STONE) rock += 1
    }
    expect(snow).toBeGreaterThan(0)
    expect(rock).toBeGreaterThan(0) // transition zone is mixed, not a paint-bucket band
    // High + flat ⇒ clean cap (snow wins across the speckle range); low speckle can't scour a summit.
    let cap_snow = 0
    for (let s = 0; s <= 1.0001; s += 0.1) if (surface_by_slope_block(sc, 300, 0.05, s) === SNOW) cap_snow += 1
    expect(cap_snow).toBeGreaterThan(6) // summit stays overwhelmingly snow
  })
})

// ── ALL-STAGES-ON TEST WORLD (the plan's smoke blob) ────────────────────────────────────────────
describe('GLACIAL · all stages ON (test world) generate + differ from DEFAULT; each disabled ⇒ parity', () => {
  /** A TEST recipe (smoke-only, never shipped) exercising every glacial stage at once. */
  const ALL_ON = (() => {
    const c = clone()
    c.crag = { ...c.crag, enabled: true }
    c.trough = { ...c.trough, enabled: true }
    c.cirque = { ...c.cirque, enabled: true, region_rate: 1, min_altitude: 150 }
    c.glacier = { ...c.glacier, enabled: true, flat_gate: 1.0, valley_pv: 0.5, ice_low: 130, ice_high: 320 }
    c.surface = {
      ...c.surface,
      slope_enabled: true,
      scree_enabled: true,
      scree_relief: 4,
      snow_score: { ...c.surface.snow_score, enabled: true },
    }
    return c
  })()
  const CHECK = [
    [0, 0],
    [1, 1],
    [-1, -1],
    [2, -2],
    [-49, -49],
  ]

  test('the all-on world generates without error and DIFFERS from DEFAULT', () => {
    const ctx = create_gen_context(ALL_ON)
    const base = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)
    let total = 0
    for (const [cx, cz] of CHECK) total += column_diff(generate_column(base, cx, cz), generate_column(ctx, cx, cz))
    expect(total).toBeGreaterThan(0)
  })

  test('deterministic — the all-on recipe reproduces the same column', () => {
    const a = generate_column(create_gen_context(ALL_ON), -49, -49)
    const b = generate_column(create_gen_context(ALL_ON), -49, -49)
    expect(column_diff(a, b)).toBe(0)
  })

  // trough/cirque/glacier stay OFF in DEFAULT ⇒ disabling them is a no-op. crag is the exception since
  // the realism-baseline fork (GEN_VERSION 7): the ladder is ON by default and LOAD-BEARING.
  for (const key of ['trough', 'cirque', 'glacier']) {
    test(`disabling ${key} alone from DEFAULT is byte-identical to DEFAULT`, () => {
      const off = clone()
      off[key] = { ...off[key], enabled: false }
      const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), -49, -49)
      expect(column_diff(base, generate_column(create_gen_context(off), -49, -49))).toBe(0)
    })
  }

  test('the DEFAULT relief ladder is ON and load-bearing (disabling crag CHANGES the world)', () => {
    expect(DEFAULT_WORLD_GEN_CONFIG.crag.enabled).toBe(true)
    expect(DEFAULT_WORLD_GEN_CONFIG.crag.micro_amp).toBeGreaterThanOrEqual(2) // the anti-flat guarantee
    expect(DEFAULT_WORLD_GEN_CONFIG.crag.relief_floor).toBe(0)
    const off = clone()
    off.crag = { ...off.crag, enabled: false }
    const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), -49, -49)
    expect(column_diff(base, generate_column(create_gen_context(off), -49, -49))).toBeGreaterThan(0)
  })
})
