// ORGANIC GRASS-DENSITY FIELD (§4.6 decorators) — the continuous humidity+altitude coverage probability
// the meadow carpet is gated by, extracted from surface_decorator.js so that file stays under the
// ≤600-LoC law and the density math has ONE home (same split discipline as terrain_flora.js /
// registry_nodes.js). Pure integer-hash value noise (§3.7 determinism law — no transcendentals; Math.pow
// is banned in gen/ by the CI guard, so the coverage curve is a multiply-only polynomial).
//
// [2026-07-05 owner] "grass sprites is too dense and some chunks are missing, should use a noise with more
// sparse and not chunk related but more like humidity/dryness and altitude/random." THE OLD DEFECT: the
// carpet was coverage-gated by a multi-scale hash whose macro cell was 37 blocks — LARGER than a 32-block
// chunk — so a single failing macro cell blanked a WHOLE chunk footprint (cell-quantized coverage, but the
// cell was chunk-sized so it read as chunk-aligned holes). THE FIX: a CONTINUOUS world-coord coverage
// probability from (a) a smooth low-freq MOISTURE value-noise (humid hollows ↔ dry rises), (b) an ALTITUDE
// falloff (lusher low, sparser high), (c) a per-column hash jitter. No cell size ⇒ NO chunk/cell
// periodicity BY CONSTRUCTION (proven drift-free: moisture autocorrelation decays monotonically past lag
// 32/37; adjacent-column moisture step ~0.009). Net ~40% in average meadows, near-full in humid hollows,
// thin (never a hard hole) on dry rises — VARIANCE is the point. The moisture construction MIRRORS
// terrain_tint.js's tint_noise (same P_BIG-family wavelengths) so gen coverage tracks the shader's
// humid/dry macro tint: humid patches grow full AND tint dark-green, dry rises thin AND tint straw.

import { SEA_LEVEL } from '../config/world_config.js'

const U32_MASK = 0xffffffff

const SALT_MOISTURE = 0x9e3779b1 // coarse moisture octave (humidity field)
const SALT_MOISTURE2 = 0x85ebca77 // medium moisture octave (erosion-scale detail)
const SALT_COVER = 0x51e7a3b9 // per-column plant-or-bare jitter
const MOIST_PERIOD_BIG = 88 // coarse moisture wavelength in blocks (humid hollows ↔ dry rises)
const MOIST_PERIOD_MED = 41 // medium moisture wavelength (breaks the big blobs)
const COVER_FLOOR = 0.06 // dry-rise coverage floor — sparse blades, never a bare hole (kills missing chunks)
const COVER_SPAN = 0.62 // humid-peak reach above the floor — capped below full so even humid meadows keep
//                         visible dry breaks (avoids "too dense"): floor+span ≈ 0.68 ceiling, not a solid mat
const MOIST_GAIN = 2.35 // contrast gain around 0.5 so the bell-ish octave sum reaches the 0/1 rails
const MOIST_MID_PULL = 0.45 // humid = wm·(1−k+k·wm), a multiply-only ≈ wm^1.35 (max err 0.015) that pulls
//                             the mid coverage DOWN (avoids "too dense") while keeping the humid tail high
const ALT_LUSH_ABOVE = SEA_LEVEL + 6 // surface_y at/below which altitude no longer thins coverage
const ALT_FADE_BLOCKS = 64 // blocks above ALT_LUSH_ABOVE over which altitude thins to its high-ground floor
const ALT_HIGH_FLOOR = 0.5 // altitude multiplier floor on high ground (never fully kills grass on a peak)

/**
 * Deterministic integer hash of a world column + a decision salt → u32. Pure multiply/xor/shift on 32-bit
 * unsigned ints — the SAME lineage surface_decorator.js's hash_column uses (§3.7), so the field is
 * byte-stable on every machine. @param {number} x @param {number} z @param {number} salt @returns {number} */
function hash_u32(x, z, salt) {
  let h = (x * 374761393 + z * 668265263 + salt * 2246822519) & U32_MASK
  h = (h ^ (h >>> 13)) & U32_MASK
  h = (h * 1274126177) & U32_MASK
  h = (h ^ (h >>> 16)) & U32_MASK
  return h >>> 0
}

