// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { float, mix, positionWorld, sin, smoothstep, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/** Thin coastal ice follows the rendered bed depth; the navigable channel stays liquid. */
export const frozen_shore = (depth: Node<'float'>, reflection: Node<'vec3'>, illumination: Node<'vec3'>) => {
  const cracks = sin(positionWorld.x.mul(0.71).add(sin(positionWorld.z.mul(0.13))))
    .mul(sin(positionWorld.z.mul(0.63).add(sin(positionWorld.x.mul(0.19)))))
    .abs()
  const veins = float(1).sub(smoothstep(0.015, 0.055, cracks))
  return {
    amount: smoothstep(0.04, 0.2, depth).mul(float(1).sub(smoothstep(0.7, 2.8, depth))),
    color: mix(vec3(0.12, 0.36, 0.5).mul(illumination), reflection, 0.48).add(
      vec3(0.3, 0.45, 0.5).mul(veins).mul(illumination)
    ),
  }
}
