// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Hillaire sky for Medium and High quality: four LUTs drive the sky background and the
// aerial-perspective fog on opaque surfaces. Low quality keeps the analytic sky in sky_node.ts.

import { PerspectiveCamera, Vector3 } from 'three'
import type { ComputeNode, Node, Renderer } from 'three/webgpu'
import {
  abs,
  cameraPosition,
  clamp,
  exp,
  float,
  fog,
  length,
  max,
  mix,
  positionWorld,
  positionWorldDirection,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec3,
} from 'three/tsl'

import { create_night_sky_node } from '../night_sky.ts'
import { atmosphere_profile, type AtmospherePreset } from '../../atmosphere_profile.ts'
import { resolve_atmosphere_tuning, type AtmosphereTuning } from '../../atmosphere_tuning.ts'
import { HEIGHT_FOG } from '../../height_fog.ts'
import { SUN_DISC_COS } from '../sky_node.ts'
import {
  MOON_DISC_COS,
  MOON_DISC_INNER_COS,
  MOON_LIMB_EDGE,
  MOON_DISC_RGB,
  MOON_ANGULAR_RADIUS,
  disc_space_uv,
  moon_texture,
} from '../shared.ts'

import { EARTH_ATMOSPHERE, SKY_TIERS, type AtmosphereParams } from './atmosphere_params.ts'
import { create_luts } from './luts.ts'

// Terminal haze closes the aerial perspective before the finite far-terrain shell ends.
const DISTANCE_HAZE_POWER = 1.5
const DISTANCE_HAZE_MAX = 0.995
const SUN_DISC_RADIANCE = 8.0
// The core reaches full brightness inside a soft rim band, and the limb dims so the edge melts into the glare.
const SUN_DISC_INNER_COS = Math.cos(0.013)
const SUN_LIMB_EDGE = 0.55
// Sun glare has no angular window, so the sun reads as a light source rather than a bounded disc. A tight
// rational spike hugs the rim and a pow(cos) tail decays to 90 degrees. Both scale the transmitted sun, so
// they redden at dusk with the disc. Pow 14 and gain 0.85 keep the noon sky from whiting out.
const SUN_GLARE_VIS = 0.0016
const SUN_GLARE_GAIN = 3.5
const SUN_MIE_POW = 14.0
const SUN_MIE_GAIN = 0.85
const MOON_DISC_RADIANCE = 1.55

type VectorUniform = Node<'vec3'> & { value: Vector3 }
type HillaireSkyOptions = Readonly<{
  tier: 'medium' | 'high'
  seed: string | number
  sun_direction: VectorUniform
  /** The analytic fog's cool tilt, shared so the two sky tiers cannot drift. */
  cool_tilt: readonly [number, number, number]
  /** Terminal haze range in world units. */
  distance_fog: Readonly<{ near: number; far: number }>
  atmosphere?: AtmospherePreset
}>

