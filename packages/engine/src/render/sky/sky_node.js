// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG2-A analytic sky KEYSTONE (playbook §3, TL;DR #1) — ONE function of (view·up, view·sun)
// that clouds, fog color, and water sky-miss ALL sample. Zero physical scattering: a 3-color
// vertical mix + a hand-fit rational sun-glare halo + a dusk warmth ramp, parameterized by a
// `time_of_day` uniform in [0,1) (the §6.1 15min-day / 5min-night cycle drives this later).
//
// This is DELIBERATELY NOT the demo's Hillaire 4-LUT `Atmosphere.ts` (playbook DO-NOT #14/#15:
// the analytic form is cheaper AND more painterly-accurate for the reference vistas). We steal the
// LOOK from that lineage — humid/luminous horizon (never a black void below it), mie-boosted warm
// halo, warm-white→orange sun tint across the day, cool-zenith palette — but re-derive the whole
// structure analytically. Portions of the LOOK adapted from fable5-world-demo, MIT,
// Copyright (c) 2026 Remi Sebastian Kits.
//
// SINGLE SOURCE OF TRUTH: `sample_sky_rgb()` is the pure-JS reference (unit-tested for
// monotonicity + dusk warmth); the TSL `create_sky_node()` mirrors it op-for-op against the SAME
// exported palette/halo constants, so the shipped shader and the tested math cannot drift.

