// MASSIF COMPOSITE surface stage (S-24) — a single coherent per-column relief that OWNS the land
// surface for a world when enabled (Everest), replacing the spline+erosion+canyon+trough composition
// with one scale-coupled function. It is the picked "mix of the 3" from the S-24 candidate
// gallery (a local candidates script):
//   • TRUNK (candidate C) — a low-freq warped ridged field is the MACRO drainage: broad massif zones
//     (env→1) vs broad valley CORRIDORS (env→0) whose floors sit near `floor` (start the
//     valley low, around 10). This places the deep floors and the dominant massifs.
//   • SKELETON (candidate A) — a warped ridged-multifractal is the within-massif ridge/spur network
//     (radiating spurs by construction). It rides ON the trunk (multiplied by env) so ridges express
//     only inside massifs and vanish into the corridors; a `shoulder` floor keeps massif interiors
//     elevated (hanging valleys above the master trough).
//   • EROSION (candidate B) — derivative-damped ridged turbulence adds SIGNED fine relief (smooth
//     faces + a few dendritic couloirs), amplitude-masked to the mid-FACES (a hump that fades on the
//     floors AND the summits, where the skeleton's ridged crests own the sharp arêtes). Coupled to
//     the macro `body`, never pasted.
//   • MICRO — tiny fbm roughness everywhere: the anti-flat guarantee (kills voxel terrace furrows on
//     the gentle corridor floors).
// Result = floor(floor + body*span + ero + micro), clamped to the world box. Off ⇒ enabled:false and
// column_gen keeps the legacy raw_land ⇒ byte-identical DEFAULT + every other world.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs only; seeded simplex via alea (never
// Math.random); the shared ridged/warp samplers precompute their amplitude tables (never Math.pow at
// sample time). Region-local: surface(x,z) depends only on (x,z)+seed.

import { createNoise2D } from 'simplex-noise'

import { create_ridged_sampler } from '../noise/ridged.js'
import { create_warp_sampler } from '../noise/warp.js'
import { alea } from '../noise/sampler.js'

import { region_profile } from './regions.js'

/** @typedef {import('../../config/world_gen_config.js').MassifConfig} MassifConfig */

/**
 * @typedef {object} MassifContext resolved composite-surface stage (samplers built once per world).
 * @property {boolean} enabled stage owns the land surface (config enabled)
 * @property {number} floor deepest master-valley floor world-y
 * @property {number} span body height span (floor + span ≈ summit body cap)
 * @property {number} body_concave CONCAVE profile shaping, 0..1 (0 = linear body→height; 1 = fully quadratic:
 *   low body is COMPRESSED into long gentle valley aprons, height ACCELERATES toward the peaks — the ref's
 *   "mountains fade into valleys, it accelerates for peaks"). Pure multiply (no Math.pow at sample time).
 * @property {number} world_height clamp ceiling (surface never exceeds world_height − 2)
 * @property {import('../noise/warp.js').WarpSampler} trunk_warp macro-drainage domain warp
 * @property {import('../noise/ridged.js').RidgedSampler} trunk macro massif/corridor ridged field
 * @property {number} trunk_warp_amp @property {number} env_lo @property {number} env_hi
 * @property {import('../noise/warp.js').WarpSampler} skel_warp ridge-network domain warp
 * @property {import('../noise/ridged.js').RidgedSampler} skel within-massif ridge/spur multifractal
 * @property {number} skel_warp_amp @property {number} skel_lo @property {number} skel_hi
 * @property {number} shoulder massif-body floor (hanging-valley elevation), 0..1
 * @property {(x: number, z: number) => number} ero_noise raw simplex for the B erosion turbulence
 * @property {number} ero_period @property {number} ero_octaves @property {number} ero_damp
 * @property {number} ero_amp @property {number} ero_face_lo @property {number} ero_face_hi
 * @property {number} ero_crest_fade
 * @property {(x: number, z: number) => number} micro_noise anti-flat roughness simplex
 * @property {number} micro_period @property {number} micro_amp
 */

