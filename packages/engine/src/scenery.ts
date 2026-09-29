// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AdditiveBlending, DoubleSide, InstancedBufferAttribute, Mesh, PlaneGeometry, type Scene } from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraWorldMatrix,
  mix,
  positionLocal,
  sin,
  smoothstep,
  time,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { scenery_butterflies, BUTTERFLY_BUDGET } from './scenery_butterflies.ts'
import { create_scenery_lights } from './scenery_lights.ts'
import { scenery_flora } from './scenery_flora.ts'
import { scenery_fire } from './scenery_fire.ts'
import { particle_geometry, type Particle } from './scenery_particles.ts'
import { create_seasonal_scenery } from './seasonal_scenery.ts'
import { mulberry } from './nature/sprite_kit.ts'
import { SCENERY_BUDGET, type WorldScenery } from './scenery_data.ts'
import type { EnginePresentation, EngineQuality } from './types.ts'

const PARTICLE_STYLE = Object.freeze({
  mist: { speed: 0.12, drift: [3, 1.5, 2], edge: 0.12, opacity: 0.15 },
  spores: { speed: 0.4, drift: [0.7, 1, 0.7], edge: 0.05, opacity: 0.85 },
})

const particle_material = (mist: boolean): MeshBasicNodeMaterial => {
  const style = PARTICLE_STYLE[mist ? 'mist' : 'spores']
  const center = attribute('scenery_center', 'vec3' as const)
  const size = attribute('scenery_size', 'float' as const)
  const phase = attribute('scenery_phase', 'float' as const)
  const clock = time.mul(style.speed).add(phase)
  const drift = vec3(
    sin(clock).mul(style.drift[0]!),
    sin(clock.mul(0.7)).mul(style.drift[1]!),
    sin(clock.mul(0.8)).mul(style.drift[2]!)
  )
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.positionNode = center.add(drift).add(cameraWorldMatrix.mul(vec4(positionLocal.xy.mul(size), 0, 0)).xyz)
  const radius = uv().sub(0.5).length().mul(2)
  const edge = smoothstep(style.edge, 1, radius).oneMinus()
  const pulse = sin(clock.mul(1.6)).mul(0.25).add(0.75)
  material.colorNode = mist
    ? vec3(0.68, 0.83, 0.9)
    : mix(vec3(0.12, 1.8, 1.5), vec3(1.1, 0.35, 2), sin(phase).mul(0.5).add(0.5))
  material.opacityNode = edge.pow(2).mul(pulse).mul(style.opacity)
  if (!mist) material.blending = AdditiveBlending
  material.alphaTest = 0.005
  return material
}

const waterfall_mesh = (scenery: WorldScenery) => {
  const rows = scenery.waterfalls.map(({ top, width }, index) => ({ center: top, size: width, phase: index }))
  const geometry = particle_geometry(rows, 383)
  geometry.setAttribute(
    'scenery_height',
    new InstancedBufferAttribute(new Float32Array(scenery.waterfalls.map(({ top, bottom_y }) => top[1] - bottom_y)), 1)
  )
  geometry.setAttribute(
    'scenery_yaw',
    new InstancedBufferAttribute(new Float32Array(scenery.waterfalls.map(({ yaw }) => yaw)), 1)
  )
  const width = attribute('scenery_size', 'float' as const)
  const height = attribute('scenery_height', 'float' as const)
  const yaw = attribute('scenery_yaw', 'float' as const)
  const top = attribute('scenery_center', 'vec3' as const)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.positionNode = top.add(
    vec3(
      positionLocal.x.mul(width).mul(yaw.cos()),
      positionLocal.y.sub(0.5).mul(height),
      positionLocal.x.mul(width).mul(yaw.sin()).sub(positionLocal.y.sub(0.5).negate().mul(12).mul(yaw.cos()))
    )
  )
  const ribbon = sin(
    uv()
      .x.mul(width)
      .mul(3.7)
      .add(sin(uv().y.mul(17).add(time.mul(2))))
  )
    .mul(0.5)
    .add(0.5)
  const flow = sin(uv().y.mul(height).mul(1.4).add(time.mul(13)).add(uv().x.mul(37)))
    .mul(0.5)
    .add(0.5)
  const foam = ribbon.mul(0.65).add(flow.mul(0.35))
  material.colorNode = mix(vec3(0.11, 0.48, 0.64), vec3(1.5, 1.8, 1.9), foam.pow(1.4))
  const sides = smoothstep(0, 0.08, uv().x).mul(smoothstep(0, 0.08, uv().x.oneMinus()))
  material.opacityNode = sides.mul(smoothstep(0, 0.06, uv().y)).mul(foam.mul(0.3).add(0.65))

  return new Mesh(geometry, material)
}