import { NoColorSpace, Texture, TextureLoader } from 'three'
import { clamp, mix, positionWorldDirection, pow, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl'

import MOON_TEX_URL from '../../../assets/moon.png?url' // real photographic moon disc (see moon_texture() below)

import { DAY_FRAC, sun_dir_from_tod } from './celestial_motion.js'
import { create_night_sky_node } from './night_sky.js'

export { DAY_FRAC, sun_dir_from_tod } from './celestial_motion.js'

/**
 * @typedef {[number, number, number]} Rgb
 * @typedef {{ zenith: Rgb, horizon: Rgb, nadir: Rgb }} SkyPalette
 */

// --- palette keyframes (shared by JS reference AND the TSL node) ---------------------------------
// Each palette is 3 vertical stops mixed by dot(view, up): nadir (below horizon, kept luminous so
// distant terrain dissolves to haze not black — the demo's ground-bounce trick), horizon (hazy
// mid band), zenith (upper dome). Tones lifted from the demo's humid look.

/** clear-day palette — cool blue dome, hazy pale horizon. @type {SkyPalette} */
// CO-TUNE 2026-07-03 (Conquest day-mood): the shipped day palette was the noon WASH lifter — its
// pale horizon [0.62,0.74,0.9] feeds THREE.Fog color + froxel ambient + water reflection + sky bg,
// so the whole day frame floated milky (noon vista luma 162 vs Conquest refs 57-65). Darkened ~40%
// and de-paled toward a deeper, more saturated cobalt so far terrain dissolves into moody blue-grey,
// not white. DUSK is untouched (SKY_DUSK) — only the DAY leg moves. Prev: zenith[0.18,0.42,0.82]
// horizon[0.62,0.74,0.9] nadir[0.42,0.48,0.55].
// ENG-12 (2026-07-03 — target: a brighter sky with blue distant haze): the day dome was lifted
// ~15% and shifted BLUER (zenith [0.08,0.20,0.44]→[0.10,0.24,0.52], horizon [0.28,0.37,0.50]→
// [0.31,0.42,0.62]) so the sky reads brighter/airier AND distant ranges haze toward a cool blue (the
// Hodilton alpine ref). SKY_DAY feeds 4 paths — sky bg, THREE.Fog color, froxel ambient, water sky-miss;
// the horizon stop IS the shared aerial-haze hue (renderer.js sky_horizon_color + far_field), so bluing
// it blues the DISTANT terrain silhouettes for free (the brief's "small knob change, shared tint"). The
// lift brightens the DOME + a touch of aerial haze while terrain surface exposure (AgX/grade) is
// UNCHANGED. Noon-vista luma drifts ~142→~150 (142 RELAXED for the sky dome, by design). nadir kept.
export const SKY_DAY = {
  zenith: [0.1, 0.24, 0.52],
  horizon: [0.31, 0.42, 0.62],
  nadir: [0.19, 0.24, 0.31],
}
/** dusk/dawn palette — deepening blue dome, warm-orange horizon (the warmth ramp). @type {SkyPalette} */
export const SKY_DUSK = {
  zenith: [0.16, 0.22, 0.42],
  horizon: [0.92, 0.52, 0.28],
  nadir: [0.3, 0.2, 0.22],
}
/** night palette — near-black, faint blue horizon glow. @type {SkyPalette} */
export const SKY_NIGHT = {
  zenith: [0.02, 0.03, 0.07],
  horizon: [0.05, 0.07, 0.13],
  nadir: [0.02, 0.02, 0.04],
}

/** warm-white sun tint at day (transmittance-through-clean-air look). @type {Rgb} */
export const SUN_TINT_DAY = [1.0, 0.96, 0.9]
/** deep-orange sun tint at dusk (reddened by the long horizon path). @type {Rgb} */
export const SUN_TINT_DUSK = [1.0, 0.5, 0.24]

// --- sun-halo hand-fit constants (playbook §3.1 glare curve) -------------------------------------
/** base visibility floor of the rational glare `vis/(1−(1−vis)·VdotS⁴) − vis`. */
export const GLARE_VIS = 0.0016
/** scale of the sharp glare halo. */
export const GLARE_STRENGTH = 12.0
/** exponent of the broader Mie-ish forward glow `pow(VdotS, MIE_POW)`. */
export const MIE_POW = 8.0
/** scale of the broad Mie glow. ENG-12 (2026-07-03 — target: sun powerfully creating rays): 0.35→0.55 so
 *  the sun's forward glow reads POWERFUL and, with the new bloom pass, blooms into a cinematic halo. The
 *  glow is a tight forward lobe (pow(VdotS,8)) around the sun disc, so it barely touches the fog/ambient
 *  tints (those sample AWAY from the sun) — the brightness lands on the sun, not a global wash. */
export const MIE_STRENGTH = 0.55
/** cos of the visible sun-disc angular radius (oversized ~3× for game readability). */
export const SUN_DISC_COS = Math.cos(0.02)
/** peak radiance of the sun disc added in the background node. */
export const SUN_DISC_INTENSITY = 40.0

// --- moon (the night body — a moon replacing the sun for a soft blue-grey night light) ---------
/** cos of the moon-disc angular radius (a touch larger than the sun so the night body reads clearly). */
export const MOON_DISC_COS = Math.cos(0.026)
/** cool white-grey moon body colour (linear) — soft, never a warm "second sun". Shared with hillaire_sky.
 *  @type {Rgb} */
export const MOON_DISC_RGB = [0.78, 0.85, 1.0]
/** peak radiance of the night moon disc — kept SOFT (well under the sun) so it reads as a calm night body,
 *  not a second sun; on the bloom tier its emission sits below the knee so the moon never bloom-blows-out. */
export const MOON_DISC_INTENSITY = 1.6

// --- moon SOFT EDGE + HALO shape (shared by LOW here and HIGH/MEDIUM hillaire_sky.js — ONE home so the
// two tiers cannot drift). Target: a moon with a nice texture and soft rays like
// the sun, not just an ugly circle alone — the flat disc + uniform blur this replaces.
/** angular radius of the moon disc (radians) — derived from MOON_DISC_COS, the disc-space UV normalizer. */
export const MOON_ANGULAR_RADIUS = Math.acos(MOON_DISC_COS)
/** inner cos where the disc reaches full brightness — a soft rim band from MOON_DISC_COS → here (kills the
 *  hard-edge "flat circle" read; mirrors the sun's SUN_DISC_INNER_COS idiom). */
export const MOON_DISC_INNER_COS = Math.cos(0.017)
/** limb darkening: the disc rim dims to this fraction of centre (mirrors the sun's SUN_LIMB_EDGE idiom). */
export const MOON_LIMB_EDGE = 0.7
// [2026-07-12 round 2] the windowed corona (MOON_CORONA_*) is DEAD — its visible boundary on the black
// night sky read as a "lamp", the same disease the sun's windowed corona had. The moon's halo
// + the broad sky illumination now live in night_sky.js as BOUNDARY-FREE kernels shared by both tiers.

// --- moon SURFACE TEXTURE (maria/crater mottling) — a real photographic disc, shared by both tiers (ONE
// home so they cannot drift). 2026-07-13 (target: a better moon texture, optimized, faded):
// replaces the old procedural fractal-noise mottling with `assets/moon.png` (NASA/GSFC/Arizona State
// University LROC WAC nearside mosaic, Dec 2010, public domain) — grayscale, 512×512, contrast-lifted
// (so maria/highland separation survives the AgX shoulder — see hillaire_sky.test.js's moon-cap test) +
// requantized for size (~102KB). The source disc is INSCRIBED edge-to-edge in its square (tangent to all 4
// sides), matching disc_space_uv's own normalized rim exactly — `moon_uv` below maps [-1,1]→[0,1] with zero
// reprojection math (the moon never shows a phase or rotates here — see disc_space_uv's header comment).
/** @type {Texture | null} module-cached singleton — built once, shared by sky_node + hillaire_sky. */
let _moon_tex = null
/**
 * Lazy-loaded moon disc texture. Real load browser-side; a bare unloaded `Texture` headlessly (bun:test/tsc
 * have no `document`/`Image`, so `TextureLoader.load()` throws there — probed directly: a bare `Texture`
 * still builds a valid TSL `texture()` node graph with zero GPU/DOM, matching board_vfx.js's
 * `typeof document === 'undefined'` headless-guard idiom). Sampled with `NoColorSpace` (the raw stored byte
 * IS the linear multiplier — same reasoning as vfx_pack_shaders2.js's leaf_texture: an sRGB decode would
 * crush the gamma-lifted contrast back down). @returns {Texture}
 */
export function moon_texture() {
  if (_moon_tex) return _moon_tex
  if (typeof document === 'undefined') {
    _moon_tex = new Texture() // headless stand-in — never sampled without a real GPU/DOM
    return _moon_tex
  }
  _moon_tex = new TextureLoader().load(MOON_TEX_URL)
  _moon_tex.colorSpace = NoColorSpace
  return _moon_tex
}

// --- pure math helpers (backend-free; the TSL node mirrors these) ---------------------------------

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} x @returns {number} clamp to [0,1] */
const saturate = (x) => clampf(x, 0, 1)
/**
 * Hermite smoothstep matching TSL `smoothstep(e0,e1,x)`.
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number}
 */
