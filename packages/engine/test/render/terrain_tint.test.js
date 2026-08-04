// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math unit tests for NG-TINT (terrain_tint.js) — no GPU, no TSL evaluation. TSL nodes can't be
// evaluated headlessly, so this file mirrors the shader's FIELD math (value/climate/dirt/roughness) in
// plain JS off the exported NG_TINT / TERRAIN_PBR constants + tint_class_of / base_roughness_of (the
// source of truth), and uses a representative deterministic hash for the lattice (the shader's PCG
// hash() can't be replicated in JS — see lattice_hash). The PROPERTIES the design directives require —
// world-space purity, cross-chunk AND cross-face continuity, subtle (Veloren-class) amplitude bounds,
// per-family amplitude spread, a metalness LOCK at 0, and the roughness table + humid-dew dip — are all
// hash-agnostic, so they're proven regardless of the exact hash. Same pattern terrain_material.test.js
// uses for the winding math.

import { test, expect, describe } from 'bun:test'

import { BLOCK_REGISTRY, get_block_by_name } from '../../src/config/block_registry.js'
import {
  NG_TINT,
  TERRAIN_PBR,
  tint_class_of,
  base_roughness_of,
  STRAW_TIP,
  straw_tip_ratio,
  GRASS_GRADIENT_LEVELS,
  resolve_grass_gradient_level,
} from '../../src/render/terrain_tint.js'

// ── SHADER-MIRRORED MATH (op-for-op with terrain_tint.js) ───────────────────────────────────────────

// Per-octave u32 salt — MUST equal terrain_tint.js TINT_SALT (that const is module-private, so it is
// duplicated here; the amplitude/continuity tests don't depend on the exact salt values, only that the
// octaves are decorrelated, which any distinct set gives). Indices 2/3 back the dedicated macro-gradient
// octave (P_MACRO_A/B) — a missing entry here silently hashed to a CONSTANT field (undefined >>> 0 === 0
// coerces every lattice index to the same value), which is exactly the bug that produced a zero-spread
// macro_value_mul across every sample point before this array grew to match the source's 4 entries.
const TINT_SALT = [0x9e3779b1 >>> 0, 0x85ebca77 >>> 0, 0xc2b2ae3d >>> 0, 0x27d4eb2f >>> 0]

/** A deterministic u32 hash → [0,1) used as the test ORACLE for the lattice. NOTE: the shader now uses
 * three's PCG `hash()` node (its exact output can't be replicated in JS), so this is NOT bit-identical
 * to the shader — it's a representative deterministic hash. That is sufficient: the properties under
 * test (PURITY = same input→same output; CONTINUITY = small delta across a border via the smoothstep
 * interp; BOUNDS = amplitudes) are hash-AGNOSTIC — they hold for any deterministic [0,1) hash folded
 * through the same lerp/smoothstep structure. Same primes/salt as the shader for representativeness.
 * @param {number} ix @param {number} iz @param {number} salt */
function lattice_hash(ix, iz, salt) {
  const a = (Math.imul(ix >>> 0, 374761393) + Math.imul(iz >>> 0, 668265263) + TINT_SALT[salt]) >>> 0
  const b = Math.imul((a ^ (a >>> 16)) >>> 0, 0x7feb352d) >>> 0
  let c = Math.imul((b ^ (b >>> 15)) >>> 0, 0x846ca68b) >>> 0
  c = (c ^ (c >>> 16)) >>> 0
  return c / 4294967296
}

/** smoothstep(0,1,t) — clamped 3t²−2t³, mirrors the TSL smoothstep(float(0),float(1),·). @param {number} t */
function smoothstep01(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * (3 - 2 * c)
}

const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t

/** 2-D value noise in [0,1), smoothstep-interpolated over the integer lattice. Mirrors tint_noise:
 * px,pz are worldXZ ALREADY divided by the octave period. @param {number} px @param {number} pz @param {number} salt */
function tint_noise(px, pz, salt) {
  const x0 = Math.floor(px)
  const z0 = Math.floor(pz)
  const ux = smoothstep01(px - x0)
  const uz = smoothstep01(pz - z0)
  const h = (/** @type {number} */ x, /** @type {number} */ z) => lattice_hash(x, z, salt)
  return lerp(lerp(h(x0, z0), h(x0 + 1, z0), ux), lerp(h(x0, z0 + 1), h(x0 + 1, z0 + 1), ux), uz)
}

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  v < lo ? lo : v > hi ? hi : v

