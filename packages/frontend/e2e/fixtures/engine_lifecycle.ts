// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LIFECYCLE_WORLD, probe_backend_lifetime } from '../../../engine/test/browser_lifecycle.ts'
import { probe_label_scene } from '../../../engine/test/browser_labels.ts'
import { create_world } from '../../src/game/core/world.ts'
import { read_pose, subscribe_pose } from '../../src/game/core/pose_feed.ts'

declare global {
  interface Window {
    probe_label_scene: () => ReturnType<typeof probe_label_scene>
    probe_engine_lifetime: () => ReturnType<typeof probe_backend_lifetime>
    start_world_input: () => Promise<void>
    read_world_pose: typeof read_pose
    read_world_motion: () => Readonly<{ samples: number; stable_samples: number }>
    stop_world_input: () => void
  }
}
window.probe_engine_lifetime = () => probe_backend_lifetime(document.getElementById('canvas') as HTMLCanvasElement)
window.probe_label_scene = () => probe_label_scene(document.getElementById('canvas') as HTMLCanvasElement)

window.start_world_input = async () => {
  const world = create_world({
    canvas: document.getElementById('canvas') as HTMLCanvasElement,
    world: LIFECYCLE_WORLD,
    quality: 'low',
  })
  let previous = read_pose()
  let samples = 0
  let stable_samples = 0
  const unsubscribe = subscribe_pose(() => {
    const pose = read_pose()
    if (!pose) return
    samples += 1
    stable_samples = previous && pose.x === previous.x && pose.z === previous.z ? stable_samples + 1 : 0
    previous = pose
  })
  window.read_world_motion = () => ({ samples, stable_samples })
  window.stop_world_input = () => {
    unsubscribe()
    world.dispose()
  }
  world.set_footsteps_enabled(false)
  world.point_at({ x: 0, z: 0 })
  world.set_interactive(true)
  world.set_active(true)
  await new Promise<void>((resolve, reject) => {
    world.subscribe_status((status) => {
      if (status.state === 'failed') reject(new Error(JSON.stringify(status)))
      else if (status.state !== 'initializing') resolve()
    })
  })
}
window.read_world_pose = read_pose
