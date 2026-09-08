// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LIFECYCLE_WORLD, probe_backend_lifetime } from '../../../engine/test/browser_lifecycle.ts'
import { create_world } from '../../src/game/core/world.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'

declare global {
  interface Window {
    probe_engine_lifetime: () => ReturnType<typeof probe_backend_lifetime>
    start_world_input: () => Promise<void>
    read_world_pose: typeof read_pose
    stop_world_input: () => void
  }
}
window.probe_engine_lifetime = () => probe_backend_lifetime(document.getElementById('canvas') as HTMLCanvasElement)

window.start_world_input = async () => {
  const world = create_world({
    canvas: document.getElementById('canvas') as HTMLCanvasElement,
    world: LIFECYCLE_WORLD,
    quality: 'low',
  })
  window.stop_world_input = world.dispose
  world.set_footsteps_enabled(false)
  world.point_at({ x: 0, z: 0 })
  world.set_interactive(true)
  world.set_active(true)
  await new Promise<void>((resolve) => {
    world.subscribe_status((status) => {
      if (status.state !== 'initializing') resolve()
    })
  })
}
window.read_world_pose = read_pose
