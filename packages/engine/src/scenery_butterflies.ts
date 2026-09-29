// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { BufferAttribute, DoubleSide, Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, cos, mix, positionLocal, sin, time, vec3 } from 'three/tsl'

import { particle_geometry } from './scenery_particles.ts'
import { mulberry } from './nature/sprite_kit.ts'
import type { SceneryVolume } from './scenery_data.ts'

export const BUTTERFLY_BUDGET = Object.freeze({ low: 4, medium: 8, high: 16 })
/** One opaque instanced wing mesh. Flight and articulation stay on the GPU, bounded around each authored center. */
export const scenery_butterflies = (volumes: readonly SceneryVolume[]) => {
  if (volumes.length === 0) return null
  const random = mulberry(78532)
  const rows = Array.from({ length: volumes.length * BUTTERFLY_BUDGET.high }, (_, index) => {
    const volume = volumes[index % volumes.length]!
    return {
      center: volume.center.map((v, axis) => v + (random() - 0.5) * volume.size[axis]!),
      size: 0.45 + random() * 0.35,
      phase: random() * Math.PI * 2,
    }
  })
  const geometry = particle_geometry(rows, 7),
    positions: number[] = [],
    indices: number[] = []
  for (const side of [-1, 1]) {
    const start = positions.length / 3
    for (const [x, y] of [
      [0, 0],
      [0.16, 0.12],
      [0.55, 0.5],
      [0.68, 0.15],
      [0.46, -0.06],
      [0.37, -0.34],
      [0.12, -0.26],
    ])
      positions.push(side * x!, y!, 0)
    for (let i = 1; i < 6; i++) indices.push(start, start + i, start + i + 1)
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  geometry.setIndex(indices)
  const center = attribute('scenery_center', 'vec3' as const),
    phase = attribute('scenery_phase', 'float' as const),
    size = attribute('scenery_size', 'float' as const)
  const clock = time.mul(0.65).add(phase),
    yaw = clock.add(sin(clock.mul(0.7)))
  const flap = sin(time.mul(16).add(phase)).mul(0.95)
  const wing_x = positionLocal.x.mul(cos(flap)),
    wing_z = positionLocal.x.abs().mul(sin(flap))
  const wing = vec3(
    wing_x.mul(cos(yaw)).sub(wing_z.mul(sin(yaw))),
    positionLocal.y,
    wing_x.mul(sin(yaw)).add(wing_z.mul(cos(yaw)))
  ).mul(size)
  const flight = vec3(sin(clock).mul(4), sin(clock.mul(1.7)).mul(0.7), sin(clock.mul(0.73)).mul(3))
  const material = new MeshBasicNodeMaterial({ side: DoubleSide })
  material.positionNode = center.add(flight).add(wing)
  const color = mix(vec3(0.18, 0.55, 0.72), vec3(0.82, 0.48, 0.18), sin(phase).mul(0.5).add(0.5))
  material.colorNode = mix(vec3(0.08, 0.12, 0.14), color, positionLocal.x.abs().mul(5).clamp(0, 1))
  return new Mesh(geometry, material)
}
