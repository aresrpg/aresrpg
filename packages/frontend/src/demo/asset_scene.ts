// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { EngineQuality, Vec3 } from '@aresrpg/engine'

import { create_world } from '../game/core/world.ts'

export type AssetSceneData = Readonly<{
  world: unknown
  camera: Readonly<{ target: Vec3; zoom: number; yaw: number; pitch: number }>
  time_of_day: number
}>

/** Only asset framing differs; camera controls, rendering and disposal belong to the normal world. */
export const mount_asset_scene = (
  canvas: Readonly<HTMLCanvasElement>,
  data: AssetSceneData,
  quality: EngineQuality
) => {
  const { target, zoom, yaw, pitch } = data.camera
  const world = create_world({
    canvas,
    world: data.world,
    quality,
    render_distance: 3,
    initial_focus: [target[0], target[2]],
    initial_spectate: { y: target[1], zoom, yaw, pitch, min_zoom: 4, max_zoom: zoom * 2 },
  })
  world.set_time_of_day(data.time_of_day)
  world.set_audio_volume(0)
  world.set_interactive(true)
  world.set_active(true)
  return world
}