const smooth = (/** @type {number} */ t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const stretch = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  clamp01((v - lo) / (hi - lo))

/**
 * Builds the massif composite stage context from a world's `massif` recipe + the carvers sub-seed
 * (distinct XOR salts per sampler, decorrelated from every other stage). Samplers allocate once per
 * world. Disabled / absent config ⇒ enabled:false ⇒ column_gen keeps the legacy raw_land (parity).
 * @param {MassifConfig} [cfg]
 * @param {Record<string, number>} [seeds] output of derive_world_seeds
 * @param {number} [world_height] clamp ceiling (defaults 384)
 * @returns {MassifContext}
 */
export function create_massif_context(cfg, seeds, world_height = 384) {
  const s = (seeds?.carvers ?? 0) >>> 0
  return {
    enabled: cfg?.enabled === true,
    floor: cfg?.floor ?? 10,
    span: cfg?.span ?? 350,
    body_concave: cfg?.body_concave ?? 0,
    world_height,
    trunk_warp: create_warp_sampler({
      seed: (s ^ 0x5124_0001) >>> 0,
      base_period: cfg?.trunk_warp_period ?? 1650,
      octaves: 2,
    }),
    trunk: create_ridged_sampler({
      seed: (s ^ 0x5124_0002) >>> 0,
      base_period: cfg?.trunk_period ?? 1180,
      octaves: cfg?.trunk_octaves ?? 5,
      gain: 0.5,
      offset: 1,
      sharpness: 2,
    }),
    trunk_warp_amp: cfg?.trunk_warp_amp ?? 300,
    env_lo: cfg?.env_lo ?? 0.12,
    env_hi: cfg?.env_hi ?? 0.6,
    skel_warp: create_warp_sampler({
      seed: (s ^ 0x5124_0003) >>> 0,
      base_period: cfg?.skel_warp_period ?? 1500,
      octaves: 2,
    }),
    skel: create_ridged_sampler({
      seed: (s ^ 0x5124_0004) >>> 0,
      base_period: cfg?.skel_period ?? 780,
      octaves: cfg?.skel_octaves ?? 5,
      gain: 0.5,
      offset: 1,
      sharpness: 2,
    }),
    skel_warp_amp: cfg?.skel_warp_amp ?? 330,
    skel_lo: cfg?.skel_lo ?? 0.13,
    skel_hi: cfg?.skel_hi ?? 0.68,
    shoulder: cfg?.shoulder ?? 0.32,
    ero_noise: createNoise2D(alea((s ^ 0x5124_0005) >>> 0)),
    ero_period: cfg?.ero_period ?? 640,
    ero_octaves: cfg?.ero_octaves ?? 4,
    ero_damp: cfg?.ero_damp ?? 30,
    ero_amp: cfg?.ero_amp ?? 15,
    ero_face_lo: cfg?.ero_face_lo ?? 0.12,
    ero_face_hi: cfg?.ero_face_hi ?? 0.55,
    ero_crest_fade: cfg?.ero_crest_fade ?? 0.82,
    micro_noise: createNoise2D(alea((s ^ 0x5124_0006) >>> 0)),
    micro_period: cfg?.micro_period ?? 22,
    micro_amp: cfg?.micro_amp ?? 2.2,
  }
}

/** Reused warp scratch (single-threaded per worker). */
const WS = [0, 0, 0]

/**
 * Candidate-B derivative-damped ridged turbulence at (x,z) → [0,1]. Each octave's contribution is
 * damped by the accumulated gradient magnitude: detail is suppressed where the running slope is steep
 * (smooth faces) and survives in the flats (dendritic channels between connected ridged crests).
 * @param {MassifContext} m
 * @param {number} x @param {number} z
 * @returns {number} ridged turbulence in [0,1]
 */
function ero_field(m, x, z) {
  let sum = 0
  let amp = 1
  let amp_sum = 0
  let freq = 1 / m.ero_period
  let dx = 0
  let dz = 0
  const e = 1.0
  for (let i = 0; i < m.ero_octaves; i += 1) {
    const n = m.ero_noise(x * freq, z * freq)
    const nx = m.ero_noise((x + e) * freq, z * freq)
    const nz = m.ero_noise(x * freq, (z + e) * freq)
    dx += (nx - n) / e
    dz += (nz - n) / e
    const damp = 1 / (1 + m.ero_damp * (dx * dx + dz * dz))
    const ridged = 1 - Math.abs(n)
    sum += amp * ridged * ridged * damp
    amp_sum += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / amp_sum
}

/**
 * The composite land surface world-y at a column (integer, clamped to the world box). This is the
 * whole raw_land for a massif-enabled world — column_gen calls it INSTEAD of the spline/erosion/
 * canyon/trough composition. Pure per-(x,z), region-local, deterministic.
 *
 * SUB-BIOME REGION MODULATION (S-25): when a `regions` context is enabled, the per-column region profile
 * (regions.js) modulates the composite — `relief_scale` on the massif body (flattens ice basins/wastelands,
 * keeps peaks), `roughness_scale` on the face detail (smooth glaciers vs jagged peaks), and `height_bias`
 * shifting the whole region — so ONE massif world reads as many terrains (a lot of terrain variety,
 * no locations look the same). Off/absent ⇒ the EXACT legacy formula runs ⇒ byte-identical (parity).
 * @param {MassifContext} m
 * @param {number} world_x @param {number} world_z
 * @param {import('./regions.js').RegionContext} [regions] the sub-biome region layer (off ⇒ legacy parity)
 * @returns {number} surface world-y (integer)
 */
export function massif_surface(m, world_x, world_z, regions) {
  // TRUNK envelope: broad massif zones (env→1) vs broad valley corridors (env→0).
  m.trunk_warp.offset(world_x, 0, world_z, WS)
  const traw = m.trunk.sample(world_x + WS[0] * m.trunk_warp_amp, 0, world_z + WS[2] * m.trunk_warp_amp)
  const env = smooth(stretch(traw, m.env_lo, m.env_hi))
  // SKELETON: radiating within-massif ridge/spur network.
  m.skel_warp.offset(world_x, 0, world_z, WS)
  const skel = stretch(
    m.skel.sample(world_x + WS[0] * m.skel_warp_amp, 0, world_z + WS[2] * m.skel_warp_amp),
    m.skel_lo,
    m.skel_hi
  )
  // Massif body: env gates the ridge relief; `shoulder` keeps interiors elevated (hanging valleys).
  const body = clamp01(env * (m.shoulder + (1 - m.shoulder) * skel))
  // CONCAVE shaping (mountains slowly fade into valley, NOT brutally — it accelerates for peaks):
  // body*(1−c + c*body) COMPRESSES low body into long gentle valley aprons and ACCELERATES high body toward
  // steep peaks. Pure multiply (no Math.pow at sample time). c=0 ⇒ linear (byte-identical). The shaped body
  // drives BOTH the erosion face-mask (couloirs track the real mid-faces) and the final elevation.
  const shaped = m.body_concave > 0 ? body * (1 - m.body_concave + m.body_concave * body) : body
  // EROSION detail (signed) on the mid-faces: a hump mask that fades on the floors (deposition) AND
  // the summits (the skeleton's ridged crests own the arêtes) — couples B to the macro.
  const face =
    smooth(stretch(shaped, m.ero_face_lo, m.ero_face_hi)) * (1 - smooth(stretch(shaped, m.ero_crest_fade, 1.0)))
  const ero = (ero_field(m, world_x, world_z) * 2 - 1) * m.ero_amp * face
  // MICRO anti-flat everywhere (breaks quantization furrows on the gentle floors).
  const micro = (m.micro_noise(world_x / m.micro_period, world_z / m.micro_period) * 2 - 1) * m.micro_amp
  let y
  if (regions && regions.enabled) {
    // SUB-BIOME region modulation: flatten/amplify the body + face detail and shift the region as a whole.
    const rp = region_profile(regions, world_x, world_z)
    let sr = shaped * rp.relief_scale
    if (sr < 0) sr = 0
    else if (sr > 1) sr = 1 // guard the world cap on any >1 amplification (no flat-topped mesa at the ceiling)
    y = m.floor + sr * m.span + (ero + micro) * rp.roughness_scale + rp.height_bias
  } else {
    // LEGACY / non-region worlds: the exact original composition (preserved bit-for-bit for parity).
    y = m.floor + shaped * m.span + ero + micro
  }
  if (y < 2) y = 2
  if (y > m.world_height - 2) y = m.world_height - 2
  return Math.floor(y)
}
