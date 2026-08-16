// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NIGHT SKY — the real one — target: "the moon still looks like a lamp, it should
// illuminate a bit the sky, we should see beautiful stars, and according to the world seed and settings,
// even other planets, milky way, a real amazing sky"). ONE home consumed by BOTH sky paths — sky_node.js
// (LOW analytic) and sky_hillaire/hillaire_sky.js (MEDIUM/HIGH physical) — so the tiers cannot drift:
//
//   • MOON ATMOSPHERE — kills the "lamp" read (a windowed corona's visible boundary on black — the same
//     disease the sun's corona had). Replaced by BOUNDARY-FREE terms: a tight rational spike + a pow tail
//     hugging the disc, blending into a BROAD inverse-power sky illumination (tens of degrees) with a
//     slight horizon lift — the moon lights the SKY, not a bubble.
//   • NIGHT BASE — a deep blue-grey vertical gradient (never pure black; hillaire's LUT sky is ~0 at
//     night). Mirrors sky_node.js's SKY_NIGHT palette (one colour home).
//   • STARS — 3 magnitude tiers of direction-hashed cell stars (technique: Overdraw.xyz "Using cellular
//     noise to generate procedural stars" — per-cell hash offset + radial falloff, radius SHRUNK by the
//     offset magnitude so no star clips its cell border; layered scales per Casual-Effects/marian42
//     starfield lineage). Temperature tint variation, subtle time-twinkle on the smallest tier only,
//     fading near the moon glow + at the horizon haze + to zero in daylight (gradual dusk fade-in).
//   • MILKY WAY — a seed-oriented great-circle band: gaussian profile × wispy fBm × darker dust lanes
//     (fBm band + dust-lane subtraction — the standard shadertoy galactic-band construction), faint
//     warm-white core, humble near the moon. MEDIUM/HIGH only (LOW skips — tier budget).
//   • PLANETS — two small bright non-twinkling discs (one warm, one pale), positions seed-derived,
//     drifting VERY slowly with the time of day (CPU-ticked uniforms off the sun azimuth).
//
// PER-WORLD: `derive_night_sky_params(seed)` (FNV hash01 — texture_noise.js) → galaxy orientation basis,
// planet orbit bases/phases/drifts, a slight star-density variance. TSL laws: flat chains only (no
// If/Loop/discard — nowhere near the naga 127-nesting cliff), scalars folded as constants, the only
// uniforms are the two CPU-ticked planet directions. Everything multiplies through a night gate that is
// EXACTLY 0 in daylight, so the day sky is untouched.
//
// TERRAIN LAW: this node feeds background_node ONLY — sample_sky / sample_sky_dome / fog / ambient
// (sky_light_coupling) never see it, so night terrain contrast and water<terrain read are preserved.

import { Vector3 } from 'three'
import type { Node } from 'three/webgpu'
import {
  clamp,
  exp,
  float,
  fract,
  floor,
  hash,
  length,
  mix,
  mx_fractal_noise_float,
  pow,
  smoothstep,
  sin,
  time,
  uniform,
  vec3,
} from 'three/tsl'

import { hash01 } from '../textures/noise.ts'

import {
  SKY_NIGHT,
  MOON_DISC_COS,
  MOON_DISC_INNER_COS,
  MOON_DISC_RGB,
  disc_space_uv,
  type Rgb,
  type SkyPalette,
} from './shared.ts'

type HorizonFade = Readonly<{ start_deg: number; end_deg: number }>
type NebulaRegion = Readonly<{ rgb: Rgb; k: number; gain: number }>
type NightSkyCfg = Readonly<{
  base_palette: SkyPalette | null
  star_thresh_shift: number
  star_bright_mul: number
  mw_intensity: number
  mw_rgb: Rgb
  mw_width: number
  planet_scale: number
  planet_count: number
  ringed_planet: number
  moon_glow_mul: number
  star_cluster: number
  star_red_giant: number
  arcane_tint: Readonly<{ rgb: Rgb; amount: number }> | null
  horizon_fade: HorizonFade | null
  nebula: Readonly<{
    intensity: number
    along_band: number
    orange_core: number
    orange_core_k: number
    blue: Rgb
    purple: Rgb
    orange: Rgb
    regions?: readonly NebulaRegion[]
  }>
}>

type Orbit = Readonly<{ a: Rgb; b: Rgb; phase: number; drift: number }>
export type NightSkyParams = Readonly<{
  galaxy_n: Rgb
  galaxy_a: Rgb
  galaxy_b: Rgb
  planets: readonly Orbit[]
  density_shift: number
  lattice_offset: number
  regions: readonly Readonly<{ dir: Rgb }>[]
}>

// ── moon atmosphere (all boundary-free — the anti-"lamp" kernel family, sized under the 2.05 knee) ──────
/** broad sky illumination: peak linear intensity of the moonlit sky dome at the moon. */
export const MOON_SKY_GLOW = 0.1
/** inverse-power falloff: glow = 1/(1 + K·(1−cosθ))^P — no window, decays smoothly across the whole dome. */
export const MOON_SKY_GLOW_K = 40
export const MOON_SKY_GLOW_P = 1.4
/** cool moonlight sky tint (matches sky_light_coupling's MOON_TINT family). */
export const MOON_SKY_GLOW_RGB: Rgb = [0.58, 0.7, 1.0]
/** horizon lift: the glow is boosted up to ×(1+this) as the view drops to the horizon (moon-side sky). */
export const MOON_HORIZON_LIFT = 0.5
/** near-disc halo — same rational-spike + pow-tail family as the sun's boundary-free glare. */
export const MOON_HALO_VIS = 0.0016
export const MOON_HALO_SPIKE_GAIN = 0.12
export const MOON_HALO_POW = 260
export const MOON_HALO_TAIL_GAIN = 0.22

