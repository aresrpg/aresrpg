// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A single flat cloud deck. The visible layer and its terrain/water shadow sample the same
// continuous field, so clouds remain cheap and their moving shade cannot drift out of sync.

import { Mesh, PlaneGeometry, type Scene } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  abs,
  cameraPosition,
  clamp,
  float,
  max,
  mix,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'

import type { create_sky_node } from './sky/sky_node.ts'
import type { EngineQuality, Vec3 } from './types.ts'
import { derive_sub_seed } from './world_noise.ts'

const CLOUD_HEIGHT = 180
const CLOUD_SPAN = 5_600
const CLOUD_DRIFT = [7.5, 2.3] as const
const CLOUD_SHADOW = Object.freeze({ medium: 0.35, high: 0.55 })
const CLOUD_THRESHOLD_DRY = 0.6
const CLOUD_THRESHOLD_HUMID = 0.42

type ShadowProjection = Readonly<{ height: number; sun_direction: Vec3; cloud_height: number }>

/** Pure coordinate twin of the shader projection. Visible samples omit `shadow`; ground samples
 * travel toward the sun until they meet the cloud plane. Both then subtract the same drift. */
export const cloud_sample_xz = (
  xz: readonly [number, number],
  drift: readonly [number, number],
  shadow?: ShadowProjection
): readonly [number, number] => {
  if (shadow === undefined) return [xz[0] - drift[0], xz[1] - drift[1]]
  const sun_y = Math.max(0.12, shadow.sun_direction[1])
  const distance_y = Math.max(0, shadow.cloud_height - shadow.height)
  return [
    xz[0] + (shadow.sun_direction[0] * distance_y) / sun_y - drift[0],
    xz[1] + (shadow.sun_direction[2] * distance_y) / sun_y - drift[1],
  ]
}

export const cloud_shadow_strength = (quality: EngineQuality): number => (quality === 'low' ? 0 : CLOUD_SHADOW[quality])
export const cloud_layer_visible = (quality: EngineQuality, fight_active: boolean): boolean =>
  quality !== 'low' && !fight_active

export const cloud_coverage_threshold = (humidity: number): number => {
  const amount = Math.min(1, Math.max(0, humidity))
  return CLOUD_THRESHOLD_DRY + (CLOUD_THRESHOLD_HUMID - CLOUD_THRESHOLD_DRY) * amount
}

export type Clouds = Readonly<{
  shadow_at: (world_xz: Node<'vec2'>, world_y: Node<'float'>) => Node<'float'>
  set_focus: (x: number, z: number) => void
  set_humidity: (humidity: number) => void
  set_quality: (quality: EngineQuality) => void
  set_active: (active: boolean) => void
  dispose: () => void
}>

export const create_clouds = ({
  scene,
  quality,
  seed,
  sky,
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  seed: string
  sky: Pick<ReturnType<typeof create_sky_node>, 'sample_sky_dome' | 'sun_direction'>
}>): Clouds => {
  const seed_value = derive_sub_seed(seed, 'clouds') / 0xffffffff
  let active = true
  let current_quality = quality
  const seed_offset = vec2(seed_value * 173.7, seed_value * -91.3)
  const humidity = uniform(0.55)
  const shadow_strength = uniform(cloud_shadow_strength(quality))
  const drift = vec2(time.mul(CLOUD_DRIFT[0]), time.mul(CLOUD_DRIFT[1]))

  // Four warped incommensurate waves form broad connected masses without a texture bake,
  // raymarch, storage texture, or visible tile boundary.
  const density_at = (sample_xz: Node<'vec2'>): Node<'float'> => {
    const p = sample_xz.sub(drift).mul(0.0042).add(seed_offset)
    const q = vec2(p.x.add(sin(p.y.mul(0.73)).mul(1.35)), p.y.add(sin(p.x.mul(0.57)).mul(1.1)))
    const field = sin(q.x.mul(1.03))
      .mul(0.34)
      .add(sin(q.y.mul(1.27)).mul(0.27))
      .add(sin(q.x.add(q.y).mul(2.17)).mul(0.22))
      .add(sin(q.x.mul(0.71).sub(q.y).mul(3.83)).mul(0.17))
      .mul(0.5)
      .add(0.5)
    // Dry regions keep sparse weather. Humidity expands those same masses instead of deciding
    // whether clouds exist at all, so an arid camera position cannot disable the whole effect.
    const threshold = mix(float(CLOUD_THRESHOLD_DRY), float(CLOUD_THRESHOLD_HUMID), clamp(humidity, 0, 1))
    return smoothstep(threshold, threshold.add(0.14), field) as Node<'float'>
  }

  const daylight = smoothstep(-0.08, 0.18, sky.sun_direction.y)
  const shadow_at: Clouds['shadow_at'] = (world_xz, world_y) => {
    const height_to_cloud = max(float(CLOUD_HEIGHT).sub(world_y), 0)
    const projected = world_xz.add(sky.sun_direction.xz.mul(height_to_cloud.div(max(sky.sun_direction.y, float(0.12)))))
    const density = density_at(projected)
    return float(1).sub(density.mul(shadow_strength).mul(daylight)) as Node<'float'>
  }

  const geometry = new PlaneGeometry(CLOUD_SPAN, CLOUD_SPAN)
  geometry.rotateX(-Math.PI / 2)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const density = density_at(positionWorld.xz)
  const edge_distance = max(abs(positionWorld.x.sub(cameraPosition.x)), abs(positionWorld.z.sub(cameraPosition.z)))
  const footprint_fade = float(1).sub(smoothstep(CLOUD_SPAN * 0.38, CLOUD_SPAN * 0.49, edge_distance))
  const view_direction = positionWorld.sub(cameraPosition).normalize()
  const silver_lining = pow(max(view_direction.dot(sky.sun_direction), 0), 10)
    .mul(float(1).sub(density))
    .mul(daylight)
  const sky_overhead = sky.sample_sky_dome(vec3(0, 1, 0))
  const night_cloud = vec3(0.018, 0.025, 0.045)
  const day_cloud = mix(sky_overhead.mul(0.58), vec3(0.82, 0.86, 0.9), 0.42)
  material.colorNode = mix(night_cloud, day_cloud, daylight).add(vec3(silver_lining.mul(0.8)))
  material.opacityNode = density.mul(0.82).mul(footprint_fade)
  material.alphaTest = 0.015
  material.fog = true

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.position.y = CLOUD_HEIGHT
  mesh.visible = cloud_layer_visible(quality, false)
  mesh.updateMatrix()
  scene.add(mesh)

  return Object.freeze({
    shadow_at,
    set_focus: (x: number, z: number) => {
      mesh.position.set(Math.round(x / 256) * 256, CLOUD_HEIGHT, Math.round(z / 256) * 256)
      mesh.updateMatrix()
    },
    set_humidity: (value: number) => {
      humidity.value = Math.min(1, Math.max(0, value))
    },
    set_quality: (next: EngineQuality) => {
      current_quality = next
      mesh.visible = cloud_layer_visible(current_quality, !active)
      shadow_strength.value = active ? cloud_shadow_strength(current_quality) : 0
    },
    set_active: (next: boolean) => {
      active = next
      mesh.visible = cloud_layer_visible(current_quality, !active)
      shadow_strength.value = active ? cloud_shadow_strength(current_quality) : 0
    },
    dispose: () => {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  })
}
