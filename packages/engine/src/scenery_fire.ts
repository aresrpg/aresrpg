// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraWorldMatrix,
  float,
  fract,
  mix,
  positionLocal,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

import { particle_geometry } from './scenery_particles.ts'
import type { SceneryFire } from './scenery_data.ts'
import type { EngineQuality } from './types.ts'

export const FIRE_COUNTS = Object.freeze({ low: 3, medium: 5, high: 7 })

const FIRE_STYLE = Object.freeze({
  flame: { speed: 0.65, spread: 0.3, drift: 0.1, rise: 0.85, base: 0.55, growth: -0.55, size: 1.2, height: 1.65 },
  smoke: { speed: 0.18, spread: 0.35, drift: 1.1, rise: 5, base: 1.2, growth: 1.3, size: 0.7, height: 1 },
})

const fire_batch = (fires: readonly SceneryFire[], kind: keyof typeof FIRE_STYLE) => {
  const style = FIRE_STYLE[kind]
  // Interleaving preserves every hearth when quality reduces the instance prefix.
  const rows = Array.from({ length: fires.length * FIRE_COUNTS.high }, (_, index) => ({
    center: fires[index % fires.length]!.center,
    size: fires[index % fires.length]!.scale,
    phase: Math.floor(index / fires.length) / FIRE_COUNTS.high + (index % fires.length) * 0.137,
  }))
  const geometry = particle_geometry(rows, 20)
  const center = attribute('scenery_center', 'vec3' as const)
  const scale = attribute('scenery_size', 'float' as const)
  const phase = attribute('scenery_phase', 'float' as const)
  const age = fract(time.mul(style.speed).add(phase))
  const pulse = sin(time.mul(5).add(phase.mul(29)))
  const drift = vec3(
    sin(phase.mul(37)).mul(style.spread).add(age.mul(style.drift)),
    age.mul(style.rise).add(style.base),
    sin(phase.mul(53)).mul(0.25)
  ).mul(scale)
  const size = age.mul(style.growth).add(style.size)
  const quad = vec3(positionLocal.x, positionLocal.y.mul(style.height), 0).mul(size).mul(scale)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = center.add(drift).add(cameraWorldMatrix.mul(vec4(quad, 0)).xyz)
  // Quantized UVs keep the silhouette pixel-shaped, while motion stays smooth.
  const pixel = uv().mul(16).floor().add(0.5).div(16)
  const x = pixel.x.sub(0.5).abs().mul(2)
  const { y } = pixel
  const fade = smoothstep(0, 0.12, age).mul(float(1).sub(smoothstep(0.65, 1, age)))
  if (kind === 'smoke') {
    const edge = smoothstep(0.45, 0.95, pixel.sub(0.5).length().mul(2)).oneMinus()
    material.colorNode = mix(vec3(0.16, 0.15, 0.14), vec3(0.38, 0.37, 0.35), age)
    material.opacityNode = edge.mul(fade).mul(0.22)
  } else {
    const width = y
      .oneMinus()
      .mul(0.75)
      .add(pulse.mul(0.07))
      .add(sin(y.mul(17).sub(time.mul(8)).add(phase.mul(31))).mul(0.12))
    const mask = smoothstep(width, width.add(0.09), x)
      .oneMinus()
      .mul(smoothstep(0, 0.12, y))
    const heat = y.mul(0.8).add(x.mul(0.35)).clamp(0, 1)
    material.colorNode = mix(vec3(3, 1.6, 0.22), vec3(1.8, 0.13, 0.015), heat)
    material.opacityNode = mask.mul(fade).mul(0.92)
  }
  material.alphaTest = 0.01
  return new Mesh(geometry, material)
}

/** Two shared billboard batches; no per-fire objects, timers, lights or CPU particle updates. */
export const scenery_fire = (fires: readonly SceneryFire[] = []) => {
  const meshes = fires.length === 0 ? [] : [fire_batch(fires, 'flame'), fire_batch(fires, 'smoke')]
  return {
    meshes,
    set_quality: (quality: EngineQuality): void => {
      meshes.forEach((mesh) => {
        mesh.geometry.instanceCount = fires.length * FIRE_COUNTS[quality]
      })
    },
  }
}
