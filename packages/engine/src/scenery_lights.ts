// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Color, PointLight, type Scene } from 'three'

import type { EngineQuality } from './types.ts'
import { SCENERY_LIGHT_BUDGET, type SceneryGlow } from './scenery_data.ts'

/** Four shadowless lamps at most; quality limits the existing lighting pass, never shadow maps. */
export const create_scenery_lights = (scene: Scene, glows: readonly SceneryGlow[]) => {
  const lights = glows
    .filter((row) => row.range !== undefined)
    .slice(0, SCENERY_LIGHT_BUDGET.high)
    .map((row) => {
      const light = new PointLight(new Color(...row.color), 18, row.range, 1.2)
      light.position.set(...row.center)
      light.visible = false
      scene.add(light)
      return light
    })
  let visible = false
  let limit: number = SCENERY_LIGHT_BUDGET.high
  const sync = () =>
    lights.forEach((light, index) => {
      light.visible = visible && index < limit
    })
  return {
    set_visible: (next: boolean) => {
      visible = next
      sync()
    },
    set_quality: (quality: EngineQuality) => {
      limit = SCENERY_LIGHT_BUDGET[quality]
      sync()
    },
    dispose: () =>
      lights.forEach((light) => {
        scene.remove(light)
        light.dispose()
      }),
  }
}