/**
 * Full macro-field sample at a world XZ for one block class — mirrors macro_tint_nodes' albedo + value
 * math (chromatic climate on grassy, ±value, dirty-patch blend, the dedicated macro-gradient octave) and
 * returns everything the property tests assert. `tint_class` is 0/1/2/3 (from tint_class_of);
 * `base_rough` is the family roughness. `grad` mirrors the 2026-07-12 `?grassgrad=` ladder — DEFAULT
 * {val:0,hue:0} = level 'a' (the dedicated octave OFF), byte-identical to every pre-existing call site
 * below (none of them pass `grad`). The vfield/climate terms just below are grad-INDEPENDENT (always
 * their shipped baseline — see terrain_tint.js's "structural fix" comment); `grad` only reaches the
 * macro_value_mul/macro_climate block further down.
 * @param {number} wx @param {number} wz @param {number} tint_class @param {number} base_rough @param {boolean} is_sand
 * @param {{val: number, hue: number}} [grad]
 */
function macro_sample(wx, wz, tint_class, base_rough, is_sand, grad = { val: 0, hue: 0 }) {
  const moisture = tint_noise(wx / NG_TINT.P_BIG, wz / NG_TINT.P_BIG, 0)
  const detail = tint_noise(wx / NG_TINT.P_SMALL, wz / NG_TINT.P_SMALL, 1)
  const m = moisture * 2 - 1
  const d = detail * 2 - 1
  const is_grassy = tint_class >= 2
  const grassy_amt = is_grassy ? 1 : 0

  // value multiplier (grad-independent baseline)
  const vfield = clamp(m * -0.6 + d * 0.4, -1, 1)
  const val_amp = is_grassy ? NG_TINT.VAL_GRASS : tint_class === 1 ? NG_TINT.VAL_MINERAL : 0
  const value_mul = 1 + val_amp * vfield

  // climate chroma (grassy only), per channel, centered at 1 (grad-independent baseline)
  const climate = [
    1 + NG_TINT.K[0] * m * grassy_amt,
    1 + NG_TINT.K[1] * m * grassy_amt,
    1 + NG_TINT.K[2] * m * grassy_amt,
  ]

  // (e) DEDICATED MACRO-GRADIENT octave — mirrors terrain_tint.js's `macro_on` branch exactly. Two
  // longer-period octaves (P_MACRO_A/B, salts 2/3) combined into gfield ∈ (−1,1), applied UNDILUTED
  // (outside the vfield/climate mix above) so `grad` is a live lever instead of the dead one it used to
  // scale. OFF (grad both 0, level 'a') skips the extra noise samples entirely, matching the shader.
  let macro_value_mul = 1
  let macro_climate = [1, 1, 1]
  if (grad.val > 0 || grad.hue > 0) {
    const macro_a = tint_noise(wx / NG_TINT.P_MACRO_A, wz / NG_TINT.P_MACRO_A, 2)
    const macro_b = tint_noise(wx / NG_TINT.P_MACRO_B, wz / NG_TINT.P_MACRO_B, 3)
    const gfield = macro_a + macro_b - 1 // ((macro_a·2−1)+(macro_b·2−1))/2 simplified
    const macro_val_amp = NG_TINT.MACRO_VAL * grad.val
    macro_value_mul = 1 + macro_val_amp * gfield * grassy_amt
    macro_climate = NG_TINT.MACRO_K.map((k) => 1 + k * grad.hue * gfield * grassy_amt)
  }

  // humid turf (grass-ground / class 3 only) — dark rich green pull where moisture is high; the SAME
  // factor gates the dirty-patch mottle out (mirrors macro_tint_nodes' (d) term)
  const turf =
    smoothstep01((moisture - NG_TINT.TURF_LO) / (NG_TINT.TURF_HI - NG_TINT.TURF_LO)) * (tint_class === 3 ? 1 : 0)
  const turf_mul = /** @type {[number,number,number]} */ (NG_TINT.TURF_RGB.map((t) => lerp(1, t, turf)))

  // dirty patch (grass-ground / class 3 only), gated out on humid turf
  const dirt_blend =
    smoothstep01((detail - NG_TINT.DIRT_LO) / (NG_TINT.DIRT_HI - NG_TINT.DIRT_LO)) *
    NG_TINT.DIRT_MAX *
    (tint_class === 3 ? 1 : 0) *
    (1 - turf)

  // roughness field
  let rough = base_rough
  if (is_grassy) rough = base_rough - m * TERRAIN_PBR.humid_dip
  else if (is_sand) rough = base_rough + d * TERRAIN_PBR.sand_ripple
  rough = clamp(rough, TERRAIN_PBR.min, 1)

  return {
    moisture,
    detail,
    m,
    d,
    value_mul,
    climate,
    macro_value_mul,
    macro_climate,
    turf,
    turf_mul,
    dirt_blend,
    rough,
  }
}

/** Applies the tint to a base albedo, mirroring
 * mix(albedo·value_mul·macro_value_mul·climate·macro_climate·turf_mul, DIRT_RGB, dirt_blend).
 * @param {[number,number,number]} albedo @param {ReturnType<typeof macro_sample>} s @returns {[number,number,number]} */
