// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AdditiveBlending, DoubleSide, NormalBlending } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraWorldMatrix,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

export const create_character_aura_material = (kind: 'shell' | 'mote' | 'haze') => {
  const center = attribute<'vec3'>('aura_center', 'vec3')
  const size = attribute<'float'>('aura_size', 'float')
  const phase = attribute<'float'>('aura_phase', 'float')
  const age = attribute<'float'>('aura_age', 'float')
  const profile = attribute<'float'>('aura_profile', 'float')
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: kind === 'haze' ? NormalBlending : AdditiveBlending,
  })
  material.forceSinglePass = true
  material.fog = true
  if (kind === 'mote') {
    material.positionNode = center.add(cameraWorldMatrix.mul(vec4(positionLocal.xy.mul(size), 0, 0)).xyz)
    const radius = uv().sub(0.5).length().mul(2)
    const core = radius.mul(-5).exp()
    const green = mix(vec3(0.12, 1.3, 0.55), vec3(0.65, 2, 1.25), core)
    const crimson = mix(vec3(1.8, 0.035, 0.12), vec3(0.75, 0.025, 1.2), sin(phase.mul(19)).mul(0.5).add(0.5))
    material.colorNode = mix(green, crimson, profile)
    material.opacityNode = core.mul(age.oneMinus().pow(2)).mul(0.8)
  } else {
    // World-up billboards keep the energy upright even with an overhead fight camera.
    const horizontal = cameraWorldMatrix.mul(
      vec4(positionLocal.x.mul(size).mul(1.2).mul(profile.mul(0.15).add(1)), 0, 0, 0)
    ).xyz
    material.positionNode = center.add(horizontal).add(vec3(0, positionLocal.y.mul(size).mul(1.55), 0))
    const x = uv().x.sub(0.5).abs().mul(2)
    const { y } = uv()
    const noise = mx_fractal_noise_float(vec3(uv().x.mul(5), y.mul(4).sub(time.mul(1.1)), phase.mul(11)), 2, 2, 0.5)
    const width = sin(y.mul(Math.PI)).max(0).pow(0.65).mul(0.67).add(noise.mul(0.12))
    const rim = smoothstep(width.sub(0.12), width, x).mul(smoothstep(width, width.add(0.12), x).oneMinus())
    const veil = smoothstep(width, width.add(0.1), x).oneMinus().mul(0.015)
    const vertical = smoothstep(0.03, 0.18, y).mul(smoothstep(0.72, 0.98, y).oneMinus())
    const pulse = sin(time.mul(2.2).add(phase.mul(17)))
      .mul(0.01)
      .add(0.075)
    const rise = sin(y.mul(24).sub(time.mul(5)).add(noise.mul(9)).add(phase.mul(17)))
      .mul(0.5)
      .add(0.5)
    const wisps = smoothstep(0.2, 0.8, rise).mul(0.7).add(0.3)
    if (kind === 'haze') {
      const smoke = smoothstep(-0.25, 0.5, noise)
      const mask = smoothstep(width.sub(0.1), width.add(0.2), x).oneMinus()
      material.colorNode = mix(vec3(0.005, 0.002, 0.012), vec3(0.1, 0.006, 0.17), smoke)
      material.opacityNode = mask.mul(vertical).mul(smoke).mul(0.24)
    } else {
      const green = mix(vec3(0.06, 0.9, 0.38), vec3(0.4, 1.6, 0.9), y)
      const shift = smoothstep(-0.1, 0.6, noise.add(sin(time.mul(0.65).add(phase.mul(13))).mul(0.25)))
      const crimson = mix(vec3(1.6, 0.015, 0.055), vec3(0.55, 0.018, 1.1), shift)
      material.colorNode = mix(green, crimson, profile)
      material.opacityNode = rim.mul(pulse).mul(wisps).add(veil).mul(vertical).mul(profile.mul(1.25).add(1))
    }
  }
  material.alphaTest = 0.002
  return material
}
