// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Low-resolution local volumetrics. A short bounded march adds humid ground fog; the shared
// cloud transmittance gates direct sun scatter, producing coherent moving shafts below gaps.

import { Matrix4, Vector3, type PerspectiveCamera } from 'three'
import type { Node } from 'three/webgpu'
import {
  Fn,
  Loop,
  clamp,
  exp,
  float,
  getViewPosition,
  length,
  max,
  min,
  mix,
  pow,
  screenUV,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'

import type { Clouds } from './clouds.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { derive_sub_seed } from './world_noise.ts'

const FOG_BASE_DENSITY = 0.012
const FOG_HEIGHT_FALLOFF = 22
const FOG_MAX_DISTANCE = 190
const FOUR_PI = Math.PI * 4
const PHASE_G = 0.62

const smooth = (edge_0: number, edge_1: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - edge_0) / (edge_1 - edge_0)))
  return amount * amount * (3 - 2 * amount)
}

/** Pure density twin used to pin the climate and height laws independently of WebGPU. */
export const fog_density = ({
  humidity,
  height,
  region,
}: Readonly<{ humidity: number; height: number; region: number }>): number =>
  FOG_BASE_DENSITY *
  smooth(0.3, 0.85, humidity) *
  Math.exp(-Math.max(0, height) / FOG_HEIGHT_FALLOFF) *
  Math.max(0, Math.min(1, region))

export type AtmospherePass = Readonly<{
  output: Node<'vec4'>
  set_humidity: (humidity: number) => void
  update: () => void
  dispose: () => void
}>

export const create_atmosphere_pass = ({
  camera,
  depth,
  steps,
  seed,
  sky,
  clouds,
}: Readonly<{
  camera: PerspectiveCamera
  depth: Node<'float'>
  steps: number
  seed: string
  sky: Pick<ReturnType<typeof create_sky_node>, 'sample_sky_dome' | 'sun_direction'>
  clouds: Clouds
}>): AtmospherePass => {
  const humidity = uniform(0.55)
  const camera_world = uniform(new Matrix4())
  const projection_inverse = uniform(new Matrix4())
  const camera_position = uniform(new Vector3())
  const seed_value = derive_sub_seed(seed, 'local-fog') / 0xffffffff
  const seed_phase = float(seed_value * Math.PI * 2)
  const step_count = Math.max(1, Math.floor(steps))

  const output = Fn(() => {
    const view_position = getViewPosition(screenUV, depth, projection_inverse)
    const world_hit = camera_world.mul(vec4(view_position.xyz, 1)).xyz
    const to_hit = world_hit.sub(camera_position)
    const hit_distance = length(to_hit)
    const ray = to_hit.div(max(hit_distance, float(1e-3)))
    const march_distance = min(hit_distance, float(FOG_MAX_DISTANCE))
    const step_length = march_distance.div(step_count)
    const transmission = float(1).toVar()
    const scattering = vec3(0).toVar()

    const g = float(PHASE_G)
    const g_squared = g.mul(g)
    const phase_denominator = pow(
      max(
        float(1e-4),
        float(1)
          .add(g_squared)
          .sub(g.mul(ray.dot(sky.sun_direction)).mul(2))
      ),
      1.5
    )
    const phase = float(1).sub(g_squared).div(phase_denominator.mul(FOUR_PI))
    const daylight = smoothstep(-0.08, 0.18, sky.sun_direction.y)
    const ambient_color = sky.sample_sky_dome(vec3(0, 1, 0)).mul(0.24)
    const sun_color = mix(vec3(1, 0.48, 0.2), vec3(1, 0.94, 0.82), smoothstep(-0.02, 0.25, sky.sun_direction.y))

    Loop(step_count, ({ i }) => {
      const distance = float(i).add(0.5).mul(step_length)
      const position = camera_position.add(ray.mul(distance))
      const wind_x = time.mul(1.7)
      const wind_z = time.mul(0.53)
      const region_field = sin(position.x.add(wind_x).mul(0.014).add(seed_phase))
        .mul(0.34)
        .add(sin(position.z.sub(wind_z).mul(0.011).sub(seed_phase.mul(0.7))).mul(0.29))
        .add(sin(position.x.add(position.z).mul(0.0063).add(seed_phase.mul(1.9))).mul(0.37))
        .mul(0.5)
        .add(0.5)
      const region = smoothstep(0.38, 0.7, region_field)
      const humidity_gate = smoothstep(0.3, 0.85, clamp(humidity, 0, 1))
      const height_density = exp(max(position.y, 0).div(FOG_HEIGHT_FALLOFF).negate())
      const density = region.mul(humidity_gate).mul(height_density).mul(FOG_BASE_DENSITY)
      const segment_transmission = exp(density.mul(step_length).negate())
      const cloud_light = clouds.shadow_at(position.xz, position.y)
      const sun_visibility = smoothstep(0.73, 0.99, cloud_light).mul(daylight)
      const light = ambient_color.add(sun_color.mul(sun_visibility).mul(phase).mul(5.5))
      scattering.addAssign(transmission.mul(float(1).sub(segment_transmission)).mul(light))
      transmission.mulAssign(segment_transmission)
    })

    return vec4(scattering, transmission)
  })() as Node<'vec4'>

  let disposed = false
  return Object.freeze({
    output,
    set_humidity: (value: number) => {
      humidity.value = Math.min(1, Math.max(0, value))
    },
    update: () => {
      if (disposed) return
      camera_position.value.copy(camera.position)
      camera_world.value.copy(camera.matrixWorld)
      projection_inverse.value.copy(camera.projectionMatrixInverse)
    },
    dispose: () => {
      disposed = true
    },
  })
}
