// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Node } from 'three/webgpu'
import { float, max, positionWorld, vec3 } from 'three/tsl'

import type { SceneryGlow } from './scenery_data.ts'

/** Bounded analytic highlights from authored luminous scenery, in the existing water draw.
 * These reflect light sources, not scene geometry; no camera, texture or reflection pass. */
export const water_glow_reflections = (
  glows: readonly SceneryGlow[],
  normal: Node<'vec3'>,
  view: Node<'vec3'>,
  ripple: Node<'float'>
): Node<'vec3'> =>
  glows.slice(0, 8).reduce<Node<'vec3'>>((sum, glow) => {
    const to_light = vec3(...glow.center).sub(positionWorld)
    const distance_squared = to_light.dot(to_light).max(1)
    const half_vector = to_light.normalize().add(view).normalize()
    const specular = max(normal.dot(half_vector), 0).pow(96)
    const attenuation = float(glow.size * glow.size * 12).div(distance_squared.add(16))
    const crests = ripple.mul(0.22).add(0.55).clamp(0.12, 1)
    return sum.add(
      vec3(...glow.color)
        .mul(specular)
        .mul(attenuation)
        .mul(crests)
    )
  }, vec3(0))