/** hash → float in [0,1). @param {number} x @param {number} z @param {number} salt @returns {number} */
function hash01(x, z, salt) {
  return hash_u32(x, z, salt) / 4294967296
}

/** Smootherstep ease (3t²−2t³) for the value-noise lattice — no transcendentals (§3.7). @param {number} t @returns {number} */
function smooth01(t) {
  return t * t * (3 - 2 * t)
}

/** Clamp to [0,1]. @param {number} v @returns {number} */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Tileable 2-D value noise in [0,1) at a WORLD column — integer-hash lattice + smoothstep interp,
 * C1-continuous everywhere (seamless across chunk borders BY CONSTRUCTION: no chunk term, no cell size ⇒
 * no 32/37-block periodicity). @param {number} x world block x @param {number} z world block z @param
 * {number} period wavelength in blocks @param {number} salt octave salt @returns {number} */
function value_noise_2d(x, z, period, salt) {
  const fx = x / period
  const fz = z / period
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const sx = smooth01(fx - x0)
  const sz = smooth01(fz - z0)
  const v00 = hash01(x0, z0, salt)
  const v10 = hash01(x0 + 1, z0, salt)
  const v01 = hash01(x0, z0 + 1, salt)
  const v11 = hash01(x0 + 1, z0 + 1, salt)
  return (v00 * (1 - sx) + v10 * sx) * (1 - sz) + (v01 * (1 - sx) + v11 * sx) * sz
}

/**
 * Smooth MOISTURE [0,1) at a world column — two value-noise octaves (coarse hollows + medium erosion).
 * The humidity axis of the density field: high = humid hollow, low = dry rise. Continuous, no chunk term.
 * @param {number} world_x @param {number} world_z @param {number} seed decorators sub-seed @returns {number} */
export function surface_moisture(world_x, world_z, seed) {
  return (
    0.65 * value_noise_2d(world_x, world_z, MOIST_PERIOD_BIG, (seed ^ SALT_MOISTURE) >>> 0) +
    0.35 * value_noise_2d(world_x, world_z, MOIST_PERIOD_MED, (seed ^ SALT_MOISTURE2) >>> 0)
  )
}

/**
 * The grass-coverage PROBABILITY [0,1] at a world column — the organic density field (humidity + altitude
 * + random). Humid hollows → near-full; dry rises → a thin floor (never a bare hole, so no missing chunks);
 * high ground → thinned by altitude. Callers compare this against grass_covered() (a per-column hash) so
 * patch edges stay ragged. @param {number} world_x @param {number} world_z @param {number} surface_y column
 * surface world-y (altitude driver) @param {number} seed decorators sub-seed @returns {number} coverage p */
export function coverage_probability(world_x, world_z, surface_y, seed) {
  const m = surface_moisture(world_x, world_z, seed)
  // Widen the bell-ish octave sum to reach the rails, then curve the mid DOWN (avoids "too dense") while
  // keeping the humid tail high — so an average meadow is ~40% but hollows still read near-full.
  const wm = clamp01((m - 0.5) * MOIST_GAIN + 0.5)
  const humid = wm * (1 - MOIST_MID_PULL + MOIST_MID_PULL * wm) // ≈ wm^1.35, multiply-only (§3.7)
  const alt = clamp01(1 - (surface_y - ALT_LUSH_ABOVE) / ALT_FADE_BLOCKS)
  return clamp01((COVER_FLOOR + humid * COVER_SPAN) * (ALT_HIGH_FLOOR + (1 - ALT_HIGH_FLOOR) * alt))
}

/**
 * Whether a meadow column carries grass under the organic density field — coverage_probability vs a
 * per-column hash jitter. The single gate the carpet/tall/flower herb layer passes through. @param {number}
 * world_x @param {number} world_z @param {number} surface_y @param {number} seed @returns {boolean} */
export function grass_covered(world_x, world_z, surface_y, seed) {
  return hash01(world_x, world_z, (seed ^ SALT_COVER) >>> 0) < coverage_probability(world_x, world_z, surface_y, seed)
}
