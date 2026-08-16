// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SKY→TERRAIN LIGHT COUPLING (the "2 different engines in one render" fix). Before this, the terrain's
// three scene lights (sun DirectionalLight, warm back-fill, HemisphereLight ambient) were FIXED colours,
// night-dimmed by a crude intensity ramp — so the physical Hillaire sky reddened at dusk while the GROUND
// never followed. The design gap: "we made a pro sky to have terrain lightning, and it was never connected."
//
// This is the paper's surface-lighting integration (Hillaire, EGSR 2020, §Sun/§Ambient), adapted to our
// voxel forward path as a CPU-side per-tod-change recolour of the SAME three lights the terrain already
// reads (zero new render targets, zero GPU readback — tod changes slowly, so a few-µs CPU pass per change
// is honest, per the paper's "distant sky irradiance can be a cheap low-order fetch"):
//
//   • SUN  = sun_illuminance × TRANSMITTANCE(sun elevation) — the direct sun after atmospheric extinction.
//            Physically reddens + dims toward the horizon (long air path scatters blue out), hits 0 in the
//            planet shadow. Mirror of sky_hillaire/physics.js sample_medium + luts.js's transmittance march
//            (ONE atmosphere-param source: EARTH_ATMOSPHERE), so the terrain's key light and the sky's sun
//            disc redden off the SAME curve and cannot drift.
//   • AMBIENT = a low-order SKY IRRADIANCE: its LUMINANCE from the analytic sky the background shows
//            (sample_sky_rgb — the tested JS sky twin the fog already samples), its HUE an art-controlled
//            warm/cool tint DERIVED FROM the same transmittance (warm shade at dusk, blue skyglow at night)
//            — NOT the raw blue sky dome, which would re-cyan the terrace risers that were de-cyaned
//            (renderer.js hemisphere note). Anchored so NOON == the tuned baseline (ratio 1).
//
// Aerial perspective (the 3rd coupling term) is already applied to opaques by the Hillaire fog_node
// (scene.fogNode), and exposure is already one grammar (post_stack AgX reads the auto-exposure-driven
// toneMappingExposure over sky+terrain alike) — so this module owns SUN + AMBIENT only.
//
// Pure functions (backend-free, unit-tested); renderer.js applies the result to its live light objects.

import { EARTH_ATMOSPHERE, type AtmosphereParams, type Rgb } from '../sky/hillaire/atmosphere_params.ts'
import { sample_sky_rgb } from '../sky/sky_node.ts'

export type LightBaseline = Readonly<{
  sun_color: Rgb
  sun_intensity: number
  fill_color: Rgb
  fill_intensity: number
  hemi_sky: Rgb
  hemi_ground: Rgb
  hemi_intensity: number
}>

export type CoupledLighting = LightBaseline & Readonly<{ shadow_intensity: number }>

/** Eye altitude (km) at which the sun-path transmittance is sampled — matches the Hillaire dyn.cam_height_km
 *  default (0.2 km ≈ a hilltop vista), so the terrain sun and the sky's sun disc read the same air path. */
const CAM_KM = 0.2
/** Optical-depth march steps for the CPU transmittance (matches the HIGH transmittance LUT's 40). */
const TRANSMITTANCE_STEPS = 40