function apply_tint(albedo, s) {
  const tinted = /** @type {[number,number,number]} */ (
    albedo.map((c, i) => c * s.value_mul * s.macro_value_mul * s.climate[i] * s.macro_climate[i] * s.turf_mul[i])
  )
  return /** @type {[number,number,number]} */ (tinted.map((c, i) => lerp(c, NG_TINT.DIRT_RGB[i], s.dirt_blend)))
}

// A dense, deterministic set of world positions spanning far-from-origin coords (f32-exactness matters
// for the lattice index). Kept off exact integers so the interpolation fraction is exercised.
const SAMPLE_XZ = /** @type {[number,number][]} */ ([])
for (let i = 0; i < 40; i += 1) {
  const wx = -5000 + i * 317.3 + 0.37
  const wz = 12000 - i * 211.7 + 0.91
  SAMPLE_XZ.push([wx, wz])
}

const GRASS_CLASS = tint_class_of(/** @type {*} */ (get_block_by_name('grass')))
const GRASS_ROUGH = base_roughness_of(/** @type {*} */ (get_block_by_name('grass')))
const SAND_ROUGH = base_roughness_of(/** @type {*} */ (get_block_by_name('sand')))
const DIRT_CLASS = tint_class_of(/** @type {*} */ (get_block_by_name('dirt')))
const DIRT_ROUGH = base_roughness_of(/** @type {*} */ (get_block_by_name('dirt')))

// ── PURITY (same world pos ⇒ same tint) ─────────────────────────────────────────────────────────────
describe('NG-TINT purity — determinism from world position', () => {
  test('same (wx,wz) → byte-identical field (no hidden state, pure function of position)', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const a = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      const b = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      expect(a).toEqual(b)
    }
  })

  test('the field DOES vary across space (not a constant) — real macro patches exist', () => {
    const vals = SAMPLE_XZ.map(([wx, wz]) => macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false).moisture)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    expect(max - min).toBeGreaterThan(0.3) // spans a meaningful chunk of [0,1]
  })

  test('lattice hash fills [0,1) without collapsing (avalanche is live, no f32 banding far from origin)', () => {
    const seen = new Set()
    for (let ix = 1_000_000; ix < 1_000_040; ix += 1) seen.add(Math.round(lattice_hash(ix, 7, 0) * 1e6))
    expect(seen.size).toBeGreaterThan(35) // ~all distinct → no exact-int overflow banding
  })
})

// ── CONTINUITY (cross-chunk-border AND cross-face) ──────────────────────────────────────────────────
describe('NG-TINT continuity — seamless across chunk borders and face orientations', () => {
  // The field has NO chunk term (samples worldXZ directly) and is smoothstep-interpolated ⇒ C1. A
  // 32-block chunk boundary is just another world coord; sampling either side of x=32 must be ~equal.
  test('cross-chunk-border: field is continuous at x=31.9 vs 32.1 (delta < eps)', () => {
    const eps = 0.02 // the field moves at most ~this over a 0.2 m step (period ≥ 13 blocks)
    for (let wz = -80; wz <= 80; wz += 7.3) {
      for (const bx of [32, 64, 96, -32, -64]) {
        const lo = macro_sample(bx - 0.1, wz, GRASS_CLASS, GRASS_ROUGH, false)
        const hi = macro_sample(bx + 0.1, wz, GRASS_CLASS, GRASS_ROUGH, false)
        expect(Math.abs(hi.value_mul - lo.value_mul)).toBeLessThan(eps)
        expect(Math.abs(hi.rough - lo.rough)).toBeLessThan(eps)
        for (let c = 0; c < 3; c += 1) expect(Math.abs(hi.climate[c] - lo.climate[c])).toBeLessThan(eps)
      }
    }
  })

  test('cross-face: a top edge and its +z/+x rim share XZ ⇒ identical tint (silhouette dissolves)', () => {
    // A block at column (bx,bz): its TOP plane's far-z EDGE is at z=bz+1 over x∈[bx,bx+1]; its +z side
    // (after positive_push) sits at EXACTLY z=bz+1 over the SAME x range. The material feeds both the
    // SAME positionWorld, and the field is a pure fn of XZ ⇒ rim == top-edge (exact). And approaching
    // the edge from the top interior converges to the rim value (no seam) since the field is C1.
    for (const bx of [3, 40, -17]) {
      for (const bz of [5, -9, 128]) {
        const x = bx + 0.5
        const top_edge = macro_sample(x, bz + 1, GRASS_CLASS, GRASS_ROUGH, false)
        const pz_rim = macro_sample(x, bz + 1, GRASS_CLASS, GRASS_ROUGH, false) // rim shares the edge XZ
        expect(pz_rim).toEqual(top_edge) // exact: same world XZ ⇒ same tint (the dissolve guarantee)
        const top_interior = macro_sample(x, bz + 0.99, GRASS_CLASS, GRASS_ROUGH, false) // 1 cm inside
        expect(Math.abs(top_interior.value_mul - top_edge.value_mul)).toBeLessThan(1e-2) // no visible seam
        expect(Math.abs(top_interior.rough - top_edge.rough)).toBeLessThan(1e-2)
      }
    }
  })

  test('C1: no discontinuity at any integer lattice crossing (step across floor() is small)', () => {
    const period = NG_TINT.P_SMALL // tightest period → worst case
    for (let k = -3; k <= 3; k += 1) {
      const boundary = k * period // where floor(px) increments
      const lo = tint_noise((boundary - 1e-3) / period, 0.5, 1)
      const hi = tint_noise((boundary + 1e-3) / period, 0.5, 1)
      expect(Math.abs(hi - lo)).toBeLessThan(1e-3) // smoothstep endpoints have zero slope ⇒ tiny step
    }
  })
})