const smooth = (e0, e1, x) => {
  const t = saturate((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
/** @param {Rgb} a @param {Rgb} b @param {number} t @returns {Rgb} component lerp */
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** @param {Rgb} c @returns {number} Rec.709 luminance — used by tests and grading. */
export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** @param {Rgb} a @param {Rgb} b @returns {Rgb} cross product */
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
/** @param {Rgb} a @param {Rgb} b @returns {number} dot product */
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** @param {Rgb} a @returns {Rgb} unit vector (safe on a near-zero input) */
const norm3 = (a) => {
  const l = Math.sqrt(dot3(a, a)) || 1e-6
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * Pure-JS mirror of `disc_space_uv` (unit-tested; the TSL version must match op-for-op). A stable
 * disc-local 2D coordinate for a body at `body_dir`, sampled along `view_dir` — built ONLY from `body_dir`
 * + a FIXED world-up reference (never a camera basis), so the coordinate is glued to the BODY: the camera
 * changes which world `view_dir` lands on a given screen pixel, but never how a given world `view_dir`
 * maps to uv — so a noise pattern keyed off this uv reads as painted on the body, never swimming with the
 * screen. Raw magnitude ≈ the angular offset in radians for small angles; callers normalize by the body's
 * own angular radius. ASSUMES `body_dir.y` stays away from ±1 (the celestial small-circle orbit does) so
 * the world-up reference never degenerates.
 * @param {Rgb} view_dir unit [x,y,z] @param {Rgb} body_dir unit [x,y,z] @returns {[number, number]}
 */
export function disc_space_uv_js(view_dir, body_dir) {
  const tangent_u = norm3(cross3([0, 1, 0], body_dir))
  const tangent_v = cross3(body_dir, tangent_u)
  return [dot3(view_dir, tangent_u), dot3(view_dir, tangent_v)]
}

/**
 * TSL mirror of `disc_space_uv_js` — identical steps, node ops.
 * @param {*} view_dir vec3 node (unit) @param {*} body_dir vec3 node (unit) @returns {*} vec2 node
 */
export function disc_space_uv(view_dir, body_dir) {
  const tangent_u = vec3(0, 1, 0).cross(body_dir).normalize()
  const tangent_v = body_dir.cross(tangent_u)
  return vec2(view_dir.dot(tangent_u), view_dir.dot(tangent_v))
}

/**
 * Blend the three palettes by the sun's elevation (its y). Night → dusk as the sun nears the
 * horizon → clear day as it climbs. This is the whole time-of-day color story in one line each.
 * @param {number} sun_y sun direction y (elevation sine), roughly [-0.5, 0.98]
 * @returns {SkyPalette}
 */
export function palette_for_sun(sun_y) {
  const to_dusk = smooth(-0.18, -0.02, sun_y)
  const to_day = smooth(-0.02, 0.22, sun_y)
  /** @param {keyof SkyPalette} k @returns {Rgb} */
  const stop = (k) => mix3(mix3(SKY_NIGHT[k], SKY_DUSK[k], to_dusk), SKY_DAY[k], to_day)
  return { zenith: stop('zenith'), horizon: stop('horizon'), nadir: stop('nadir') }
}

/**
 * Sun tint reddening: warm-white by day, deep orange at dusk/dawn.
 * @param {number} sun_y @returns {Rgb}
 */
export function sun_tint_for(sun_y) {
  return mix3(SUN_TINT_DUSK, SUN_TINT_DAY, smooth(-0.02, 0.25, sun_y))
}

/**
 * THE reference sky function. Analytic radiance for a view direction given the sun direction —
 * `GetSky(dot(view,up), dot(view,sun))` in the playbook's terms. HDR: lower-clamped at 0, no upper
 * clamp (bloom/tonemap consume the halo peak downstream).
 * @param {Rgb} view unit view direction (world)
 * @param {Rgb} sun unit sun direction (world)
 * @returns {Rgb} linear radiance
 */
export function sample_sky_rgb(view, sun) {
  const [, cos_up] = view
  const cos_sun = view[0] * sun[0] + view[1] * sun[1] + view[2] * sun[2]
  const pal = palette_for_sun(sun[1])

  // vertical gradient: nadir → horizon (up through the lower hemisphere) → zenith (upper dome).
  let sky = mix3(pal.nadir, pal.horizon, smooth(-0.35, 0.0, cos_up))
  sky = mix3(sky, pal.zenith, smooth(0.0, 0.55, cos_up))

  // sun halo: sharp rational glare + broad Mie glow, warm-tinted, faded when the sun is down.
  const vdots = saturate(cos_sun)
  const vdots4 = vdots * vdots * vdots * vdots
  const glare = GLARE_VIS / (1 - (1 - GLARE_VIS) * vdots4) - GLARE_VIS
  const halo_amt = glare * GLARE_STRENGTH + Math.pow(vdots, MIE_POW) * MIE_STRENGTH
  const sun_up = saturate((sun[1] + 0.1) / 0.2)
  const tint = sun_tint_for(sun[1])
  const a = halo_amt * sun_up
  return [Math.max(0, sky[0] + tint[0] * a), Math.max(0, sky[1] + tint[1] * a), Math.max(0, sky[2] + tint[2] * a)]
}

// --- TSL node factory ----------------------------------------------------------------------------

/**
 * The sky node result the wiring wave mounts.
 * @typedef {object} SkyNode
 * @property {*} time_of_day `uniform(float)` in [0,1) — the public time knob.
 * @property {*} sun_direction `uniform(vec3)` — derived from tod; clouds/froxels/water read THIS.
 * @property {(dir:*)=>*} sample_sky vec3-node sky radiance for a direction node (the shared miss/fog/ambient hook).
 * @property {(dir:*)=>*} sample_sky_dome sky WITHOUT the sun glare/mie halo — for mirrors (water), where the
 *   reflected halo reads as a giant smooth spotlight; the sun's reflection belongs to the surface's own model.
 * @property {*} background_node vec3 node for `scene.backgroundNode` (sky + sun disc).
 * @property {(tod:number)=>void} set_time_of_day advance the cycle: updates both uniforms from one call.
 */

/**
 * Build the analytic sky node. Mirrors `sample_sky_rgb` exactly, reading the palette/halo constants
 * above. GPU behavior is verified at wiring time (this wave ships the node, not the render loop).
 * @param {{ initial_tod?: number, seed?: string|number }} [opts] seed drives the per-world night sky
 *   (star density variance + planet orbits — night_sky.js); defaults to the master seed.
 * @returns {SkyNode}
 */
export function create_sky_node({ initial_tod = 0.3, seed = 'aresrpg' } = {}) {
  const time_of_day = uniform(initial_tod)
  const sun_direction = uniform(sun_dir_from_tod(initial_tod))

  /** @param {Rgb} c @returns {*} constant vec3 node */
  const c3 = (c) => vec3(c[0], c[1], c[2])
  /** @param {keyof SkyPalette} k @param {*} sun_y @returns {*} the tod-blended stop as a node */
  const stop_node = (k, sun_y) =>
    mix(
      mix(c3(SKY_NIGHT[k]), c3(SKY_DUSK[k]), smoothstep(-0.18, -0.02, sun_y)),
      c3(SKY_DAY[k]),
      smoothstep(-0.02, 0.22, sun_y)
    )

  /**
   * TSL twin of `sample_sky_rgb`.
   * @param {*} dir vec3 view-direction node (assumed normalized)
   * @returns {*} vec3 radiance node
   */
  const sample_sky = (dir) => {
    const sun = sun_direction
    const sun_y = sun.y
    const cos_up = dir.y
    const cos_sun = dir.dot(sun)

    let sky = mix(stop_node('nadir', sun_y), stop_node('horizon', sun_y), smoothstep(-0.35, 0.0, cos_up))
    sky = mix(sky, stop_node('zenith', sun_y), smoothstep(0.0, 0.55, cos_up))

    const vdots = clamp(cos_sun, 0, 1)
    const vdots4 = vdots.mul(vdots).mul(vdots).mul(vdots)
    const glare = vdots4
      .mul(-(1 - GLARE_VIS))
      .add(1)
      .reciprocal()
      .mul(GLARE_VIS)
      .sub(GLARE_VIS)
    const halo_amt = glare.mul(GLARE_STRENGTH).add(pow(vdots, MIE_POW).mul(MIE_STRENGTH))
    const sun_up = clamp(sun_y.add(0.1).div(0.2), 0, 1)
    const tint = mix(c3(SUN_TINT_DUSK), c3(SUN_TINT_DAY), smoothstep(-0.02, 0.25, sun_y))
    return sky.add(tint.mul(halo_amt.mul(sun_up))).max(0)
  }

  /** [2026-07-05 — a huge unexplained spotlight traced back to this sun mirror] The DOME
   *  variant: the sky WITHOUT the sun glare/mie halo. THE spotlight's true source (proven by
   *  elimination — it survived every bloom-cap identically, so it was never bloom): the ~15°-wide
   *  atmospheric glow sample_sky paints around the sun reads correctly IN THE SKY, but mirrored by
   *  calm water it becomes a giant smooth ellipse (~1.5 radiance on ~0.05 water = a 30× contrast blob
   *  at ANY shoulder cap; the ~2° wave undulation cannot break a ~15° halo). Correct decomposition:
   *  the water mirrors the DOME (gradient + tint — pretty, haloless), while the sun's reflection is
   *  modeled by the water's own STRUCTURED glint road. Consumed by water_material's reflection path.
   *  @param {*} dir vec3 view-direction node @returns {*} vec3 radiance node */
  const sample_sky_dome = (dir) => {
    const sun_y = sun_direction.y
    const cos_up = dir.y
    let sky = mix(stop_node('nadir', sun_y), stop_node('horizon', sun_y), smoothstep(-0.35, 0.0, cos_up))
    sky = mix(sky, stop_node('zenith', sun_y), smoothstep(0.0, 0.55, cos_up))
    return sky.max(0)
  }

  // background: sky + a limb-brightened sun disc (readability-oversized) + the antipodal night moon.
  const view = positionWorldDirection.normalize()
  const cos_sun_bg = view.dot(sun_direction)
  const disc = smoothstep(SUN_DISC_COS, SUN_DISC_COS + 0.00008, cos_sun_bg)
  const disc_tint = mix(c3(SUN_TINT_DUSK), c3(SUN_TINT_DAY), smoothstep(-0.02, 0.25, sun_direction.y))
  const sun_disc = disc_tint.mul(disc.mul(SUN_DISC_INTENSITY).mul(clamp(sun_direction.y.add(0.1).div(0.2), 0, 1)))
  // MOON — opposite the sun (overhead at midnight, below the horizon by day): a soft cool-grey disc that
  // fades in as the sun sets. Kept intensity-modest so it reads as a calm night body, never a second sun.
  // 2026-07-13 (target: a better moon texture, optimized, faded): limb-darkened soft edge
  // (was a near-hard 0.00012 step) + a real photographic maria texture (disc-space UV, fixed to the moon —
  // see moon_texture() above, shared with hillaire_sky.js so the tiers cannot drift). Round 2: the DISC
  // only — the halo + the moonlit-sky glow moved to night_sky.js (boundary-free; the windowed corona was
  // the "lamp").
  const moon_dir = sun_direction.negate()
  const cos_moon_bg = view.dot(moon_dir)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1) // sun.y ≲ 0 ⇒ moon rising above the horizon
  const moon_edge = smoothstep(MOON_DISC_COS, MOON_DISC_INNER_COS, cos_moon_bg)
  const moon_rim_t = clamp(cos_moon_bg.sub(MOON_DISC_COS).div(1 - MOON_DISC_COS), 0, 1)
  const moon_limb = mix(MOON_LIMB_EDGE, 1, moon_rim_t)
  const moon_uv = disc_space_uv(view, moon_dir).div(MOON_ANGULAR_RADIUS).mul(0.5).add(0.5)
  const moon_surface = texture(moon_texture(), moon_uv).r
  const moon_amt = moon_edge.mul(moon_limb).mul(moon_surface).mul(MOON_DISC_INTENSITY)
  const moon_body = c3(MOON_DISC_RGB).mul(moon_amt.mul(moon_up))
  // NIGHT SKY (round 2 — target: beautiful stars, planets, milky way): stars + planets at LOW; the base
  // gradient stays the palette's (with_base false) and the milky-way band is skipped (tier budget).
  const night = create_night_sky_node({
    seed,
    sun_dir: sun_direction,
    view_dir: view,
    with_base: false,
    with_milky_way: false,
  })
  const background_node = sample_sky(view).add(sun_disc).add(moon_body).add(night.node)

  /** @param {number} tod */
  const set_time_of_day = (tod) => {
    const t = tod - Math.floor(tod)
    time_of_day.value = t
    sun_dir_from_tod(t, sun_direction.value)
    night.tick(sun_direction.value) // planet drift follows the tod push (cheap CPU)
  }

  return { time_of_day, sun_direction, sample_sky, sample_sky_dome, background_node, set_time_of_day }
}
