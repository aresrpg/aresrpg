// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The analytic sky for Low quality and the fallback when the Hillaire sky fails. One function of
// (view.up, view.sun) feeds the background, clouds, fog colour and water reflections: a three-stop
// vertical gradient, a hand-fit rational sun glare and a dusk warmth ramp driven by the time of day.
// The look is adapted from fable5-world-demo, MIT, Copyright (c) 2026 Remi Sebastian Kits.
// `sample_sky_rgb` is the CPU form of the same constants; lighting and fog read it.

import type { Node } from 'three/webgpu'
import { clamp, mix, positionWorldDirection, pow, smoothstep, texture, uniform, vec3 } from 'three/tsl'

import { DAY_FRAC, sun_dir_from_tod } from './celestial_motion.ts'
import { create_night_sky_node } from './night_sky.ts'
import {
  MOON_ANGULAR_RADIUS,
  MOON_DISC_COS,
  MOON_DISC_INNER_COS,
  MOON_DISC_RGB,
  MOON_LIMB_EDGE,
  SKY_NIGHT,
  disc_space_uv,
  moon_texture,
  type Rgb,
  type SkyPalette,
} from './shared.ts'

// Each palette has three vertical stops mixed by view.up. The nadir stays luminous so distant terrain
// dissolves into haze instead of black.

// The day horizon is the shared aerial-haze hue: it tints fog, ambient light, water and distant terrain.
const SKY_DAY: SkyPalette = {
  zenith: [0.1, 0.24, 0.52],
  horizon: [0.31, 0.42, 0.62],
  nadir: [0.19, 0.24, 0.31],
}
const SKY_DUSK: SkyPalette = {
  zenith: [0.16, 0.22, 0.42],
  horizon: [0.92, 0.52, 0.28],
  nadir: [0.3, 0.2, 0.22],
}

const SUN_TINT_DAY: Rgb = [1.0, 0.96, 0.9]
const SUN_TINT_DUSK: Rgb = [1.0, 0.5, 0.24]

// Sun glare: a rational spike vis / (1 - (1 - vis) * VdotS^4) - vis plus a pow(VdotS, MIE_POW) forward glow.
const GLARE_VIS = 0.0016
const GLARE_STRENGTH = 12.0
const MIE_POW = 8.0
const MIE_STRENGTH = 0.55
/** The sun disc is about three times its real size for readability. */
export const SUN_DISC_COS = Math.cos(0.02)
const SUN_DISC_INTENSITY = 40.0

const MOON_DISC_INTENSITY = 1.6

const clampf = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
const saturate = (x: number): number => clampf(x, 0, 1)
const smooth = (e0: number, e1: number, x: number): number => {
  const t = saturate((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
export const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Blend the night, dusk and day palettes by the sun's elevation. */
export function palette_for_sun(sun_y: number): SkyPalette {
  const to_dusk = smooth(-0.18, -0.02, sun_y)
  const to_day = smooth(-0.02, 0.22, sun_y)
  const stop = (k: keyof SkyPalette): Rgb => mix3(mix3(SKY_NIGHT[k], SKY_DUSK[k], to_dusk), SKY_DAY[k], to_day)
  return { zenith: stop('zenith'), horizon: stop('horizon'), nadir: stop('nadir') }
}

function sun_tint_for(sun_y: number): Rgb {
  return mix3(SUN_TINT_DUSK, SUN_TINT_DAY, smooth(-0.02, 0.25, sun_y))
}

/** The reference sky radiance for a view direction. HDR: clamped at 0 only; the tone mapper takes the peak. */
export function sample_sky_rgb(view: Rgb, sun: Rgb): Rgb {
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

export function create_sky_node({ initial_tod = 0.3, seed = 'aresrpg', sky_rotation = 0 } = {}) {
  const time_of_day = uniform(initial_tod)
  const sun_direction = uniform(sun_dir_from_tod(initial_tod, undefined, sky_rotation))

  const c3 = (c: Rgb): Node<'vec3'> => vec3(c[0], c[1], c[2])
  const stop_node = (k: keyof SkyPalette, sun_y: Node<'float'>): Node<'vec3'> =>
    mix(
      mix(c3(SKY_NIGHT[k]), c3(SKY_DUSK[k]), smoothstep(-0.18, -0.02, sun_y)),
      c3(SKY_DAY[k]),
      smoothstep(-0.02, 0.22, sun_y)
    )

  const sample_sky = (dir: Node<'vec3'>): Node<'vec3'> => {
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

  /** The sky without the sun glare. Water mirrors this dome: a mirrored 15-degree glare becomes a giant
   *  ellipse on calm water, so the water draws its own glint road for the sun instead. */
  const sample_sky_dome = (dir: Node<'vec3'>): Node<'vec3'> => {
    const sun_y = sun_direction.y
    const cos_up = dir.y
    let sky = mix(stop_node('nadir', sun_y), stop_node('horizon', sun_y), smoothstep(-0.35, 0.0, cos_up))
    sky = mix(sky, stop_node('zenith', sun_y), smoothstep(0.0, 0.55, cos_up))
    return sky.max(0)
  }

  // Background: sky, a limb-brightened sun disc and the antipodal moon.
  const view = positionWorldDirection.normalize()
  const cos_sun_bg = view.dot(sun_direction)
  const disc = smoothstep(SUN_DISC_COS, SUN_DISC_COS + 0.00008, cos_sun_bg)
  const disc_tint = mix(c3(SUN_TINT_DUSK), c3(SUN_TINT_DAY), smoothstep(-0.02, 0.25, sun_direction.y))
  const sun_disc = disc_tint.mul(disc.mul(SUN_DISC_INTENSITY).mul(clamp(sun_direction.y.add(0.1).div(0.2), 0, 1)))
  // The moon disc fades in as the sun sets and stays well under the sun's radiance.
  const moon_dir = sun_direction.negate()
  const cos_moon_bg = view.dot(moon_dir)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1)
  const moon_edge = smoothstep(MOON_DISC_COS, MOON_DISC_INNER_COS, cos_moon_bg)
  const moon_rim_t = clamp(cos_moon_bg.sub(MOON_DISC_COS).div(1 - MOON_DISC_COS), 0, 1)
  const moon_limb = mix(MOON_LIMB_EDGE, 1, moon_rim_t)
  const moon_uv = disc_space_uv(view, moon_dir).div(MOON_ANGULAR_RADIUS).mul(0.5).add(0.5)
  const moon_surface = texture(moon_texture(), moon_uv).r
  const moon_amt = moon_edge.mul(moon_limb).mul(moon_surface).mul(MOON_DISC_INTENSITY)
  const moon_body = c3(MOON_DISC_RGB).mul(moon_amt.mul(moon_up))
  // Low quality draws stars and planets only: the palette keeps its own base and the milky way is skipped.
  const night = create_night_sky_node({
    seed,
    sun_dir: sun_direction,
    view_dir: view,
    with_base: false,
    with_milky_way: false,
  })
  const background_node = sample_sky(view).add(sun_disc).add(moon_body).add(night.node)

  const set_time_of_day = (tod: number): void => {
    const t = tod - Math.floor(tod)
    time_of_day.value = t
    sun_dir_from_tod(t, sun_direction.value, sky_rotation)
    night.tick(sun_direction.value)
  }

  return { time_of_day, sun_direction, sample_sky, sample_sky_dome, background_node, set_time_of_day }
}