// ── AMPLITUDE BOUNDS (subtle, Veloren-class — not a rainbow) ─────────────────────────────────────────
describe('NG-TINT amplitude bounds — subtle by construction', () => {
  test('grass value multiplier stays within ±VAL_GRASS of 1 (≤8%)', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const { value_mul } = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      expect(value_mul).toBeGreaterThanOrEqual(1 - NG_TINT.VAL_GRASS - 1e-9)
      expect(value_mul).toBeLessThanOrEqual(1 + NG_TINT.VAL_GRASS + 1e-9)
    }
  })

  test('mineral value multiplier stays within ±VAL_MINERAL of 1 (≤4%) and < grass swing', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const { value_mul } = macro_sample(wx, wz, 1, DIRT_ROUGH, false) // class 1 = mineral
      expect(value_mul).toBeGreaterThanOrEqual(1 - NG_TINT.VAL_MINERAL - 1e-9)
      expect(value_mul).toBeLessThanOrEqual(1 + NG_TINT.VAL_MINERAL + 1e-9)
    }
    expect(NG_TINT.VAL_MINERAL).toBeLessThan(NG_TINT.VAL_GRASS) // mineral moves less than grass
  })

  test('climate chroma per-channel deviation from 1 is bounded by |K| (subtle hue)', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const { climate } = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      for (let c = 0; c < 3; c += 1) {
        expect(Math.abs(climate[c] - 1)).toBeLessThanOrEqual(Math.abs(NG_TINT.K[c]) + 1e-9)
      }
    }
    // subtle: every channel gain magnitude ≤ 10% (Veloren, not rainbow)
    for (const k of NG_TINT.K) expect(Math.abs(k)).toBeLessThanOrEqual(0.1)
  })

  test('WOOD macro-tint table stays subtle: VAL_WOOD in (mineral, grass], K_WOOD ≤ 5% (2026-07-03)', () => {
    // Wood (log) gets a slightly stronger value swing than plain mineral so a giant trunk gets tonal
    // variation across its height, plus a tiny warm↔cool hue drift — but bounded so it never reads
    // rainbow. Guards the exported table (id-branch applied in macro_tint_nodes; class-mirror-agnostic).
    expect(NG_TINT.VAL_WOOD).toBeGreaterThan(NG_TINT.VAL_MINERAL)
    expect(NG_TINT.VAL_WOOD).toBeLessThanOrEqual(NG_TINT.VAL_GRASS)
    for (const k of NG_TINT.K_WOOD) expect(Math.abs(k)).toBeLessThanOrEqual(0.05)
  })

  test('dirty-patch blend never exceeds DIRT_MAX and is 0 for non-grass-ground classes', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const grass = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      expect(grass.dirt_blend).toBeGreaterThanOrEqual(0)
      expect(grass.dirt_blend).toBeLessThanOrEqual(NG_TINT.DIRT_MAX + 1e-9)
      // canopy (class 2) + mineral (1) + none (0) get NO dirt blend
      expect(macro_sample(wx, wz, 2, GRASS_ROUGH, false).dirt_blend).toBe(0)
      expect(macro_sample(wx, wz, 1, DIRT_ROUGH, false).dirt_blend).toBe(0)
      expect(macro_sample(wx, wz, 0, DIRT_ROUGH, false).dirt_blend).toBe(0)
    }
  })

  test('HUMID TURF (meadow-reference pass): grass-ground only, bounded by TURF_RGB, and it gates the dirt mottle', () => {
    let humid_seen = 0
    for (const [wx, wz] of SAMPLE_XZ) {
      const grass = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      // turf ∈ [0,1]; the multiplier never dips below the TURF_RGB anchor (darkest rich turf) or above 1.
      expect(grass.turf).toBeGreaterThanOrEqual(0)
      expect(grass.turf).toBeLessThanOrEqual(1)
      for (let c = 0; c < 3; c += 1) {
        expect(grass.turf_mul[c]).toBeGreaterThanOrEqual(NG_TINT.TURF_RGB[c] - 1e-9)
        expect(grass.turf_mul[c]).toBeLessThanOrEqual(1 + 1e-9)
      }
      // the dirt mottle dies with turf: at turf t the blend caps at DIRT_MAX·(1−t)
      expect(grass.dirt_blend).toBeLessThanOrEqual(NG_TINT.DIRT_MAX * (1 - grass.turf) + 1e-9)
      if (grass.turf > 0.5) humid_seen += 1
      // canopy (2 — the blades themselves) + mineral (1) + none (0) get NO turf — ground only
      expect(macro_sample(wx, wz, 2, GRASS_ROUGH, false).turf).toBe(0)
      expect(macro_sample(wx, wz, 1, DIRT_ROUGH, false).turf).toBe(0)
      expect(macro_sample(wx, wz, 0, DIRT_ROUGH, false).turf).toBe(0)
    }
    expect(humid_seen).toBeGreaterThan(0) // the field actually produces humid turf zones
    // TURF_RGB deepens AND greens: green channel retained above red/blue (dark RICH turf, not mud)
    expect(NG_TINT.TURF_RGB[1]).toBeGreaterThan(NG_TINT.TURF_RGB[0])
    expect(NG_TINT.TURF_RGB[1]).toBeGreaterThan(NG_TINT.TURF_RGB[2])
  })

  test('tinted albedo stays close to the source color (macro never blows a pixel out)', () => {
    const base = /** @type {[number,number,number]} */ ([0.36, 0.55, 0.24]) // a grass green
    for (const [wx, wz] of SAMPLE_XZ) {
      const s = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      const out = apply_tint(base, s)
      for (let c = 0; c < 3; c += 1) {
        // within value(±8%)·chroma(±|K|) plus up to DIRT_MAX pull toward dirt — generous but bounded
        expect(out[c]).toBeGreaterThan(0)
        expect(out[c]).toBeLessThan(1)
      }
    }
  })
})

