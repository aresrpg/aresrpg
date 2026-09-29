// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AdditiveBlending, InstancedBufferAttribute, Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraWorldMatrix,
  cameraPosition,
  varying,
  float,
  fract,
  positionLocal,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

import { TRANSPARENT_ORDER } from './transparent_order.ts'
import { mulberry } from './nature/sprite_kit.ts'
import { particle_geometry } from './scenery_particles.ts'
import type { SceneryGlow, SceneryVolume, WorldScenery } from './scenery_data.ts'
import type { EngineQuality } from './types.ts'

export const SNOW_COUNTS = Object.freeze({ low: 96, medium: 384, high: 768 })
const snow_mesh = (volumes: readonly SceneryVolume[]) => {
  const random = mulberry(7041)
  const rows = Array.from({ length: volumes.length * SNOW_COUNTS.high }, (_, index) => {
    const volume = volumes[index % volumes.length]!
    return {
      center: [
        volume.center[0] + (random() - 0.5) * volume.size[0],
        volume.center[1],
        volume.center[2] + (random() - 0.5) * volume.size[2],
      ],
      size: 0.06 + random() * 0.2,
      phase: random(),
      height: volume.size[1],
    }
  })
  const geometry = particle_geometry(rows, 64)
  geometry.setAttribute('snow_height', new InstancedBufferAttribute(new Float32Array(rows.map((row) => row.height)), 1))
  const center = attribute('scenery_center', 'vec3' as const)
  const size = attribute('scenery_size', 'float' as const)
  const phase = attribute('scenery_phase', 'float' as const)
  const height = attribute('snow_height', 'float' as const)
  const fall = fract(time.mul(-0.045).add(phase))
  const wind = time.mul(0.4).add(phase.mul(19))
  const drift = vec3(
    sin(wind).mul(4).add(fall.sub(0.5).mul(-18)),
    fall.sub(0.5).mul(height),
    sin(wind.mul(0.7)).mul(2.5)
  )
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = center.add(drift).add(cameraWorldMatrix.mul(vec4(positionLocal.xy.mul(size), 0, 0)).xyz)
  const near_fade = smoothstep(2, 6, varying(center.add(drift).sub(cameraPosition).length()))
  material.colorNode = vec3(0.8, 0.9, 1)
  material.opacityNode = smoothstep(0.05, 0.25, fall)
    .mul(float(1).sub(smoothstep(0.8, 0.98, fall)))
    .mul(uv().sub(0.5).length().mul(2).oneMinus().max(0))
    .mul(0.8)
    .mul(near_fade)
  const mesh = new Mesh(geometry, material)
  mesh.renderOrder = TRANSPARENT_ORDER.snow
  return mesh
}
const glow_mesh = (glows: readonly SceneryGlow[]) => {
  const geometry = particle_geometry(
    glows.map((glow, index) => ({ ...glow, phase: index })),
    1
  )
  geometry.setAttribute(
    'glow_color',
    new InstancedBufferAttribute(new Float32Array(glows.flatMap(({ color }) => [...color])), 3)
  )
  const center = attribute('scenery_center', 'vec3' as const)
  const size = attribute('scenery_size', 'float' as const)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending })
  material.positionNode = center.add(cameraWorldMatrix.mul(vec4(positionLocal.xy.mul(size), 0, 0)).xyz)
  material.colorNode = attribute('glow_color', 'vec3' as const)
  material.opacityNode = uv().sub(0.5).length().mul(2).oneMinus().max(0).pow(3).mul(0.65)
  return new Mesh(geometry, material)
}
export const create_seasonal_scenery = (scenery: WorldScenery) => {
  const volumes = scenery.snow ?? []
  const snow = volumes.length ? snow_mesh(volumes) : null
  const glows = scenery.glows?.length ? glow_mesh(scenery.glows) : null
  return {
    meshes: [snow, glows].filter((mesh) => mesh !== null),
    set_quality: (quality: EngineQuality): void => {
      if (snow) snow.geometry.instanceCount = volumes.length * SNOW_COUNTS[quality]
    },
  }
}
