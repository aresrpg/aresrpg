// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DirectionalLight, PerspectiveCamera, Vector2, Vector3 } from 'three'
import type { Node } from 'three/webgpu'
import { float, hash, luminance, screenUV, smoothstep, uniform, vec2, vec3 } from 'three/tsl'

import type { QualityProfile } from './types.ts'

type ShaftConfig = NonNullable<QualityProfile['effects']['sun_shafts']>
type SampledTexture = Node<'vec4'> & Readonly<{ sample: (uv: Node<'vec2'>) => Node<'vec4'> }>
type VectorUniform = Node<'vec3'> & { value: Vector3 }

export const sun_shafts_sample_gain = (samples: number): number => 12 / Math.max(1, samples)

export const sun_shafts_visibility = ({
  sun_y,
  view_dot_sun,
  ndc_x,
  ndc_y,
  submerged,
}: Readonly<{
  sun_y: number
  view_dot_sun: number
  ndc_x: number
  ndc_y: number
  submerged: boolean
}>): number => {
  if (submerged || sun_y <= 0.03 || view_dot_sun <= 0.02) return 0
  const edge = Math.max(Math.abs(ndc_x), Math.abs(ndc_y))
  if (edge >= 2.25) return 0
  if (edge <= 1.05) return 1
  const progress = (edge - 1.05) / 1.2
  const smooth_progress = progress * progress * (3 - 2 * progress)
  return 1 - smooth_progress
}

export const sun_shafts_visible = (input: Parameters<typeof sun_shafts_visibility>[0]): boolean =>
  sun_shafts_visibility(input) > 0

export const sun_shafts_source_threshold = (base: number, ndc_x: number, ndc_y: number): number => {
  const edge = Math.max(Math.abs(ndc_x), Math.abs(ndc_y))
  const peripheral = Math.max(0, Math.min(1, (edge - 1.05) / 1.2))
  return base * (1 - peripheral * 0.35)
}

export const create_sun_shafts = ({
  camera,
  sun,
  sun_direction,
  scene_texture,
  config,
}: Readonly<{
  camera: PerspectiveCamera
  sun: DirectionalLight
  sun_direction: VectorUniform
  scene_texture: SampledTexture
  config: ShaftConfig
}>) => {
  const sun_uv = uniform(new Vector2(0.5, 0.5))
  const sun_color = uniform(new Vector3(1, 1, 1))
  const active = uniform(0)
  const source_threshold = uniform(config.threshold)
  const delta = (screenUV as unknown as Node<'vec2'>).sub(sun_uv).mul(config.density / config.samples)
  const jitter = hash((screenUV as unknown as Node<'vec2'>).mul(vec2(4096, 2160)))
  let sample_uv = (screenUV as unknown as Node<'vec2'>).sub(delta.mul(jitter))
  let illumination: Node<'float'> = float(1)
  let energy: Node<'float'> = float(0)
  for (let index = 0; index < config.samples; index += 1) {
    sample_uv = sample_uv.sub(delta)
    const sample = scene_texture.sample(sample_uv)
    const inside = sample_uv.x
      .greaterThanEqual(0)
      .and(sample_uv.x.lessThanEqual(1))
      .and(sample_uv.y.greaterThanEqual(0))
      .and(sample_uv.y.lessThanEqual(1))
      .select(float(1), float(0))
    const source = smoothstep(source_threshold, source_threshold.add(1), luminance(sample.rgb)).mul(inside)
    energy = energy.add(source.mul(illumination))
    illumination = illumination.mul(config.decay)
  }
  const color = sun_color
    .mul(energy.mul(config.strength * sun_shafts_sample_gain(config.samples)).mul(active))
    .max(vec3(0)) as Node<'vec3'>
  const projected = new Vector3()
  const forward = new Vector3()
  const direction = new Vector3()
  return Object.freeze({
    color,
    active,
    update: (submerged: boolean): boolean => {
      direction.copy(sun_direction.value).normalize()
      camera.getWorldDirection(forward)
      projected.copy(camera.position).addScaledVector(direction, 10_000).project(camera)
      const visibility = sun_shafts_visibility({
        sun_y: direction.y,
        view_dot_sun: forward.dot(direction),
        ndc_x: projected.x,
        ndc_y: projected.y,
        submerged,
      })
      sun_uv.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5)
      source_threshold.value = sun_shafts_source_threshold(config.threshold, projected.x, projected.y)
      sun_color.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(Math.min(4, Math.max(0, sun.intensity)))
      active.value = visibility
      return visibility > 0
    },
  })
}