const vine_mesh = (scenery: WorldScenery) => {
  const rows = scenery.vines.map(({ top, length, yaw }) => ({ center: top, size: length, phase: yaw }))
  const geometry = particle_geometry(rows, 33)
  const center = attribute('scenery_center', 'vec3' as const)
  const length = attribute('scenery_size', 'float' as const)
  const yaw = attribute('scenery_phase', 'float' as const)
  const wave = sin(time.mul(0.6).add(center.x).add(positionLocal.y.mul(2)))
    .mul(0.12)
    .mul(positionLocal.y.sub(0.5).abs())
  const lateral = positionLocal.x.mul(0.85).add(wave)
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.9, alphaTest: 0.4 })
  material.positionNode = center.add(
    vec3(lateral.mul(yaw.cos()), positionLocal.y.sub(0.5).mul(length), lateral.mul(yaw.sin()))
  )
  // Broken, staggered ivy patches: each leaf varies its position, angle, size and survival.
  const row = uv().y.mul(length).mul(3)
  const grid = vec2(uv().x.mul(3).add(row.floor().mod(2).mul(0.5)), row)
  const cell = grid.floor()
  const seed = sin(cell.x.mul(127.1).add(cell.y.mul(31.7)).add(center.x.mul(13)).add(center.z.mul(7)))
    .mul(43758.5453)
    .fract()
  const variation = sin(cell.x.mul(53.7).add(cell.y.mul(97.1)).add(center.z))
    .mul(19513.31)
    .fract()
  const pixel = grid.fract().mul(12).floor().add(0.5).div(12)
  const dx = pixel.x.sub(seed.mul(0.3).add(0.35))
  const dy = pixel.y.sub(variation.mul(0.3).add(0.35))
  const angle = seed.sub(0.5).mul(2.4)
  const size = variation.mul(0.25).add(0.3)
  const px = dx.mul(angle.cos()).sub(dy.mul(angle.sin())).div(size)
  const py = dx.mul(angle.sin()).add(dy.mul(angle.cos())).div(size)
  const leaf = smoothstep(0.8, 1, px.abs().mul(0.65).add(py.abs())).oneMinus()
  const patch = sin(row.mul(0.8).add(center.x)).mul(0.18).add(0.32)
  const gap = smoothstep(patch, patch.add(0.08), seed)
  const vein = smoothstep(0.04, 0.12, px.abs()).oneMinus().mul(0.1)
  material.opacityNode = leaf.mul(gap)
  material.colorNode = mix(vec3(0.03, 0.09, 0.012), vec3(0.17, 0.32, 0.045), variation.mul(0.8).add(vein))
  return new Mesh(geometry, material)
}

const particle_rows = (scenery: WorldScenery, mist: boolean): readonly Particle[] => {
  const random = mulberry(mist ? 8123 : 5427)
  const volumes = mist
    ? [
        ...(scenery.mist ?? []),
        ...scenery.waterfalls.map(({ top, bottom_y, width }) => ({
          center: [top[0], bottom_y + 3, top[2]],
          size: [width * 1.5, 7, 9],
        })),
      ]
    : scenery.spores
  const count = mist ? SCENERY_BUDGET.high.mist_per_volume : SCENERY_BUDGET.high.spores_per_volume
  // Interleave volumes so quality changes retain a representative prefix without rebuilding buffers.
  return Array.from({ length: volumes.length * count }, (_, index) => {
    const volume = volumes[index % volumes.length]!
    return {
      center: volume.center.map((value, axis) => value + (random() - 0.5) * volume.size[axis]!),
      size: mist ? 10 + random() * 12 : 0.06 + random() * 0.14,
      phase: random() * Math.PI * 2,
    }
  })
}

/** Four bounded batches, no textures, lights, timers, CPU particle simulation or extra render passes. */
export const create_scenery = ({
  scene,
  scenery,
  presentation,
}: Readonly<{ scene: Scene; scenery?: WorldScenery; presentation: EnginePresentation }>) => {
  if (!scenery || presentation !== 'world')
    return Object.freeze({
      set_visible: (_visible: boolean): void => {},
      set_quality: (_quality: EngineQuality): void => {},
      dispose: (): void => {},
    })
  const falls = waterfall_mesh(scenery)
  const mist = new Mesh(particle_geometry(particle_rows(scenery, true), 4), particle_material(true))
  const spores = new Mesh(particle_geometry(particle_rows(scenery, false), 2), particle_material(false))
  const vines = vine_mesh(scenery)
  const seasonal = create_seasonal_scenery(scenery)
  const lights = create_scenery_lights(scene, scenery.glows ?? [])
  const butterflies = scenery_butterflies(scenery.butterflies ?? [])
  const flora = scenery_flora(scenery.plants ?? [])
  const fires = scenery_fire(scenery.fires)
  const meshes = [falls, mist, spores, vines, ...seasonal.meshes, ...fires.meshes, flora, butterflies].filter(
    (mesh) => mesh !== null
  )
  meshes.forEach((mesh) => {
    mesh.visible = false
    scene.add(mesh)
  })
  return Object.freeze({
    set_visible: (visible: boolean): void => {
      lights.set_visible(visible)
      const active = visible
      if (falls.visible !== active)
        meshes.forEach((mesh) => {
          mesh.visible = active
        })
    },
    set_quality: (quality: EngineQuality): void => {
      if (butterflies)
        butterflies.geometry.instanceCount = (scenery.butterflies?.length ?? 0) * BUTTERFLY_BUDGET[quality]
      seasonal.set_quality(quality)
      fires.set_quality(quality)
      lights.set_quality(quality)
      mist.geometry.instanceCount =
        (scenery.waterfalls.length + (scenery.mist?.length ?? 0)) * SCENERY_BUDGET[quality].mist_per_volume
      spores.geometry.instanceCount = scenery.spores.length * SCENERY_BUDGET[quality].spores_per_volume
    },
    dispose: (): void => {
      lights.dispose()
      meshes.forEach((mesh) => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
      })
    },
  })
}