// ── night gate (dusk fade-in: 0 until the sun is ~2° below the horizon, full by ~8° below) ─────────────
export const NIGHT_GATE_HI = -0.03
export const NIGHT_GATE_LO = -0.14

// ── stars ────────────────────────────────────────────────────────────────────────────────────────────
/** 4 magnitude tiers (Overdraw cell technique per tier): lattice freq (cells/radian), existence threshold
 *  (higher = sparser), linear brightness, base radius in cell units. Tier 3 twinkles; tier 4 is the
 *  BAND DUST — a high-frequency grain layer that mostly exists inside the milky-way band (its granular
 *  "river of stars" texture). [round-2/3 capture-driven] first cut read ~8 stars on the wide framing; the
 *  killers were SUB-PIXEL radii + a mid-grey auto-exposed night base washing 1px dots out — so radii sized
 *  ≥2px at 800px, brightness floors raised (knee-checked: worst white star ×(1+band_bright) + band glow +
 *  base < 2.05, unit-tested), tiers densified. band_boost: +band×boost on the existence hash ≡ a lower
 *  in-band threshold — stars CONCENTRATE along the band; band_bright: extra in-band brightness. */
export const STAR_TIERS = [
  { freq: 14, thresh: 0.98, bright: 1.7, radius: 0.13, twinkle: false, band_boost: 0.03, band_bright: 0 },
  { freq: 26, thresh: 0.93, bright: 1.5, radius: 0.12, twinkle: false, band_boost: 0.08, band_bright: 0.2 },
  { freq: 44, thresh: 0.82, bright: 1.2, radius: 0.13, twinkle: true, band_boost: 0.08, band_bright: 0.2 },
  { freq: 90, thresh: 0.986, bright: 0.6, radius: 0.3, twinkle: false, band_boost: 0.12, band_bright: 0 },
]
/** star temperature palette: cool blue-white → white → warm. */
export const STAR_COOL_RGB: Rgb = [0.72, 0.82, 1.0]
/** @type {import('./sky_node.js').Rgb} */
export const STAR_WARM_RGB: Rgb = [1.0, 0.86, 0.7]
/** rare faint RED GIANT — only the extreme hash tail (cfg.star_red_giant fraction) reaches it. */
export const STAR_RED_RGB: Rgb = [1.0, 0.55, 0.42]
/** stars fade to this fraction inside the full moon glow (never fully dead — the brightest survive). */
export const STAR_MOON_SUPPRESS = 0.85
/** horizon fade band on view elevation (haze eats stars near the horizon). Narrow (≈1-7°) — kept as the
 *  NEUTRAL-reference cutoff for milky way/nebula/stars; LIVE opts into the wider `horizon_fade` cfg below. */
export const STAR_HORIZON_FADE = [0.02, 0.12]
/** stars never fully vanish at the horizon under the wide `horizon_fade` ramp (below) — they only dim to this
 *  floor ("shouldn't vanish entirely"). Milky way / nebula fade all the way to 0 instead. */
export const STAR_HORIZON_FLOOR = 0.5

// ── milky way ────────────────────────────────────────────────────────────────────────────────────────
export const MW_INTENSITY = 0.075
export const MW_WIDTH = 0.16 // gaussian sigma on the band coordinate (≈9°)
/** @type {import('./sky_node.js').Rgb} */
export const MW_CORE_RGB: Rgb = [1.0, 0.9, 0.78]
export const MW_DUST_STRENGTH = 0.65
export const MW_MOON_HUMILITY = 0.6 // ×(1 − this·moonglow): humble near the moon, full on the far side

// ── planets ──────────────────────────────────────────────────────────────────────────────────────────
export const PLANET_TINTS: readonly Readonly<{ rgb: Rgb; intensity: number }>[] = [
  { rgb: [1.0, 0.82, 0.62], intensity: 1.7 }, // the warm one
  { rgb: [0.85, 0.92, 1.0], intensity: 1.3 }, // the pale one
]
export const PLANET_COS_OUTER = Math.cos(0.005)
export const PLANET_COS_INNER = Math.cos(0.002)
/** ring (option B's "space panel" Saturn): an in-band-plane annulus in the planet's disc-space uv. */
export const RING_INNER = 1.7 // ×disc radius
export const RING_OUTER = 2.9
export const RING_SQUASH = 0.32 // v-axis squash → the ring reads as a tilted ellipse
export const RING_RGB: Rgb = [0.9, 0.78, 0.55]
export const RING_INTENSITY = 0.9