// ── FAMILY AMPLITUDE DIFFERENCE (grass moves more than mineral; classes are distinct) ────────────────
describe('NG-TINT family differentiation', () => {
  test('grass class carries hue (chroma varies); mineral class does NOT (chroma flat at 1)', () => {
    let grass_chroma_spread = 0
    let mineral_chroma_spread = 0
    for (const [wx, wz] of SAMPLE_XZ) {
      grass_chroma_spread += Math.abs(macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false).climate[0] - 1)
      mineral_chroma_spread += Math.abs(macro_sample(wx, wz, 1, DIRT_ROUGH, false).climate[0] - 1)
    }
    expect(mineral_chroma_spread).toBe(0) // grassy_amt=0 ⇒ climate identically 1
    expect(grass_chroma_spread).toBeGreaterThan(0)
  })

  test('none class (water/air/glowstone) gets ZERO value + ZERO chroma (fully inert)', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const s = macro_sample(wx, wz, 0, DIRT_ROUGH, false)
      expect(s.value_mul).toBe(1)
      expect(s.climate).toEqual([1, 1, 1])
      expect(s.dirt_blend).toBe(0)
    }
  })

  test('tint_class_of maps the registry correctly (grass=3, leaves/tuft=2, water/air/glow=0, else 1)', () => {
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('grass')))).toBe(3)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('leaves')))).toBe(2)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('grass_tuft')))).toBe(2)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('water')))).toBe(0)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('air')))).toBe(0)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('glowstone')))).toBe(0)
    // flowers stay mineral (class 1) so the macro hue never touches the red/yellow heads
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('flower_red')))).toBe(1)
    expect(tint_class_of(/** @type {*} */ (get_block_by_name('flower_yellow')))).toBe(1)
    // dirt/stone/sand/log = mineral
    for (const n of ['dirt', 'stone', 'sand', 'log']) {
      expect(tint_class_of(/** @type {*} */ (get_block_by_name(n)))).toBe(1)
    }
  })
})