export function create_hillaire_sky(opts: HillaireSkyOptions) {
  const tier = SKY_TIERS[opts.tier]
  const tuning = resolve_atmosphere_tuning(opts.atmosphere)
  let params: AtmosphereParams = {
    ...EARTH_ATMOSPHERE,
    exposure: tuning.exposure,
    mie_scattering: tuning.mie_scattering,
    mie_g: tuning.mie_g,
  }
  const { sun_direction } = opts

  // Kilometre-scale atmosphere uniforms read by every kernel and sampler.
  const U = {
    rayleigh_scattering: uniform(new Vector3().fromArray(params.rayleigh_scattering)),
    rayleigh_density_h: uniform(params.rayleigh_density_h),
    mie_scattering: uniform(params.mie_scattering),
    mie_absorption: uniform(params.mie_absorption),
    mie_g: uniform(params.mie_g),
    mie_density_h: uniform(params.mie_density_h),
    ozone_absorption: uniform(new Vector3().fromArray(params.ozone_absorption)),
    ozone_center: uniform(params.ozone_center_km),
    ozone_width: uniform(params.ozone_width_km),
    ground_radius: uniform(params.ground_radius_km),
    top_radius: uniform(params.top_radius_km),
    ground_albedo: uniform(new Vector3().fromArray(params.ground_albedo)),
    sun_illuminance: uniform(new Vector3().fromArray(params.sun_illuminance)),
    exposure: uniform(params.exposure),
  }

  // Per-frame camera uniforms written by tick().
  const dyn = {
    sun_dir: sun_direction,
    cam_height_km: uniform(0.2),
    cam_fwd: uniform(new Vector3(0, 0, -1)),
    cam_right: uniform(new Vector3(1, 0, 0)),
    cam_up: uniform(new Vector3(0, 1, 0)),
    tan_half_x: uniform(0.7),
    tan_half_y: uniform(0.7),
    aerial_range_km: uniform(params.aerial_range_km),
    aerial_depth_power: uniform(params.aerial_depth_power),
    units_to_km: uniform(params.length_unit_m / 1000),
  }

  // Art-direction dials over the physical LUTs. They shape the look without forking the physics.
  const atmosphere = atmosphere_profile(opts.atmosphere)
  const A = {
    cool_tilt: uniform(new Vector3().fromArray(opts.cool_tilt)),
    tilt_amt: uniform(tuning.tint),
    haze_density: uniform(tuning.density),
    // Far ridgelines keep their silhouette below this aerial opacity.
    factor_max: uniform(tuning.max_opacity),
    // Medium's coarse aerial LUT overestimates near in-scatter; this distance gate keeps the foreground clear.
    near_fog_start: uniform(tuning.near),
    near_fog_full: uniform(tuning.full),
    distance_fog_near: uniform(opts.distance_fog.near * atmosphere.distance_near_scale),
    distance_fog_far: uniform(opts.distance_fog.far * atmosphere.distance_far_scale),
    height_base_y: uniform(0),
    height_humidity: uniform(0.5),
    height_density: uniform(opts.tier === 'high' ? tuning.height_density : 0),
    height_falloff: uniform(1 / tuning.height_falloff),
    height_max: uniform(tuning.height_max),
    // Sky-view luma ceiling before tone mapping; keeps the horizon blue instead of white.
    horizon_cap: uniform(tuning.horizon_cap),
  }
  // Night to day on sun elevation; the tilt is the identity at night.
  const day_f = smoothstep(float(-0.12), float(0.02), float(dyn.sun_dir.y))

  const luts = create_luts({ U, dyn, tier })

  // Kernels are built in bake and cleared in dispose, so tick stops before textures are freed.
  let k_transmittance: ComputeNode | null = null
  let k_multiscatter: ComputeNode | null = null
  let k_skyview: ComputeNode | null = null
  let k_aerial: ComputeNode | null = null
  let params_dirty = false
  // The LUTs only change when their inputs move, so tick skips the compute otherwise.
  const last_sun = new Vector3().copy(sun_direction.value)
  const last_fwd = new Vector3(0, 0, -1)
  let last_alt = -1
  const _fwd = new Vector3()
  const _right = new Vector3()
  const _up = new Vector3()

  // Background: sky-view LUT, sun disc and glare, moon and night sky.
  const view_dir = positionWorldDirection.normalize()
  const sky_radiance = luts.sample_skyview(view_dir).mul(U.exposure)
  const cam_r = dyn.cam_height_km.add(U.ground_radius)
  const cos_view_sun = view_dir.dot(dyn.sun_dir)
  const sun_up = clamp(dyn.sun_dir.y.add(0.1).div(0.2), 0, 1)
  // One transmitted sun source for the disc and its glare, so they redden together.
  const sun_base = U.sun_illuminance.mul(luts.sample_transmittance(cam_r, dyn.sun_dir.y)).mul(U.exposure)
  const disc_edge = smoothstep(float(SUN_DISC_COS), float(SUN_DISC_INNER_COS), cos_view_sun)
  const disc_rim_t = clamp(cos_view_sun.sub(float(SUN_DISC_COS)).div(float(1 - SUN_DISC_COS)), 0, 1)
  const disc_limb = mix(float(SUN_LIMB_EDGE), float(1), disc_rim_t)
  const sun_core = sun_base.mul(SUN_DISC_RADIANCE).mul(disc_edge.mul(disc_limb))
  const vdots = clamp(cos_view_sun, 0, 1)
  const vdots4 = vdots.mul(vdots).mul(vdots).mul(vdots)
  const glare_spike = float(SUN_GLARE_VIS)
    .div(vdots4.mul(-(1 - SUN_GLARE_VIS)).add(1))
    .sub(float(SUN_GLARE_VIS))
  const mie_tail = pow(vdots, float(SUN_MIE_POW))
  const sun_halo = sun_base.mul(glare_spike.mul(SUN_GLARE_GAIN).add(mie_tail.mul(SUN_MIE_GAIN)))
  const sun_glow = sun_core.add(sun_halo).mul(sun_up)
  // The moon is antipodal to the sun; its disc UV is fixed to the moon, never the camera.
  const moon_dir = dyn.sun_dir.mul(-1)
  const cos_view_moon = view_dir.dot(moon_dir)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1)
  const moon_edge = smoothstep(float(MOON_DISC_COS), float(MOON_DISC_INNER_COS), cos_view_moon)
  const moon_rim_t = clamp(cos_view_moon.sub(float(MOON_DISC_COS)).div(float(1 - MOON_DISC_COS)), 0, 1)
  const moon_limb = mix(float(MOON_LIMB_EDGE), float(1), moon_rim_t)
  const moon_uv = disc_space_uv(view_dir, moon_dir).div(float(MOON_ANGULAR_RADIUS)).mul(0.5).add(0.5)
  const moon_surface = texture(moon_texture(), moon_uv).r
  const moon_amt = float(MOON_DISC_RADIANCE).mul(moon_edge.mul(moon_limb).mul(moon_surface))
  const moon_glow = vec3(MOON_DISC_RGB[0], MOON_DISC_RGB[1], MOON_DISC_RGB[2]).mul(moon_amt.mul(moon_up))
  // The night sky is exactly zero in daylight.
  const night = create_night_sky_node({
    seed: opts.seed,
    sun_dir: dyn.sun_dir,
    view_dir,
    with_base: true,
    with_milky_way: true,
  })
  // Hue-preserving smooth minimum on sky luma: the bright horizon stays blue under tone mapping and the
  // dark zenith is untouched. Sun and moon are added after the cap and keep full brightness.
  const cap_sky = (radiance: Node<'vec3'>) => {
    const sky_l = radiance.dot(vec3(0.2126, 0.7152, 0.0722)).max(float(1e-4))
    const sky_l_capped = sky_l.div(pow(float(1).add(pow(sky_l.div(A.horizon_cap), float(4))), float(0.25)))
    return radiance.mul(sky_l_capped.div(sky_l))
  }
  const sky_capped = cap_sky(sky_radiance)
  const background_node = sky_capped.add(sun_glow).add(moon_glow).add(night.node).max(0)

  const sample_sky = (dir: Node<'vec3'>): Node<'vec3'> =>
    cap_sky(luts.sample_skyview(dir.normalize()).mul(U.exposure)).max(0)

  // Aerial-perspective fog as three's fog(color, factor): factor = 1 - transmittance and
  // color = inscatter / factor. Density lifts the thin Earth-scale haze to a visible vista, capped at
  // factor_max; a day-gated multiply tilts it toward the shared cool tone and keeps sunsets warm.
  const frag_len = length(positionWorld.sub(cameraPosition))
  const frag_dist_km = frag_len.mul(dyn.units_to_km)
  const aerial = luts.sample_aerial(screenUV, frag_dist_km)
  const base_factor = clamp(float(1).sub(aerial.transmittance), 0, 1)
  const near_gate = smoothstep(A.near_fog_start, A.near_fog_full, frag_len)
  const fog_factor = base_factor.mul(A.haze_density).min(A.factor_max).mul(near_gate)
  const raw_color = aerial.inscatter.mul(U.exposure).div(max(base_factor, float(1e-3)))
  const tilt = mix(vec3(1, 1, 1), A.cool_tilt, day_f.mul(A.tilt_amt).clamp(0, 1))
  const fog_color = raw_color.mul(tilt)
  // Closed-form height-fog integral: humidity pools haze in valleys without another fullscreen pass.
  const ray_y_raw = positionWorld.y.sub(cameraPosition.y).div(frag_len.max(1e-3))
  const ray_sign = ray_y_raw.greaterThanEqual(0).select(float(1), float(-1))
  const ray_y = ray_sign.mul(abs(ray_y_raw).max(0.02))
  const camera_density = exp(cameraPosition.y.sub(A.height_base_y).mul(A.height_falloff).negate())
  const humid_density = A.height_density.mul(mix(float(0.45), float(1.25), A.height_humidity))
  const slope_amount = humid_density
    .div(A.height_falloff)
    .mul(camera_density)
    .mul(float(1).sub(exp(frag_len.mul(ray_y).mul(A.height_falloff).negate())))
    .div(ray_y)
  const horizontal_amount = humid_density.mul(camera_density).mul(frag_len)
  const height_amount = mix(horizontal_amount, slope_amount, smoothstep(0.015, 0.05, abs(ray_y_raw)))
  const height_factor = float(1)
    .sub(exp(height_amount.negate()))
    .mul(smoothstep(HEIGHT_FOG.near_clear, HEIGHT_FOG.full_distance, frag_len))
    .min(A.height_max)
  // A back-loaded terminal extinction hides the finite far shell. The three layers compose as
  // independent transmittances over the same in-scatter colour.
  const distance_progress = smoothstep(A.distance_fog_near, A.distance_fog_far, frag_len)
  const distance_factor = pow(distance_progress, float(DISTANCE_HAZE_POWER)).mul(DISTANCE_HAZE_MAX)
  const combined_factor = float(1).sub(
    float(1).sub(fog_factor).mul(float(1).sub(height_factor)).mul(float(1).sub(distance_factor))
  )
  const fog_node = fog(fog_color, combined_factor)

  const write_uniforms = () => {
    U.rayleigh_scattering.value.fromArray(params.rayleigh_scattering)
    U.rayleigh_density_h.value = params.rayleigh_density_h
    U.mie_scattering.value = params.mie_scattering
    U.mie_absorption.value = params.mie_absorption
    U.mie_g.value = params.mie_g
    U.mie_density_h.value = params.mie_density_h
    U.ozone_absorption.value.fromArray(params.ozone_absorption)
    U.ozone_center.value = params.ozone_center_km
    U.ozone_width.value = params.ozone_width_km
    U.ground_radius.value = params.ground_radius_km
    U.top_radius.value = params.top_radius_km
    U.ground_albedo.value.fromArray(params.ground_albedo)
    U.sun_illuminance.value.fromArray(params.sun_illuminance)
    U.exposure.value = params.exposure
    dyn.aerial_range_km.value = params.aerial_range_km
    dyn.aerial_depth_power.value = params.aerial_depth_power
    dyn.units_to_km.value = params.length_unit_m / 1000
  }

  const set_atmosphere_params = (partial: Partial<AtmosphereParams>): void => {
    params = { ...params, ...partial }
    write_uniforms()
    params_dirty = true
  }

  const set_tuning = (overrides: Partial<AtmosphereTuning> | null): void => {
    const value = resolve_atmosphere_tuning(opts.atmosphere, overrides)
    A.tilt_amt.value = value.tint
    A.haze_density.value = value.density
    A.factor_max.value = value.max_opacity
    A.near_fog_start.value = value.near
    A.near_fog_full.value = value.full
    A.height_density.value = opts.tier === 'high' ? value.height_density : 0
    A.height_max.value = value.height_max
    A.height_falloff.value = 1 / value.height_falloff
    A.horizon_cap.value = value.horizon_cap
    if (
      params.exposure !== value.exposure ||
      params.mie_scattering !== value.mie_scattering ||
      params.mie_g !== value.mie_g
    )
      set_atmosphere_params({ exposure: value.exposure, mie_scattering: value.mie_scattering, mie_g: value.mie_g })
  }

  const set_ground_haze = (ground_y: number, humidity: number): void => {
    A.height_base_y.value = ground_y + HEIGHT_FOG.base_offset
    A.height_humidity.value = Math.max(0, Math.min(1, humidity))
  }

  const bake = async (renderer: Renderer): Promise<void> => {
    k_transmittance = luts.build_transmittance_kernel()
    k_multiscatter = luts.build_multiscatter_kernel()
    k_skyview = luts.build_skyview_kernel()
    k_aerial = luts.build_aerial_kernel()
    // Multiscatter reads transmittance; the two view LUTs read both.
    await renderer.computeAsync(k_transmittance)
    await renderer.computeAsync(k_multiscatter)
    await renderer.computeAsync(k_skyview)
    await renderer.computeAsync(k_aerial)
  }

  const update_dynamic = (camera: PerspectiveCamera): void => {
    dyn.cam_height_km.value = Math.max(0.002, (camera.position.y * params.length_unit_m) / 1000)
    const e = camera.matrixWorld.elements
    _right.set(e[0], e[1], e[2]).normalize()
    _up.set(e[4], e[5], e[6]).normalize()
    _fwd.set(-e[8], -e[9], -e[10]).normalize()
    dyn.cam_right.value.copy(_right)
    dyn.cam_up.value.copy(_up)
    dyn.cam_fwd.value.copy(_fwd)
    const half_y = Math.tan(((camera.fov ?? 70) * Math.PI) / 180 / 2)
    dyn.tan_half_y.value = half_y
    dyn.tan_half_x.value = half_y * (camera.aspect ?? 1)
  }

  const tick = (renderer: Renderer, camera: PerspectiveCamera): void => {
    if (!k_skyview) return
    update_dynamic(camera)
    night.tick(sun_direction.value)
    let force = false
    if (params_dirty) {
      renderer.compute(k_transmittance!)
      renderer.compute(k_multiscatter!)
      params_dirty = false
      force = true
    }
    // Sky-view depends on the sun and camera altitude; the aerial volume also on camera orientation.
    const sun = sun_direction.value
    // 0.9999939 is about 0.2 degrees of travel.
    const sky_dirty = force || last_sun.dot(sun) < 0.9999939 || Math.abs(dyn.cam_height_km.value - last_alt) > 0.001
    const orient_moved = last_fwd.dot(dyn.cam_fwd.value) < 0.9999939
    if (sky_dirty) {
      renderer.compute(k_skyview)
      last_sun.copy(sun)
      last_alt = dyn.cam_height_km.value
    }
    if (sky_dirty || orient_moved) {
      renderer.compute(k_aerial!)
      last_fwd.copy(dyn.cam_fwd.value)
    }
  }

  const dispose = () => {
    k_transmittance = null
    k_multiscatter = null
    k_skyview = null
    k_aerial = null
    luts.dispose()
  }

  return {
    sun_direction,
    background_node,
    fog_node,
    sample_sky,
    set_tuning,
    set_ground_haze,
    bake,
    tick,
    dispose,
  }
}