/** Rec.709 luminance of a linear rgb triple. @param {number[]} c @returns {number} */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} e0 @param {number} e1 @param {number} x @returns {number} Hermite smoothstep. */
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clampf((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** @param {number[]} a @param {number[]} b @param {number} t @returns {number[]} per-channel lerp */
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/**
 * Total extinction (per-km, linear rgb) of the atmosphere medium at altitude `h_km` above the ground —
 * Rayleigh + Mie(scatter+absorb) + ozone tent. Faithful mirror of sky_hillaire/physics.js `sample_medium`
 * (the `extinction` term), so the CPU sun-tint and the GPU LUTs share one physical model.
 * @param {import('../sky_hillaire/atmosphere_params.js').AtmosphereParams} p
 * @param {number} h_km altitude above ground (km, ≥0)
 * @returns {number[]} per-km extinction [r,g,b]
 */
export function extinction_at(p: AtmosphereParams, h_km: number): Rgb {
  const rd = Math.exp(-h_km / p.rayleigh_density_h)
  const md = Math.exp(-h_km / p.mie_density_h)
  const oz = Math.max(0, 1 - Math.abs(h_km - p.ozone_center_km) / p.ozone_width_km)
  const rs = p.rayleigh_scattering
  const mie = (p.mie_scattering + p.mie_absorption) * md
  const oa = p.ozone_absorption
  return [rs[0] * rd + mie + oa[0] * oz, rs[1] * rd + mie + oa[1] * oz, rs[2] * rd + mie + oa[2] * oz]
}

/**
 * Transmittance (linear rgb in [0,1]) of the direct sun from the eye to the top of atmosphere, for a sun
 * whose cosine-to-zenith is `mu` (= sun_direction.y). Marches optical depth and returns exp(−τ). Returns
 * [0,0,0] when the sun ray hits the planet (sun below the horizon = the terminator shadow). Mirror of the
 * transmittance LUT kernel (luts.js) evaluated at the eye radius.
 * @param {number} mu sun elevation cosine (sun_direction.y), [-1,1]
 * @param {import('../sky_hillaire/atmosphere_params.js').AtmosphereParams} [p]
 * @param {number} [cam_km] eye altitude (km)
 * @param {number} [steps] march steps
 * @returns {number[]} [r,g,b] in [0,1]
 */
export function sun_transmittance(
  mu: number,
  p: AtmosphereParams = EARTH_ATMOSPHERE,
  cam_km = CAM_KM,
  steps = TRANSMITTANCE_STEPS
): Rgb {
  const ground = p.ground_radius_km
  const top = p.top_radius_km
  const r = ground + Math.max(cam_km, 0.001)
  // sun ray hits the ground (planet shadow) ⇒ zero direct sun.
  const disc_g = r * r * (mu * mu - 1) + ground * ground
  if (mu < 0 && disc_g >= 0) return [0, 0, 0]
  // distance to the top-of-atmosphere sphere along the sun ray.
  const disc_t = r * r * (mu * mu - 1) + top * top
  const t_max = Math.max(0, Math.sqrt(Math.max(disc_t, 0)) - r * mu)
  const dt = t_max / steps
  const od: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt
    const rs = Math.sqrt(r * r + 2 * r * mu * t + t * t)
    const h = Math.max(0, rs - ground)
    const e = extinction_at(p, h)
    od[0] += e[0] * dt
    od[1] += e[1] * dt
    od[2] += e[2] * dt
  }
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])]
}

/**
 * Low-order hemisphere sky irradiance (linear rgb) — a cosine(elevation)-weighted average of the analytic
 * sky over a coarse dome (zenith + two elevation rings). This is the paper's "distant sky irradiance" as a
 * cheap fetch; it feeds the AMBIENT LUMINANCE (its hue is overridden by a de-cyan-safe tint downstream).
 * @param {number[]} sun_dir unit sun direction [x,y,z]
 * @returns {number[]} [r,g,b] linear
 */
export function sky_irradiance(sun_dir: Rgb): Rgb {
  /** @type {import('../sky/sky_node.js').Rgb[]} */
  const dirs: Rgb[] = [[0, 1, 0]]
  for (const el of [Math.PI / 3, Math.PI / 8]) {
    const ce = Math.cos(el)
    const se = Math.sin(el)
    for (let a = 0; a < 8; a++) {
      const az = (a / 8) * 2 * Math.PI
      dirs.push([Math.cos(az) * ce, se, Math.sin(az) * ce])
    }
  }
  const acc: [number, number, number] = [0, 0, 0]
  let w = 0
  for (const d of dirs) {
    const cw = Math.max(0, d[1]) // cosine-elevation weight (dome-heavy)
    const c = sample_sky_rgb(d, /** @type {import('../sky/sky_node.js').Rgb} */ sun_dir)
    acc[0] += c[0] * cw
    acc[1] += c[1] * cw
    acc[2] += c[2] * cw
    w += cw
  }
  return [acc[0] / w, acc[1] / w, acc[2] / w]
}

