// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Vector2, type Scene } from 'three'
import { reflector, screenUV, vec2 } from 'three/tsl'
import type { Node } from 'three/webgpu'

import type { EngineQuality } from './types.ts'

export const reflection_scale = (quality: EngineQuality, width: number, height: number): number =>
  Math.min({ low: 0.125, medium: 0.25, high: 0.4 }[quality], 1024 / Math.max(1, width, height))

/** One opt-in water mirror. Three owns oblique clipping and render-state restoration;
 * this lifecycle owns bounded resolution, refresh cadence, quality and disposal. */
export const create_water_reflection = (scene: Scene, sea_level: number, initial_quality: EngineQuality) => {
  const reflection = reflector({ resolutionScale: 0.4, bounces: false, samples: 0 })
  reflection.target.rotation.x = -Math.PI / 2
  reflection.target.position.y = sea_level
  scene.add(reflection.target)
  const base = reflection.reflector
  const update = base.updateBefore.bind(base)
  const size = new Vector2()
  let quality = initial_quality
  let next_update = 0
  base.updateBefore = (frame) => {
    const now = performance.now()
    if (now < next_update) return false
    next_update = now + 1000 / (quality === 'low' ? 6 : 12)
    const renderer = frame.renderer!
    renderer.getDrawingBufferSize(size)
    base.resolutionScale = reflection_scale(quality, size.x, size.y)
    reflection.target.updateMatrixWorld()
    return update(frame)
  }
  return {
    sample: (normal: Node<'vec3'>) => reflection.sample(screenUV.flipX().add(vec2(normal.x, normal.z).mul(0.014))).rgb,
    set_quality: (next: EngineQuality) => {
      quality = next
      next_update = 0
    },
    dispose: () => {
      scene.remove(reflection.target)
      reflection.dispose()
    },
  }
}