// ── PBR: metalness LOCKED at 0, roughness table + humid dip ──────────────────────────────────────────
describe('NG-TINT PBR — metalness lock + roughness field', () => {
  test('metalness is LOCKED at 0 (never reads as metal)', () => {
    expect(TERRAIN_PBR.metalness).toBe(0)
  })

  test('per-family base roughness table matches the design spec', () => {
    // D164 material personality: sand glossiest 0.55, satin leaves 0.68
    // (species slightly matter), damp mossy_stone 0.62 = the only sheen on stone family; dirt/log matte.
    expect(TERRAIN_PBR.rough.sand).toBeCloseTo(0.55, 5)
    expect(TERRAIN_PBR.rough.grass).toBeCloseTo(0.85, 5)
    expect(TERRAIN_PBR.rough.leaves).toBeCloseTo(0.68, 5)
    expect(TERRAIN_PBR.rough.dirt).toBeCloseTo(0.9, 5)
    expect(TERRAIN_PBR.rough.stone).toBeCloseTo(0.82, 5)
    // sand is the glossiest ground (lowest roughness) — the "sand reflects light better" directive
    expect(TERRAIN_PBR.rough.sand).toBeLessThan(TERRAIN_PBR.rough.grass)
    expect(TERRAIN_PBR.rough.sand).toBeLessThan(TERRAIN_PBR.rough.dirt)
    expect(TERRAIN_PBR.rough.sand).toBeLessThan(TERRAIN_PBR.rough.stone)
  })

  test('base_roughness_of resolves every registry block to a finite roughness in [min,1]', () => {
    for (const b of BLOCK_REGISTRY) {
      const r = base_roughness_of(b)
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(TERRAIN_PBR.min)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  test('grass roughness dips on HUMID patches (dew sheen) and rises when dry — within ±humid_dip', () => {
    let saw_gloss = false
    let saw_rough = false
    for (const [wx, wz] of SAMPLE_XZ) {
      const s = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      // roughness = base − m·humid_dip, clamped ⇒ within [base−dip, base+dip] before clamp
      expect(s.rough).toBeGreaterThanOrEqual(clamp(GRASS_ROUGH - TERRAIN_PBR.humid_dip, TERRAIN_PBR.min, 1) - 1e-9)
      expect(s.rough).toBeLessThanOrEqual(clamp(GRASS_ROUGH + TERRAIN_PBR.humid_dip, TERRAIN_PBR.min, 1) + 1e-9)
      if (s.m > 0.3 && s.rough < GRASS_ROUGH) saw_gloss = true // humid ⇒ glossier
      if (s.m < -0.3 && s.rough > GRASS_ROUGH) saw_rough = true // dry ⇒ rougher
    }
    expect(saw_gloss).toBe(true)
    expect(saw_rough).toBe(true)
  })

  test('sand roughness ripples by ±sand_ripple from the fine octave (specular not uniform)', () => {
    const vals = SAMPLE_XZ.map(
      ([wx, wz]) =>
        macro_sample(wx, wz, tint_class_of(/** @type {*} */ (get_block_by_name('sand'))), SAND_ROUGH, true).rough
    )
    for (const r of vals) {
      expect(r).toBeGreaterThanOrEqual(clamp(SAND_ROUGH - TERRAIN_PBR.sand_ripple, TERRAIN_PBR.min, 1) - 1e-9)
      expect(r).toBeLessThanOrEqual(clamp(SAND_ROUGH + TERRAIN_PBR.sand_ripple, TERRAIN_PBR.min, 1) + 1e-9)
    }
    // the ripple actually varies the roughness (not a flat constant)
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0)
  })

  test('humid dip and sand ripple are subtle (dip ≤ 0.2, ripple ≤ 0.1) and min floor is sane', () => {
    expect(TERRAIN_PBR.humid_dip).toBeGreaterThan(0)
    expect(TERRAIN_PBR.humid_dip).toBeLessThanOrEqual(0.2)
    expect(TERRAIN_PBR.sand_ripple).toBeGreaterThan(0)
    expect(TERRAIN_PBR.sand_ripple).toBeLessThanOrEqual(0.1)
    expect(TERRAIN_PBR.min).toBeGreaterThan(0)
    expect(TERRAIN_PBR.min).toBeLessThan(TERRAIN_PBR.rough.sand) // floor below the glossiest family
  })
})

// OWNER ROUND-3 — the cross-grass straw-tip RATIO must never saturate a dry zone to all-straw. Because the
// material mixes the per-plant hash 50/50 with straw_tip_ratio (h_biased = 0.5·h + 0.5·ratio) and h is
// uniform, the STRAW SHARE equals the ratio exactly, so these bounds ARE the rendered straw/green split.
describe('straw_tip_ratio — dry-zone interleave never saturates (round-3)', () => {
  test('a DRY zone (moisture 0) is ~60% straw, so ~40% stays GREEN — never all-straw', () => {
    expect(straw_tip_ratio(0)).toBeCloseTo(0.6, 5) // BASE + SPAN, capped at CAP
    expect(straw_tip_ratio(0)).toBeLessThan(1) // the whole point: a dry meadow keeps a green minority
  })
  test('a HUMID zone (moisture 1) is mostly GREEN (~15% straw)', () => {
    expect(straw_tip_ratio(1)).toBeCloseTo(STRAW_TIP.BASE, 5)
  })
  test('monotonic dry→straw, and ALWAYS bounded to [0, CAP] (never 1.0) across the moisture range', () => {
    let prev = -1
    for (let m = 0; m <= 1.0001; m += 0.1) {
      const r = straw_tip_ratio(m)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(STRAW_TIP.CAP) // CAP < 1 ⇒ green always present
      expect(r).toBeLessThanOrEqual(prev < 0 ? r : straw_tip_ratio(m - 0.1)) // non-increasing in moisture
      prev = r
    }
  })
  test('CAP is strictly below 1 (structural guarantee: a green minority survives the driest cell)', () => {
    expect(STRAW_TIP.CAP).toBeLessThan(1)
    expect(STRAW_TIP.BASE).toBeGreaterThan(0) // humid zones still get a few straw tips (not pure green)
  })
})

// GRASS-GRADIENT fix — live-QA showed "too repetitive... global terrain gradient like
// veloren". STRUCTURAL FIX: `?grassgrad=` now scales a DEDICATED macro octave (P_MACRO_A/B) applied
// OUTSIDE the diluted vfield/climate mix, instead of scaling that mix directly (proven dead — see
// GRASS_GRADIENT_LEVELS' doc in terrain_tint_data.js). These tests prove the resolver + level table, and
// that macro_sample's optional `grad` param (default level 'a' = OFF) reproduces the pre-existing
// unscaled behaviour exactly, so every test ABOVE this line still pins the shipped baseline untouched.
describe('resolve_grass_gradient_level — `?grassgrad=` URL resolver', () => {
  test('valid levels pass through; anything else (absent/unrecognized) defaults to a', () => {
    expect(resolve_grass_gradient_level('b')).toBe('b')
    expect(resolve_grass_gradient_level('c')).toBe('c')
    expect(resolve_grass_gradient_level('d')).toBe('d')
    expect(resolve_grass_gradient_level('a')).toBe('a')
    for (const raw of [null, undefined, '', 'x', 'A', 'B', 'D', 'grassgrad', '0']) {
      expect(resolve_grass_gradient_level(/** @type {*} */ (raw))).toBe('a')
    }
  })
})

describe('GRASS_GRADIENT_LEVELS — dedicated macro-gradient amplitude table', () => {
  test('level a is OFF (0, 0) — the default never drifts from the shipped baseline', () => {
    expect(GRASS_GRADIENT_LEVELS.a.val).toBe(0)
    expect(GRASS_GRADIENT_LEVELS.a.hue).toBe(0)
  })

  test('a < b < c < d strictly on both axes (a monotonic ladder, not just arbitrary points)', () => {
    expect(GRASS_GRADIENT_LEVELS.b.val).toBeGreaterThan(GRASS_GRADIENT_LEVELS.a.val)
    expect(GRASS_GRADIENT_LEVELS.c.val).toBeGreaterThan(GRASS_GRADIENT_LEVELS.b.val)
    expect(GRASS_GRADIENT_LEVELS.d.val).toBeGreaterThan(GRASS_GRADIENT_LEVELS.c.val)
    expect(GRASS_GRADIENT_LEVELS.b.hue).toBeGreaterThan(GRASS_GRADIENT_LEVELS.a.hue)
    expect(GRASS_GRADIENT_LEVELS.c.hue).toBeGreaterThan(GRASS_GRADIENT_LEVELS.b.hue)
    expect(GRASS_GRADIENT_LEVELS.d.hue).toBeGreaterThan(GRASS_GRADIENT_LEVELS.c.hue)
  })

  test('realized macro value-swing rises b→d, undiluted (no detail-octave mix to drown it) and bounded', () => {
    const val_b = NG_TINT.MACRO_VAL * GRASS_GRADIENT_LEVELS.b.val
    const val_c = NG_TINT.MACRO_VAL * GRASS_GRADIENT_LEVELS.c.val
    const val_d = NG_TINT.MACRO_VAL * GRASS_GRADIENT_LEVELS.d.val
    expect(val_b).toBeGreaterThan(0.1) // meaningfully bigger than the OLD dead lever's ceiling (0.08)
    expect(val_c).toBeGreaterThan(val_b)
    expect(val_d).toBeGreaterThan(val_c)
    expect(val_d).toBeLessThanOrEqual(0.75) // loud but bounded — never a blowout/rainbow
  })

  test('hue drift stays subtler than the value swing in REALIZED terms at every level (ceiling-bounded, not fraction-bounded)', () => {
    // val/hue now ride the SAME per-level fraction (see GRASS_GRADIENT_LEVELS' calibration note — an
    // a visible gradient needs hue to be a real lever, not a whisper fraction of val), so the "hue
    // stays subtle" guarantee comes from MACRO_K's own ceiling being well below MACRO_VAL's, not from a
    // smaller fraction.
    for (const level of /** @type {const} */ (['a', 'b', 'c', 'd'])) {
      const { val, hue } = GRASS_GRADIENT_LEVELS[level]
      expect(hue).toBeLessThanOrEqual(val) // hue fraction never out-scales value fraction
      const realized_hue = Math.max(...NG_TINT.MACRO_K.map((k) => Math.abs(k))) * hue
      const realized_val = NG_TINT.MACRO_VAL * val
      expect(realized_hue).toBeLessThanOrEqual(realized_val + 1e-9) // realized hue swing ≤ realized value swing
    }
    // MACRO_K's own ceiling is a fraction of MACRO_VAL's — hue is subtle by construction, not just by
    // the ladder fraction (belt-and-suspenders vs the OLD design where K and VAL_GRASS coincidentally
    // shared the same 0.08 ceiling, which masked how little "hue ≤ val" alone actually guarantees).
    const max_k = Math.max(...NG_TINT.MACRO_K.map((k) => Math.abs(k)))
    expect(max_k).toBeLessThan(NG_TINT.MACRO_VAL * 0.5)
  })

  test('level a reproduces the pre-existing unscaled macro_sample output exactly (default-arg parity)', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const explicit_a = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false, GRASS_GRADIENT_LEVELS.a)
      const default_arg = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      expect(explicit_a).toEqual(default_arg)
    }
  })

  test('level a matches the git-committed pre-grassgrad baseline exactly (no grad dependence survived)', () => {
    // Regression pin: the vfield/climate terms must NEVER read `grad` again (a prior bug in this same
    // round zeroed them out by mistake when 'a' moved from {val:1,hue:1} to {val:0,hue:0} — caught before
    // ship). This recomputes the value_mul/climate formulas with NO grad term at all and requires an
    // exact match to macro_sample's default-arg output.
    for (const [wx, wz] of SAMPLE_XZ) {
      const s = macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false)
      const moisture = tint_noise(wx / NG_TINT.P_BIG, wz / NG_TINT.P_BIG, 0)
      const detail = tint_noise(wx / NG_TINT.P_SMALL, wz / NG_TINT.P_SMALL, 1)
      const m = moisture * 2 - 1
      const dd = detail * 2 - 1
      const vfield = clamp(m * -0.6 + dd * 0.4, -1, 1)
      expect(s.value_mul).toBeCloseTo(1 + NG_TINT.VAL_GRASS * vfield, 12)
      for (let c = 0; c < 3; c += 1) expect(s.climate[c]).toBeCloseTo(1 + NG_TINT.K[c] * m, 12)
      expect(s.macro_value_mul).toBe(1) // octave OFF at level a
      expect(s.macro_climate).toEqual([1, 1, 1])
    }
  })

  test('level b/c/d widen the macro_value_mul spread vs level a (the pick is actually visible)', () => {
    // Measures macro_value_mul ALONE (not the product with the pre-existing vfield term): both fields are
    // independent randoms sampled at different periods, so the PRODUCT's peak-to-peak spread over a small
    // fixed sample set isn't guaranteed monotonic even when each factor's own amplitude rises (phase
    // interaction can shrink the combined extremes by chance) — proven by an earlier version of this test
    // that failed non-deterministically-looking at spread_b < spread_a despite b > a. macro_value_mul's
    // OWN spread is deterministic: same gfield samples at every level, only the scalar ceiling×fraction
    // changes, so it scales exactly linearly with the ladder fraction.
    const spread = /** @type {(grad: {val: number, hue: number}) => number} */ (
      (grad) => {
        const vals = SAMPLE_XZ.map(
          ([wx, wz]) => macro_sample(wx, wz, GRASS_CLASS, GRASS_ROUGH, false, grad).macro_value_mul
        )
        return Math.max(...vals) - Math.min(...vals)
      }
    )
    const spread_a = spread(GRASS_GRADIENT_LEVELS.a)
    const spread_b = spread(GRASS_GRADIENT_LEVELS.b)
    const spread_c = spread(GRASS_GRADIENT_LEVELS.c)
    const spread_d = spread(GRASS_GRADIENT_LEVELS.d)
    expect(spread_a).toBe(0) // OFF ⇒ macro_value_mul is the constant 1 everywhere
    expect(spread_b).toBeGreaterThan(spread_a)
    expect(spread_c).toBeGreaterThan(spread_b)
    expect(spread_d).toBeGreaterThan(spread_c)
  })

  test('the grass-gradient pick never touches mineral (sand/stone/snow) — do NOT retune them now', () => {
    for (const [wx, wz] of SAMPLE_XZ) {
      const mineral_a = macro_sample(wx, wz, 1, DIRT_ROUGH, false, GRASS_GRADIENT_LEVELS.a)
      const mineral_d = macro_sample(wx, wz, 1, DIRT_ROUGH, false, GRASS_GRADIENT_LEVELS.d)
      expect(mineral_d).toEqual(mineral_a) // class 1 (mineral) is scale-invariant to the grass pick, even at the loudest rung
    }
  })

  test('the dedicated octave is C1-continuous across chunk borders (pure world-XZ, no chunk term)', () => {
    const eps = 0.03
    for (let wz = -80; wz <= 80; wz += 7.3) {
      for (const bx of [32, 64, 96, -32, -64]) {
        const lo = macro_sample(bx - 0.1, wz, GRASS_CLASS, GRASS_ROUGH, false, GRASS_GRADIENT_LEVELS.d)
        const hi = macro_sample(bx + 0.1, wz, GRASS_CLASS, GRASS_ROUGH, false, GRASS_GRADIENT_LEVELS.d)
        expect(Math.abs(hi.macro_value_mul - lo.macro_value_mul)).toBeLessThan(eps)
        for (let c = 0; c < 3; c += 1) expect(Math.abs(hi.macro_climate[c] - lo.macro_climate[c])).toBeLessThan(eps)
      }
    }
  })
})