/**
 * The MOON direction = the antipode of the sun (a full moon opposite the sun: above the horizon at midnight,
 * below the horizon by day). Unit-in ⇒ unit-out. This is the "moon replacing the sun" orbit — no extra
 * ephemeris, one source with the sun. @param {number[]} sun_dir unit [x,y,z] @returns {number[]} unit moon dir
 */
export function moon_dir_of(sun_dir: Rgb): Rgb {
  return [-sun_dir[0], -sun_dir[1], -sun_dir[2]]
}

/**
 * The BACK-FILL direction: the bounce light that gives the key's shaded side its form. It is derived
 * from the KEY (sun by day, moon by night) — opposite in azimuth and low in the sky, because that is
 * where ground bounce and the bright side of the sky come from. It is never a fixed world direction:
 * a fill that does not move with its key reads as a second sun with no source in the sky, and it does
 * not go out at night (owner 2026-08-15: "a light trail on my right, which remains also at night and
 * doesn't appear to have any light source"). Unit-in ⇒ unit-out; a key straight overhead keeps a
 * stable azimuth rather than dividing by zero.
 * @param key_dir unit [x,y,z] direction toward the key light
 */
export function fill_dir_of(key_dir: Rgb): Rgb {
  const horizontal = Math.hypot(key_dir[0], key_dir[2])
  const [x, z] = horizontal < 1e-3 ? [1, 0] : [-key_dir[0] / horizontal, -key_dir[2] / horizontal]
  const y = 0.45 // low: bounce and horizon sky, never a second overhead sun
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/**
 * Is the MOON the directional key light? True once the sun is below the horizon (moon above), so the
 * DirectionalLight hands over from the (extinguished, below-ground) sun to the overhead moon. The colour/
 * intensity crossfade is couple_lighting's `night` factor; this only picks which body the light comes FROM.
 * @param {number} sun_y sun elevation cosine (sun_direction.y) @returns {boolean}
 */
export function is_moon_key(sun_y: number): boolean {
  return sun_y < 0
}

/** Cool blue skyglow the ambient sinks toward at night (Rayleigh night-sky residual — never a warm
 *  "desaturated day", the reported night complaint). Linear rgb tint (multiplies the warm-grey base). */
const NIGHT_SKYGLOW: Rgb = [0.62, 0.78, 1.12]
/** Night MOONLIGHT key (target: "a moon replacing the sun for a night soft blue grey light"): the
 *  DirectionalLight's floor intensity fraction of the sun baseline + its cool blue-grey tint. Now that the
 *  light hands over to come FROM the overhead moon (renderer.js tick_sun), this key actually lights the
 *  moon-facing slopes — so it is lifted from a token 0.07 to ≈ the ambient floor's ABSOLUTE scale so moonlit
 *  terrain reads as a SOFT BLUE-GREY, never pitch black, while staying clearly night (kept < 0.3× the day
 *  sun so the night test's "faint" invariant holds). SHIPPED 2026-07-19: pick "Night Look A" (matrix
 *  lane cell A) raised the default 0.13 → 0.26 — the taste dial below still overrides it live. */
const MOON_MUL_DEFAULT = 0.26
const MOON_TINT: Rgb = [0.58, 0.7, 1.0]
/** Ambient intensity comfort floor (fraction of the baseline) — night never crushes to pitch black
 *  (target: "never pitch black … shapes stay legible while the world reads NIGHT"; lifted with the moon key
 *  so the moonlit world reads soft blue-grey, still < 0.6× the day ambient so it stays unmistakably night). */
const AMBIENT_NIGHT_FLOOR_DEFAULT = 0.5

// ── CONFIGURABLE NIGHT DIALS (2026-07-19: moonlit terrain reads PITCH-BLACK — the moon key + ambient
//    floor are too low to give the terrain FORM). These are a TASTE dial the seat picks: raising moon_mul
//    lifts the DIRECTIONAL moonlight (silhouettes/tops read as form) while ambient_night_floor lifts the flat fill.
//    Config-first (engine.js threads world_config.night → configure_night_lighting); DEFAULT = the two baseline
//    consts above so an unconfigured world's night matches the SHIPPED look; the taste dial still overrides live.
//    Mirrors water_material.configure_water_optics (live-tunable module dials with a byte-identical default).
//    SHIPPED (pick 2026-07-19, "Night Look A" — matrix-lane cell A): MOON_MUL_DEFAULT baked 0.13 → 0.26.
//    The couple_lighting "faint" test bound was lifted 0.15× → 0.3×base alongside it (it is asserted against
//    the default, so a future baked candidate ≥ 0.3× must lift the bound again the same way).
/**
 * Cast-shadow strength [0,1] for a sun at elevation cosine `y` (= sun_direction.y) — the ONE home for the
 * "shadows follow the sun and fade at night" curve (renderer.js drives `sun.shadow.intensity` off this).
 * Full (1) while the sun is comfortably up, ramping to 0 as it reaches the horizon so dusk shadows dissolve
 * smoothly and a below-horizon sun casts NO upside-down night shadows. Pure; unit-tested.
 * @param {number} y sun elevation cosine (sun_direction.y), [-1,1]
 * @returns {number} shadow intensity in [0,1]
 */
export function shadow_intensity_for(y: number): number {
  return smooth(0.0, 0.12, y)
}

/** The reference (noon) anchors, derived ONCE from the same functions — zero hardcoded runtime numbers.
 *  Noon sun elevation is SUN_PEAK_Y (sky_node.js) ≈ 0.98; use it directly for the transmittance anchor. */
const NOON_MU = 0.98
const T_NOON = sun_transmittance(NOON_MU)
const T_NOON_LUM = Math.max(luminance(T_NOON), 1e-4)
const A_NOON_LUM = Math.max(luminance(sky_irradiance([0, NOON_MU, Math.sqrt(1 - NOON_MU * NOON_MU)])), 1e-4)

/**
 * @typedef {object} LightBaseline the tuned baseline light values (renderer.js is their one home),
 *   all colours as LINEAR rgb triples.
 * @property {number[]} sun_color         sun DirectionalLight colour (linear)
 * @property {number}   sun_intensity     sun DirectionalLight intensity
 * @property {number[]} fill_color        warm back-fill DirectionalLight colour (linear)
 * @property {number}   fill_intensity    warm back-fill intensity
 * @property {number[]} hemi_sky          HemisphereLight sky colour (linear)
 * @property {number[]} hemi_ground       HemisphereLight ground colour (linear)
 * @property {number}   hemi_intensity    HemisphereLight intensity
 */

/**
 * @typedef {object} CoupledLighting the recoloured light values to write onto the live three lights.
 * @property {number[]} sun_color         reddened/dimmed sun colour (linear)
 * @property {number}   sun_intensity
 * @property {number[]} fill_color        (linear)
 * @property {number}   fill_intensity
 * @property {number[]} hemi_sky          tod-tinted ambient sky colour (linear)
 * @property {number[]} hemi_ground       (linear)
 * @property {number}   hemi_intensity
 * @property {number}   shadow_intensity  cast-shadow strength [0,1] (1 day → 0 at/below the horizon)
 */

/**
 * Couple the terrain's three scene lights to the sky at the current sun direction. NOON is a fixed point
 * (returns ≈ the baseline, so the tuned look is preserved); away from noon the SUN reddens + dims
 * off the physical transmittance and the AMBIENT dims (physical luminance) + warms (dusk) / cools (night)
 * off a de-cyan-safe tint. Pure — no side effects.
 * @param {number[]} sun_dir unit sun direction [x,y,z] (sun_dir.y = elevation cosine)
 * @param {LightBaseline} base the tuned baseline (linear colours)
 * @param {import('../sky_hillaire/atmosphere_params.js').AtmosphereParams} [params] atmosphere params
 * @returns {CoupledLighting}
 */
export function couple_lighting(
  sun_dir: Rgb,
  base: LightBaseline,
  params: AtmosphereParams = EARTH_ATMOSPHERE
): CoupledLighting {
  const [, y] = sun_dir
  // night factor: 0 in daylight → 1 below the horizon (the terminator band, matching the sky's own night).
  const night = smooth(0.04, -0.12, y)

  // ── SUN (direct) — physical transmittance, ratio-anchored to noon ──────────────────────────────────
  const T = sun_transmittance(y, params)
  // hue ratio T/T_noon: [1,1,1] at noon (base preserved) → reddens (r>g>b) toward dusk.
  const hue = [T[0] / Math.max(T_NOON[0], 1e-4), T[1] / Math.max(T_NOON[1], 1e-4), T[2] / Math.max(T_NOON[2], 1e-4)]
  const lum_mul = luminance(T) / T_NOON_LUM // 1 at noon → 0 at the horizon (physical dimming)
  const day_sun_color: Rgb = [
    clampf(base.sun_color[0] * hue[0], 0, 4),
    clampf(base.sun_color[1] * hue[1], 0, 4),
    clampf(base.sun_color[2] * hue[2], 0, 4),
  ]
  // blend the cool moonlight key under the horizon (a faint directional key, never a warm day wash).
  const moon_color: Rgb = [
    base.sun_color[0] * MOON_TINT[0],
    base.sun_color[1] * MOON_TINT[1],
    base.sun_color[2] * MOON_TINT[2],
  ]
  const sun_color = mix3(day_sun_color, moon_color, night)
  const sun_intensity = base.sun_intensity * (lum_mul + (MOON_MUL_DEFAULT - lum_mul) * night)

  // ── AMBIENT (hemisphere) — physical luminance + de-cyan-safe tod tint ───────────────────────────────
  // luminance from the sky the background shows; comfort-floored so night stays legible.
  const amb_lum_mul = clampf(luminance(sky_irradiance(sun_dir)) / A_NOON_LUM, 0, 1)
  // warm tint DERIVED from the sun's own reddening (softened), gated to LOW sun so noon stays neutral
  // (base warm-grey preserved ⇒ no cyan risers); at night, blend to the cool skyglow.
  const warm_amount = smooth(0.35, 0.0, y) * 0.55 // 0 at high sun → 0.55 at the horizon
  const t_hue_max = Math.max(T[0], T[1], T[2], 1e-4)
  const sun_hue_norm: Rgb = [T[0] / t_hue_max, T[1] / t_hue_max, T[2] / t_hue_max]
  const warm_tint = mix3([1, 1, 1], sun_hue_norm, warm_amount)
  const tint = mix3(warm_tint, NIGHT_SKYGLOW, night)
  const hemi_intensity = base.hemi_intensity * (amb_lum_mul + (AMBIENT_NIGHT_FLOOR_DEFAULT - amb_lum_mul) * night)
  const hemi_sky: Rgb = [base.hemi_sky[0] * tint[0], base.hemi_sky[1] * tint[1], base.hemi_sky[2] * tint[2]]
  const hemi_ground: Rgb = [base.hemi_ground[0] * tint[0], base.hemi_ground[1] * tint[1], base.hemi_ground[2] * tint[2]]

  // ── BACK-FILL — follows the key's day/night level AND its colour: warm bounce under a low sun,
  // cool skyglow at night. A frozen warm tint here is the "second sun that never sets" bug.
  const fill_intensity = base.fill_intensity * (lum_mul + (MOON_MUL_DEFAULT * 1.4 - lum_mul) * night)
  const fill_color: Rgb = [base.fill_color[0] * tint[0], base.fill_color[1] * tint[1], base.fill_color[2] * tint[2]]

  return {
    sun_color,
    sun_intensity,
    fill_color,
    fill_intensity,
    hemi_sky,
    hemi_ground,
    hemi_intensity,
    shadow_intensity: shadow_intensity_for(y),
  }
}
