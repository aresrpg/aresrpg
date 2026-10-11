// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Mesh, PlaneGeometry, type Scene } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { atan, float, fract, positionGeometry, sin, smoothstep, time, uniform, uv, vec4 } from 'three/tsl'

/** A transparent clip-space quad shares the scene draw on every quality tier; no extra scene sample. */
export const create_speed_wind = (scene: Scene) => {
  const strength = uniform(0)
  const point = uv().sub(0.5).mul(2)
  const radius = point.length()
  const angle = atan(point.y, point.x)
    .add(Math.PI)
    .div(Math.PI * 2)
    .mul(48)
  const sector = angle.floor()
  const seed = fract(sin(sector.mul(127.1)).mul(43758.5453))
  const ray = float(1).sub(smoothstep(0.015, 0.045, fract(angle).sub(0.5).abs()))
  const travel = fract(radius.mul(0.7).sub(time.mul(1.6)).add(seed))
  const dash = smoothstep(0.6, 0.72, travel).mul(float(1).sub(smoothstep(0.8, 0.98, travel)))
  const opacity = ray
    .mul(dash)
    .mul(smoothstep(0.6, 1.05, radius))
    .mul(strength)
    .mul(0.16)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false })
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.fragmentNode = vec4(0.8, 0.9, 1, opacity)
  const geometry = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 100
  mesh.visible = false
  scene.add(mesh)
  return Object.freeze({
    set_strength: (value = 0): void => {
      strength.value = Math.max(0, Math.min(1, value))
      mesh.visible = strength.value > 0.001
    },
    dispose: (): void => {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  })
}