// ── nebula (deep-space colour clouds — the "space exploration panel" layer; OFF at neutral) ─────────────
// A low-frequency fBm over the galactic frame, tinted across a deep blue→purple→orange palette, concentrated
// toward the band + a warm galactic-core pocket. CHROMA-dominant on purpose: deep saturated darks survive the
// AgX shoulder where luminance washes to grey (the whole "no colors" complaint). MEDIUM/HIGH only (reuses the
// milky-way frame q). intensity 0 ⇒ the node is SKIPPED entirely, so the shipped graph is byte-unchanged.
/** @type {import('./sky_node.js').Rgb} */
export const NEBULA_BLUE: Rgb = [0.06, 0.12, 0.34]
/** @type {import('./sky_node.js').Rgb} */
export const NEBULA_PURPLE: Rgb = [0.18, 0.07, 0.32]
/** @type {import('./sky_node.js').Rgb} */
export const NEBULA_ORANGE: Rgb = [0.6, 0.24, 0.06]

/**
 * The knobs the night-sky OPTIONS differ on. NEUTRAL = today's exact look (nebula off, every mult 1) so the
 * live game is unchanged until a look is picked; the pick lands as a config swap + a small follow-up. Every
 * scalar/array folds into a JS constant at build time ⇒ with NEUTRAL the TSL graph is identical to the
 * pre-config build (special-cased where a round-trip like acos∘cos could drift a constant).
 * @typedef {object} NightSkyCfg
 * @property {SkyPalette|null} base_palette deep dome gradient (nadir/horizon/zenith) when with_base; null = SKY_NIGHT
 * @property {number} star_thresh_shift additive existence-threshold shift (negative = denser stars)
 * @property {number} star_bright_mul brightness multiplier across all tiers
 * @property {number} mw_intensity milky-way band peak intensity
 * @property {Rgb} mw_rgb milky-way core colour
 * @property {number} mw_width gaussian sigma of the band (smaller = thinner/brighter)
 * @property {number} planet_scale multiplies each planet disc's angular radius
 * @property {number} planet_count how many of the 2 planets to draw (1 or 2)
 * @property {number} ringed_planet index of a Saturn-ringed planet, or -1
 * @property {number} [moon_glow_mul] scales ONLY the visible moonlit-sky wash (1 = full; lower = deeper night;
 *   star/nebula suppression + moon halo unchanged) — lets the deep-space colour read while the moon is up
 * @property {number} [star_cluster] 0 = off; >0 = low-freq CLUSTERING (constellation-like groupings + voids)
 * @property {number} [star_red_giant] 0 = off; >0 = fraction of the hash tail that goes faint RED giant
 * @property {{rgb:Rgb, amount:number}|null} [arcane_tint] faint global dome tint (the "arcane" wash)
 * @property {{start_deg:number, end_deg:number}|null} [horizon_fade] wide horizon-extinction ramp (
 *   2026-07-13: "the sky should not cut straight like this, it should go behind mountains") — milky-way band
 *   + nebula fade to 0 and stars dim to STAR_HORIZON_FLOOR across the elevation window from `start_deg`
 *   (fully visible) down to `end_deg` (fully extinct; 0 = the true horizon); zenith and everything above
 *   start_deg is untouched. Degrees, ascending (start_deg > end_deg — smoothstep's WGSL edge law). null = OFF:
 *   falls back to the old narrow STAR_HORIZON_FADE cutoff (NEUTRAL's byte-unchanged reference look).
 * @property {{intensity:number, along_band:number, orange_core:number, orange_core_k:number,
 *   blue:Rgb, purple:Rgb, orange:Rgb,
 *   regions?: {rgb:Rgb, k:number, gain:number}[]}} nebula the colour-cloud layer. `regions` (the VARIANT
 *   axis) paints N distinct-hue fields at seed-derived directions — each a directional falloff over the SHARED
 *   density fBm, so multiple hues cost ZERO extra noise. Empty ⇒ the single blue→purple hue-walk + orange core.
 * @typedef {import('./sky_node.js').SkyPalette} SkyPalette
 * @typedef {import('./sky_node.js').Rgb} Rgb
 */
/** @type {NightSkyCfg} */
export const NIGHT_SKY_NEUTRAL: NightSkyCfg = {
  base_palette: null, // read lazily as SKY_NIGHT at call time (circular-import safe — sky_node imports us)
  star_thresh_shift: 0,
  star_bright_mul: 1,
  mw_intensity: MW_INTENSITY,
  mw_rgb: MW_CORE_RGB,
  mw_width: MW_WIDTH,
  planet_scale: 1,
  planet_count: 2,
  ringed_planet: -1,
  moon_glow_mul: 1,
  star_cluster: 0,
  star_red_giant: 0,
  arcane_tint: null,
  horizon_fade: null,
  nebula: {
    intensity: 0,
    along_band: 0.7,
    orange_core: 0,
    orange_core_k: 4,
    blue: NEBULA_BLUE,
    purple: NEBULA_PURPLE,
    orange: NEBULA_ORANGE,
    regions: [],
  },
}

/**
 * THE LIVE night sky — the SHIPPED DEFAULT (pick "second one" = HYBRID_2, the
 * max-variant B×C hybrid). Near-black violet dome + THREE distinct-hue nebula regions (cold blue-violet /
 * warm amber-magenta / teal — the "more variant" axis, ZERO extra per-pixel noise), dense clustered stars
 * with red giants, a faint arcane wash, two planets one ringed. Ships ON by default (no-flags law: the
 * landed config IS the game). Star BRIGHTNESS held at the knee-safe baseline (star_bright_mul 1 — density +
 * clustering carry "more stars") without washing out the band palette. NIGHT_SKY_NEUTRAL above is retained
 * as the pre-pick reference.
 * @type {NightSkyCfg}
 */
