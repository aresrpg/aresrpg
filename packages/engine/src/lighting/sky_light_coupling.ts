// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Couples the terrain's three scene lights to the sky, after Hillaire (EGSR 2020) surface lighting, as a
// CPU recolour on each time-of-day change. The sun is sun_illuminance times the atmosphere transmittance
// at its elevation, from the same EARTH_ATMOSPHERE as the sky LUTs, so the key light and the sun disc
// redden on one curve. Ambient luminance comes from the analytic sky; its hue is a warm or cool tint derived
// from the same transmittance, not the raw blue dome. Noon reproduces the tuned baseline. Aerial perspective
// belongs to the Hillaire fog.

import { EARTH_ATMOSPHERE, type AtmosphereParams } from '../sky/hillaire/atmosphere_params.ts'
import type { Rgb } from '../sky/shared.ts'
import { sample_sky_rgb } from '../sky/sky_node.ts'

type LightBaseline = Readonly<{
  sun_color: Rgb
  sun_intensity: number
  fill_color: Rgb
  fill_intensity: number
  hemi_sky: Rgb
  hemi_ground: Rgb
  hemi_intensity: number
}>

type CoupledLighting = LightBaseline & Readonly<{ shadow_intensity: number }>

/** Eye altitude in km for the sun-path transmittance; matches the Hillaire camera default. */
const CAM_KM = 0.2
const TRANSMITTANCE_STEPS = 40

export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const clampf = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clampf((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/** Total per-km extinction at altitude `h_km`: Rayleigh, Mie and the ozone tent, as in the LUT kernels. */
function extinction_at(p: AtmosphereParams, h_km: number): Rgb {
  const rd = Math.exp(-h_km / p.rayleigh_density_h)
  const md = Math.exp(-h_km / p.mie_density_h)
  const oz = Math.max(0, 1 - Math.abs(h_km - p.ozone_center_km) / p.ozone_width_km)
  const rs = p.rayleigh_scattering
  const mie = (p.mie_scattering + p.mie_absorption) * md
  const oa = p.ozone_absorption
  return [rs[0] * rd + mie + oa[0] * oz, rs[1] * rd + mie + oa[1] * oz, rs[2] * rd + mie + oa[2] * oz]
}

/** Direct-sun transmittance from the eye to the top of the atmosphere for sun cosine `mu`; zero in the
 *  planet shadow. */
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

/** Cosine-weighted average of the analytic sky over a coarse dome: zenith plus two elevation rings. */
function sky_irradiance(sun_dir: Rgb): Rgb {
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
    const c = sample_sky_rgb(d, sun_dir)
    acc[0] += c[0] * cw
    acc[1] += c[1] * cw
    acc[2] += c[2] * cw
    w += cw
  }
  return [acc[0] / w, acc[1] / w, acc[2] / w]
}

/** The back-fill comes from opposite the key in azimuth and low in the sky, where ground bounce comes from.
 *  It follows the key, so it never reads as a second sun that stays lit at night. */
export function fill_dir_of(key_dir: Rgb): Rgb {
  const horizontal = Math.hypot(key_dir[0], key_dir[2])
  const [x, z] = horizontal < 1e-3 ? [1, 0] : [-key_dir[0] / horizontal, -key_dir[2] / horizontal]
  const y = 0.45 // low: bounce and horizon sky, never a second overhead sun
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** True once the sun is below the horizon: the directional light then comes from the moon. */
export function is_moon_key(sun_y: number): boolean {
  return sun_y < 0
}

/** Cool skyglow tint the ambient sinks toward at night. */
const NIGHT_SKYGLOW: Rgb = [0.62, 0.78, 1.12]
/** Moonlight key: a fraction of the day sun, enough to give moonlit slopes form while staying night. */
const MOON_MUL_DEFAULT = 0.26
const MOON_TINT: Rgb = [0.58, 0.7, 1.0]
/** Night ambient never drops below this fraction of the baseline. */
const AMBIENT_NIGHT_FLOOR_DEFAULT = 0.6

/** Cast-shadow strength for sun cosine `y`: full while the sun is up, fading to 0 at the horizon so a
 *  below-horizon sun casts no shadows. */
function shadow_intensity_for(y: number): number {
  return smooth(0.0, 0.12, y)
}

const SHADOW_DIRECTION_STEP_COS = Math.cos(Math.PI / 720)

/** Keep the directional shadow projection fixed until the moving key advances by 0.25°. Updating
 * it every frame makes static voxel edges crawl across shadow-map texels during the day cycle. */
export const shadow_direction_changed = (previous_dot_next: number): boolean =>
  previous_dot_next < SHADOW_DIRECTION_STEP_COS

/** Noon anchors, derived from the same functions. */
const NOON_MU = 0.98
const T_NOON = sun_transmittance(NOON_MU)
const T_NOON_LUM = Math.max(luminance(T_NOON), 1e-4)
const A_NOON_LUM = Math.max(luminance(sky_irradiance([0, NOON_MU, Math.sqrt(1 - NOON_MU * NOON_MU)])), 1e-4)

/** Couple the scene lights to the sky at a sun direction. Noon returns the baseline; away from noon the sun
 *  reddens and dims with transmittance and the ambient dims and warms at dusk or cools at night. */
export function couple_lighting(
  sun_dir: Rgb,
  base: LightBaseline,
  params: AtmosphereParams = EARTH_ATMOSPHERE
): CoupledLighting {
  const [, y] = sun_dir
  // night factor: 0 in daylight → 1 below the horizon (the terminator band, matching the sky's own night).
  const night = smooth(0.04, -0.12, y)

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

  // luminance from the sky the background shows; comfort-floored so night stays legible.
  const amb_lum_mul = clampf(luminance(sky_irradiance(sun_dir)) / A_NOON_LUM, 0, 1)
  // The warm tint follows the sun's own reddening, gated to a low sun so noon stays neutral.
  const warm_amount = smooth(0.35, 0.0, y) * 0.55 // 0 at high sun → 0.55 at the horizon
  const t_hue_max = Math.max(T[0], T[1], T[2], 1e-4)
  const sun_hue_norm: Rgb = [T[0] / t_hue_max, T[1] / t_hue_max, T[2] / t_hue_max]
  const warm_tint = mix3([1, 1, 1], sun_hue_norm, warm_amount)
  const tint = mix3(warm_tint, NIGHT_SKYGLOW, night)
  const hemi_intensity = base.hemi_intensity * (amb_lum_mul + (AMBIENT_NIGHT_FLOOR_DEFAULT - amb_lum_mul) * night)
  const hemi_sky: Rgb = [base.hemi_sky[0] * tint[0], base.hemi_sky[1] * tint[1], base.hemi_sky[2] * tint[2]]
  const hemi_ground: Rgb = [base.hemi_ground[0] * tint[0], base.hemi_ground[1] * tint[1], base.hemi_ground[2] * tint[2]]

  // The back-fill follows the key's level and colour; a frozen warm tint would be a second sun that never sets.
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