export const NIGHT_SKY_LIVE: NightSkyCfg = {
  base_palette: { zenith: [0.004, 0.005, 0.017], horizon: [0.011, 0.011, 0.03], nadir: [0.004, 0.005, 0.015] },
  star_thresh_shift: -0.06,
  star_bright_mul: 1.0,
  star_cluster: 0.35,
  star_red_giant: 0.06,
  // in-engine tune (2026-07-13 ship gate): the Hillaire physical-sky night base washed the band
  // to a pale grey column, drowning the colour. Taming mw (0.18→0.10) kills the grey wash, and pushing
  // nebula (0.6→0.9) lets the blue/violet/amber dominate the pale base — the probe→engine fidelity gap fix.
  mw_intensity: 0.1,
  mw_rgb: [0.82, 0.8, 0.95],
  mw_width: 0.12,
  planet_scale: 3.2,
  planet_count: 2,
  ringed_planet: 0,
  moon_glow_mul: 0.3, // in-engine: the full moon-glow washed the deep colour grey; 0.3 keeps a gentle lift
  arcane_tint: { rgb: [0.04, 0.05, 0.08], amount: 0.012 },
  // HORIZON FADE (ship-gate rider: "curve a bit the horizon... it should go behind
  // mountains" — the band/nebula wash held full brightness right up to the mountain silhouette then cut hard
  // against it). 14°→0° sinks the last stretch of sky into the terrain line like real atmospheric extinction.
  horizon_fade: { start_deg: 14, end_deg: 0 },
  nebula: {
    intensity: 0.9,
    along_band: 0.35,
    orange_core: 1.1,
    orange_core_k: 3.5,
    blue: [0.06, 0.14, 0.32], // cold blue-violet
    purple: [0.26, 0.07, 0.34], // violet-magenta
    orange: [0.62, 0.24, 0.06], // ember core
    regions: [
      { rgb: [0.08, 0.06, 0.3], k: 2.0, gain: 0.8 }, // cold blue-violet field
      { rgb: [0.55, 0.14, 0.16], k: 2.8, gain: 0.9 }, // warm amber-magenta core
      { rgb: [0.04, 0.22, 0.22], k: 3.2, gain: 0.7 }, // teal wisp
    ],
  },
}

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} e0 @param {number} e1 @param {number} x @returns {number} Hermite smoothstep. */
const smoothf = (e0: number, e1: number, x: number): number => {
  const t = clampf((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** @param {number[]} a @param {number[]} b @returns {number[]} */
const cross3 = (a: Rgb, b: Rgb): Rgb => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** @param {number[]} a @returns {number[]} */
const norm3 = (a: Rgb): Rgb => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1e-9
  return [a[0] / l, a[1] / l, a[2] / l]
}

// ── pure JS twins (unit-tested; the TSL below mirrors them op-for-op) ────────────────────────────────

/** Night gate: 0 in daylight, 1 in deep night, GRADUAL through dusk. @param {number} sun_y @returns {number} */
export function night_gate_js(sun_y: number): number {
  return 1 - smoothf(NIGHT_GATE_LO, NIGHT_GATE_HI, sun_y)
}

/** Broad moon sky illumination shape (tint/intensity excluded) — boundary-free inverse-power falloff.
 *  @param {number} cos_vm view·moon @returns {number} in (0,1] */
export function moon_sky_glow_js(cos_vm: number): number {
  return 1 / (1 + MOON_SKY_GLOW_K * (1 - clampf(cos_vm, -1, 1))) ** MOON_SKY_GLOW_P
}

/** Near-disc halo shape (tint excluded) — rational spike + pow tail, boundary-free.
 *  @param {number} cos_vm view·moon @returns {number} */
export function moon_halo_js(cos_vm: number): number {
  const v = clampf(cos_vm, 0, 1)
  const v4 = v * v * v * v
  const spike = MOON_HALO_VIS / (1 - (1 - MOON_HALO_VIS) * v4) - MOON_HALO_VIS
  return spike * MOON_HALO_SPIKE_GAIN + v ** MOON_HALO_POW * MOON_HALO_TAIL_GAIN
}

/** Star visibility multiplier near the moon: 1 far away → (1−STAR_MOON_SUPPRESS) at the moon.
 *  @param {number} cos_vm @param {number} moon_up @returns {number} */
export function star_moon_fade_js(cos_vm: number, moon_up: number): number {
  return 1 - STAR_MOON_SUPPRESS * moon_sky_glow_js(cos_vm) * clampf(moon_up, 0, 1)
}

/** Horizon extinction ramp (pure twin of the TSL term in `create_night_sky_node`) — 0 at/below `end_deg`
 *  elevation, 1 at/above `start_deg`, smooth between. Takes the view direction's y component directly
 *  (≈ sin(elevation)) to match the file's sine-space convention (NIGHT_GATE_HI/LO, STAR_HORIZON_FADE) — the
 *  shader never needs an asin() node, degrees only convert the two edges (constants, folded once).
 *  @param {number} view_y view_dir.y  @param {{start_deg:number, end_deg:number}|null} [hf]  @returns {number}
 *    in [0,1]; always 1 when `hf` is null (the OFF/NEUTRAL case). */
export function horizon_fade_js(view_y: number, hf: HorizonFade | null = null): number {
  if (!hf) return 1
  const y_end = Math.sin((hf.end_deg * Math.PI) / 180)
  const y_start = Math.sin((hf.start_deg * Math.PI) / 180)
  return smoothf(y_end, y_start, view_y)
}

/**
 * @typedef {object} NightSkyParams
 * @property {number[]} galaxy_n unit galactic pole (band = great circle where dot(view,n)=0)
 * @property {number[]} galaxy_a unit in-band basis
 * @property {number[]} galaxy_b unit in-band basis (n×a)
 * @property {{a:number[], b:number[], phase:number, drift:number}[]} planets orbit bases (unit, ⟂), phase rad, drift rad/rad
 * @property {number} density_shift additive star-threshold shift (±0.02 — slight per-world density variance)
 * @property {number} lattice_offset per-world star-lattice decorrelation offset
 * @property {{dir:number[]}[]} regions 3 seed-placed nebula-region directions (cfg supplies each one's hue)
 */

/**
 * Derive the per-world night-sky parameter set from the world seed — pure, deterministic (FNV hash01).
 * @param {string|number} seed @returns {NightSkyParams}
 */
export function derive_night_sky_params(seed: string | number): NightSkyParams {
  const codes = typeof seed === 'number' ? [seed | 0] : [...String(seed)].map((c) => c.codePointAt(0) ?? 0)
  const h = (i: number): number => hash01(...codes, i)
  // galactic pole: uniform azimuth; elevation kept in |y| ≤ 0.72 so the band never degenerates into a
  // horizon ring (half-hidden) and cross(n, up) below never degenerates.
  const gy = (h(1) * 2 - 1) * 0.72
  const gaz = h(2) * Math.PI * 2
  const gr = Math.sqrt(Math.max(0, 1 - gy * gy))
  const galaxy_n: Rgb = [gr * Math.cos(gaz), gy, gr * Math.sin(gaz)]
  const galaxy_a = norm3(cross3(galaxy_n, [0, 1, 0]))
  const galaxy_b = cross3(galaxy_n, galaxy_a)
  // planets: each orbits a great circle tilted off the galactic plane by its own hash.
  const planets = [0, 1].map((i) => {
    const tilt = 0.25 + 0.5 * h(10 + i)
    const n_i = norm3([
      galaxy_n[0] + tilt * galaxy_a[0],
      galaxy_n[1] + tilt * galaxy_a[1],
      galaxy_n[2] + tilt * galaxy_a[2],
    ])
    const up: Rgb = Math.abs(n_i[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const a = norm3(cross3(n_i, up))
    const b = cross3(n_i, a)
    return { a, b, phase: h(12 + i) * Math.PI * 2, drift: 0.04 + 0.04 * h(14 + i) }
  })
  // nebula regions: 3 directions along the band at spread in-band angles, each lifted off the plane by its own
  // hash so the fields sit at DIFFERENT points of the sky (the "multiple distinct regions" variant axis).
  const regions = [0, 1, 2].map((i) => {
    const ang = (i / 3) * Math.PI * 2 + h(20 + i) * 1.2
    const lift = (h(23 + i) - 0.5) * 0.7
    const d = norm3([
      galaxy_a[0] * Math.cos(ang) + galaxy_b[0] * Math.sin(ang) + galaxy_n[0] * lift,
      galaxy_a[1] * Math.cos(ang) + galaxy_b[1] * Math.sin(ang) + galaxy_n[1] * lift,
      galaxy_a[2] * Math.cos(ang) + galaxy_b[2] * Math.sin(ang) + galaxy_n[2] * lift,
    ])
    return { dir: d }
  })
  return {
    galaxy_n,
    galaxy_a,
    galaxy_b,
    planets,
    regions,
    density_shift: (h(7) - 0.5) * 0.04,
    lattice_offset: Math.floor(h(8) * 512),
  }
}

/**
 * Planet world direction at a given sun azimuth (the tod drift signal) — pure twin of the tick below.
 * @param {NightSkyParams['planets'][0]} p @param {number} sun_az radians @returns {number[]} unit dir
 */
export function planet_dir_js(p: Orbit, sun_az: number): Rgb {
  const th = p.phase + sun_az * p.drift
  const c = Math.cos(th)
  const s = Math.sin(th)
  return norm3([p.a[0] * c + p.b[0] * s, p.a[1] * c + p.b[1] * s, p.a[2] * c + p.b[2] * s])
}

/**
 * Build the night-sky ADD node for a sky background + its per-frame CPU tick (planet drift).
 * @param {object} opts
 * @param {string|number} [opts.seed] world seed (defaults to the master seed)
 * @param {*} opts.sun_dir vec3 node/uniform — the shared world sun direction (moon = its antipode)
 * @param {*} opts.view_dir vec3 node — normalized world view direction
 * @param {boolean} [opts.with_base] add the deep blue-grey night gradient (hillaire: yes — its LUT sky is
 *   black at night; LOW analytic: no — SKY_NIGHT palette already paints it)
 * @param {boolean} [opts.with_milky_way] add the galactic band (MEDIUM/HIGH; LOW skips — tier budget)
 * @param {NightSkyCfg} [opts.cfg] the option knobs — NEUTRAL (today's look) unless a variant has been picked
 * @returns {{ node: *, tick: (sun_dir: {x:number,y:number,z:number}) => void, params: NightSkyParams }}
 */
export function create_night_sky_node({
  seed = 'aresrpg',
  sun_dir,
  view_dir,
  with_base = false,
  with_milky_way = false,
  cfg = NIGHT_SKY_LIVE,
}: Readonly<{
  seed?: string | number
  sun_dir: Node<'vec3'>
  view_dir: Node<'vec3'>
  with_base?: boolean
  with_milky_way?: boolean
  cfg?: NightSkyCfg
}>) {
  const P = derive_night_sky_params(seed)
  const c3 = (c: Rgb): Node<'vec3'> => vec3(c[0], c[1], c[2])

  // NOTE: smoothstep edges must be ASCENDING (edge0>edge1 is UB in WGSL) — invert via oneMinus.
  const night_f = float(1).sub(smoothstep(float(NIGHT_GATE_LO), float(NIGHT_GATE_HI), sun_dir.y))
  const moon_dir = sun_dir.mul(-1)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1)
  const cos_vm = view_dir.dot(moon_dir)
  const view_up = clamp(view_dir.y, 0, 1)
  // the moon body OCCLUDES stars/planets/milky-way (physically right, and it hard-bounds the worst-case
  // luminance: a planet in conjunction can never stack its radiance on top of the disc+halo peak).
  const moon_occ = float(1).sub(smoothstep(float(MOON_DISC_COS), float(MOON_DISC_INNER_COS), cos_vm).mul(moon_up))

  // ── moon atmosphere: broad sky glow (+ horizon lift) + boundary-free near halo ────────────────────
  const glow_shape = float(1).div(
    pow(float(1).add(float(MOON_SKY_GLOW_K).mul(float(1).sub(cos_vm))), float(MOON_SKY_GLOW_P))
  )
  const glow_norm = glow_shape.mul(moon_up) // ALSO the star/milky-way suppression field
  const horizon_lift = float(1).add(float(MOON_HORIZON_LIFT).mul(float(1).sub(view_up)))
  const sky_glow = c3(MOON_SKY_GLOW_RGB).mul(glow_norm.mul(MOON_SKY_GLOW * (cfg.moon_glow_mul ?? 1)).mul(horizon_lift))
  const vm = clamp(cos_vm, 0, 1)
  const vm4 = vm.mul(vm).mul(vm).mul(vm)
  const halo_spike = float(MOON_HALO_VIS)
    .div(vm4.mul(-(1 - MOON_HALO_VIS)).add(1))
    .sub(float(MOON_HALO_VIS))
  const halo = c3(MOON_DISC_RGB).mul(
    halo_spike
      .mul(MOON_HALO_SPIKE_GAIN)
      .add(pow(vm, float(MOON_HALO_POW)).mul(MOON_HALO_TAIL_GAIN))
      .mul(moon_up)
  )

  // ── horizon extinction: additive night content sinks into the terrain silhouette across the LAST
  // stretch of elevation instead of cutting hard against the mountain line ("the sky
  // should not cut straight like this, it should go behind mountains"). Reuses view_dir.y — the SAME
  // elevation basis both the LOW analytic (sky_node.js) and MEDIUM/HIGH hillaire tiers already pass in as
  // `view_dir` (no new node/uniform/pass — one extra smoothstep). Degrees fold to view_dir.y's sine-space
  // ONCE in JS (matches NIGHT_GATE_HI/LO / STAR_HORIZON_FADE's convention — no asin() node in the shader).
  const hf = cfg.horizon_fade
    ? smoothstep(
        float(Math.sin((cfg.horizon_fade.end_deg * Math.PI) / 180)),
        float(Math.sin((cfg.horizon_fade.start_deg * Math.PI) / 180)),
        view_dir.y
      )
    : null
  // the OLD narrow cutoff — kept for planets (out of this fix's scope) and as the `hf`-off fallback so
  // NEUTRAL's graph stays byte-unchanged.
  const old_horizon_cut = smoothstep(float(STAR_HORIZON_FADE[0]), float(STAR_HORIZON_FADE[1]), view_dir.y)
  const ext_band = hf ?? old_horizon_cut // milky way + nebula: fade all the way to 0 at the horizon
  const ext_star = hf ? mix(float(STAR_HORIZON_FLOOR), float(1), hf) : old_horizon_cut // stars: floor at 50%

  // ── night base gradient (hillaire only): SKY_NIGHT palette, zenith darker ─────────────────────────
  const base_pal = cfg.base_palette ?? SKY_NIGHT
  let base: Node<'vec3'> = with_base
    ? mix(
        mix(c3(base_pal.nadir), c3(base_pal.horizon), smoothstep(-0.35, 0.0, view_dir.y)),
        c3(base_pal.zenith),
        smoothstep(0.0, 0.55, view_dir.y)
      )
    : vec3(0, 0, 0)
  // faint global ARCANE tint (esoteric axis) — a low, mystical dome wash; gated OFF at neutral.
  if (with_base && cfg.arcane_tint) base = base.add(c3(cfg.arcane_tint.rgb).mul(cfg.arcane_tint.amount))

  // ── milky-way band factor — computed BEFORE the stars so the lattice can densify inside it ────────
  // (band = 0 node when the band is off ⇒ LOW's star field is untouched by the coupling terms).
  const q = with_milky_way
    ? vec3(view_dir.dot(c3(P.galaxy_a)), view_dir.dot(c3(P.galaxy_b)), view_dir.dot(c3(P.galaxy_n)))
    : null
  const band_coordinate = q ? q.z.div(cfg.mw_width) : float(0)
  const band = q ? exp(band_coordinate.mul(band_coordinate).negate()) : float(0)

  // ── stars: 3 hashed-cell tiers (Overdraw kernel), tint + twinkle + fades + band densification ─────
  const star_fade = float(1).sub(glow_norm.mul(STAR_MOON_SUPPRESS)).mul(ext_star)
  // constellation CLUSTERING (esoteric axis): ONE low-freq field (not per-tier — zero extra noise per tier)
  // modulates star presence into groupings + voids. Gated OFF at neutral (no eval, graph unchanged).
  const cluster_gate =
    /** @type {number} */ cfg.star_cluster > 0
      ? mix(
          float(1),
          smoothstep(0.34, 0.76, mx_fractal_noise_float(view_dir.mul(1.5), 2, float(2), float(0.5)).mul(0.5).add(0.5)),
          float(/** @type {number} */ cfg.star_cluster)
        )
      : null
  let stars: Node<'vec3'> = vec3(0, 0, 0)
  for (const tier of STAR_TIERS) {
    const p = view_dir.mul(tier.freq)
    const off = 200 + P.lattice_offset // per-world lattice decorrelation
    const cell = floor(p).add(vec3(off, off, off))
    const f = fract(p).sub(0.5)
    // per-cell scalar seed → 4 decorrelated PCG hashes (three/tsl `hash` — pcg-random.org via XlGcRh).
    const s = cell.dot(vec3(127.1, 311.7, 74.7))
    const h_exist = hash(s)
    const h_ox = hash(s.add(19.19))
    const h_oy = hash(s.add(47.47))
    const h_oz = hash(s.add(73.73))
    const h_tint = hash(s.add(101.7))
    const o = vec3(h_ox, h_oy, h_oz).sub(0.5).mul(0.7)
    // Overdraw anti-clip: the star's radius shrinks with its offset so it never crosses the cell border.
    const r = float(tier.radius).mul(float(1).sub(length(o).mul(0.8)))
    const d = length(f.sub(o))
    const core = clamp(float(1).sub(d.div(r)), 0, 1)
    // in-band densification: +band×band_boost on the hash ≡ a lower threshold where the band runs.
    const t0 = tier.thresh + P.density_shift + cfg.star_thresh_shift
    const exists = smoothstep(float(t0), float(t0 + 0.004), h_exist.add(band.mul(tier.band_boost)))
    const temp2 = h_tint.mul(2)
    let tint: Node<'vec3'> = mix(
      mix(c3(STAR_COOL_RGB), vec3(1, 1, 1), clamp(temp2, 0, 1)),
      c3(STAR_WARM_RGB),
      clamp(temp2.sub(1), 0, 1)
    )
    // faint RED GIANTS in the extreme hash tail (variant axis) — gated OFF at neutral.
    if (/** @type {number} */ cfg.star_red_giant > 0) {
      const rg = /** @type {number} */ cfg.star_red_giant
      tint = mix(tint, c3(STAR_RED_RGB), smoothstep(float(1 - rg), float(1 - rg * 0.4), h_tint))
    }
    const twinkle = tier.twinkle
      ? float(0.72).add(float(0.28).mul(sin(time.mul(h_ox.mul(2.5).add(1.5)).add(h_oy.mul(6.283)))))
      : float(1)
    const band_bright = float(1).add(band.mul(tier.band_bright))
    const bright = tier.bright * cfg.star_bright_mul
    let contrib: Node<'float'> = core.mul(core).mul(exists).mul(bright).mul(twinkle).mul(band_bright)
    if (cluster_gate) contrib = contrib.mul(cluster_gate)
    stars = stars.add(tint.mul(contrib))
  }
  stars = stars.mul(star_fade).mul(moon_occ)

  // ── milky way glow underlay: the band × wispy fBm × dust lanes (the stars above are its body) ─────
  let milky_way: Node<'vec3'> = vec3(0, 0, 0)
  if (q) {
    // ANISOTROPIC noise frame: low frequency ALONG the band (x,y — the in-plane pair), high ACROSS (z) —
    // wisps stretch into flowing streaks along the band instead of an isotropic smoke column
    // (capture-proven: the isotropic q·3.0 read as a vertical cloud, not a galaxy).
    const qa = vec3(q.x.mul(2.2), q.y.mul(2.2), q.z.mul(6.0))
    const wisp = mx_fractal_noise_float(qa, 3, float(2.2), float(0.55)).mul(0.5).add(0.5)
    const dust = smoothstep(
      float(0.35),
      float(0.65),
      mx_fractal_noise_float(qa.mul(0.55).add(31.7), 2, float(2.0), float(0.5)).mul(0.5).add(0.5)
    )
    const lane = exp(
      band_coordinate
        .mul(band_coordinate)
        .div(0.55 * 0.55)
        .negate()
    )
    milky_way = c3(cfg.mw_rgb)
      .mul(band.mul(wisp.mul(0.6).add(0.4)).mul(float(1).sub(dust.mul(MW_DUST_STRENGTH).mul(lane))))
      .mul(cfg.mw_intensity)
      .mul(float(1).sub(glow_norm.mul(MW_MOON_HUMILITY)))
      .mul(ext_band)
      .mul(moon_occ)
  }

  // ── nebula: deep-space colour clouds (OFF at neutral — built only when picked). Reuses the galactic
  // frame q, so it rides the same band the milky way does. Two decorrelated low-freq fBm channels shape
  // density + hue; the hue walks blue→purple, and a seed-fixed in-band "galactic core" adds the warm
  // orange pocket. All the same fades as the milky way (moon humility / horizon / occlusion). ────────────
  let nebula: Node<'vec3'> | null = null
  if (q && cfg.nebula.intensity > 0) {
    const nb = cfg.nebula
    const nf = vec3(q.x.mul(1.3), q.y.mul(1.3), q.z.mul(2.6))
    const dens = mx_fractal_noise_float(nf, 3, float(2.0), float(0.55)).mul(0.5).add(0.5)
    const hue = mx_fractal_noise_float(nf.mul(0.6).add(17.3), 2, float(2.0), float(0.5)).mul(0.5).add(0.5)
    const band_conc = mix(float(1), band, float(nb.along_band)) // 0 = whole-dome haze, 1 = hugs the band
    // orange galactic core: a warm glow around galaxy_a (a fixed point on the band), exp falloff.
    const core = exp(
      float(1)
        .sub(view_dir.dot(c3(P.galaxy_a)))
        .mul(-nb.orange_core_k)
    ).mul(nb.orange_core)
    let tint: Node<'vec3'> = mix(
      mix(c3(nb.blue), c3(nb.purple), clamp(hue.mul(1.6), 0, 1)),
      c3(nb.orange),
      clamp(core, 0, 1)
    )
    // VARIANT axis: N seed-placed distinct-hue regions — each a cheap DIRECTIONAL falloff (dot+exp, ZERO extra
    // noise) blended over the shared density field, so a cold blue-violet field one way and a warm amber core
    // another read as different regions of the same sky.
    const regions = nb.regions ?? []
    for (let i = 0; i < regions.length && i < P.regions.length; i += 1) {
      const w = exp(
        float(1)
          .sub(view_dir.dot(c3(P.regions[i].dir)))
          .mul(-regions[i].k)
      ).mul(regions[i].gain)
      tint = mix(tint, c3(regions[i].rgb), clamp(w, 0, 1))
    }
    nebula = tint
      .mul(dens.mul(dens))
      .mul(band_conc)
      .mul(nb.intensity)
      .mul(float(1).sub(glow_norm.mul(MW_MOON_HUMILITY)))
      .mul(ext_band)
      .mul(moon_occ)
  }

  // ── planets: CPU-ticked discs (non-twinkling; mildly humble near the moon). planet_scale grows the
  // disc, planet_count draws 1 or both, ringed_planet gets a tilted Saturn annulus in disc-space uv. ─────
  const one = cfg.planet_scale === 1 // byte-safe: avoid an acos∘cos round-trip drifting the neutral constant
  const p_outer = one ? PLANET_COS_OUTER : Math.cos(Math.acos(PLANET_COS_OUTER) * cfg.planet_scale)
  const p_inner = one ? PLANET_COS_INNER : Math.cos(Math.acos(PLANET_COS_INNER) * cfg.planet_scale)
  const p_ang = Math.acos(p_outer) // planet disc angular radius (rad) — the ring uv normalizer
  const u_planets = P.planets.map((p) => uniform(new Vector3().fromArray(planet_dir_js(p, 0))))
  let planets: Node<'vec3'> = vec3(0, 0, 0)
  const n_planets = Math.max(0, Math.min(cfg.planet_count, u_planets.length))
  for (let i = 0; i < n_planets; i += 1) {
    const disc = smoothstep(float(p_outer), float(p_inner), view_dir.dot(u_planets[i]))
    planets = planets.add(c3(PLANET_TINTS[i].rgb).mul(disc.mul(PLANET_TINTS[i].intensity)))
    if (i === cfg.ringed_planet) {
      const ruv = disc_space_uv(view_dir, u_planets[i]).div(p_ang)
      const ry = ruv.y.div(RING_SQUASH)
      const e = ruv.x.mul(ruv.x).add(ry.mul(ry)).sqrt() // elliptical disc-space radius (edge-on ring)
      const ring = smoothstep(float(RING_INNER), float(RING_INNER + 0.2), e).mul(
        float(1).sub(smoothstep(float(RING_OUTER - 0.2), float(RING_OUTER), e))
      )
      planets = planets.add(c3(RING_RGB).mul(ring.mul(RING_INTENSITY)))
    }
  }
  planets = planets
    .mul(float(1).sub(glow_norm.mul(0.4)))
    .mul(old_horizon_cut) // unchanged (out of this fix's scope) — planets keep the old narrow cutoff
    .mul(moon_occ)

  // neutral: nebula is null ⇒ the add is skipped ⇒ the shipped graph is unchanged.
  let sky_add: Node<'vec3'> = base.add(sky_glow).add(halo).add(stars).add(milky_way)
  if (nebula) sky_add = sky_add.add(nebula)
  const node = sky_add.add(planets).mul(night_f)

  /** per-frame planet drift — CPU (Math.atan2 of the live sun dir; deterministic per tod).
   *  @param {{x:number,y:number,z:number}} sd */
  const tick = (sd: Readonly<{ x: number; y: number; z: number }>): void => {
    const az = Math.atan2(sd.x, sd.z)
    for (let i = 0; i < u_planets.length; i += 1) u_planets[i].value.fromArray(planet_dir_js(P.planets[i], az))
  }

  return { node, tick, params: P }
}
