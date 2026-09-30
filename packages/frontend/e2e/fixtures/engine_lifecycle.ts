// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LIFECYCLE_WORLD, probe_backend_lifetime } from '../../../engine/test/browser_lifecycle.ts'
import { probe_crowd } from '../../../engine/test/browser_crowd.ts'
import { probe_label_scene } from '../../../engine/test/browser_labels.ts'
import { probe_model_anchors } from '../../../engine/test/browser_model_anchors.ts'
import { probe_sword_labels } from '../../../engine/test/browser_sword_labels.ts'
import { load_fight_sword_url } from '../../src/content/fight_models.ts'
import { audio_src } from '../../src/game/audio/audio_registry.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'
import { mob_model_render } from '../../src/content/mob_models.ts'
import { create_world } from '../../src/game/core/world.ts'
import { read_pose, subscribe_pose } from '../../src/game/core/pose_feed.ts'

declare global {
  interface Window {
    probe_crowd: (morph: boolean) => ReturnType<typeof probe_crowd>
    probe_sword_labels: () => ReturnType<typeof probe_sword_labels>
    probe_model_anchors: () => ReturnType<typeof probe_model_anchors>
    probe_label_scene: () => ReturnType<typeof probe_label_scene>
    probe_engine_lifetime: () => ReturnType<typeof probe_backend_lifetime>
    start_world_input: () => Promise<void>
    run_terrain_route: (
      width?: number
    ) => Promise<Readonly<{ reason: string; detoured: boolean; crossed_wall: boolean; x: number; z: number }>>
    read_world_pose: typeof read_pose
    read_world_motion: () => Readonly<{ samples: number; stable_samples: number }>
    stop_world_input: () => void
  }
}
window.probe_sword_labels = async () => {
  const impact_sound = audio_src('sword_plant')
  if (!impact_sound) throw new Error('Sword impact fixture is missing its authored audio')
  return probe_sword_labels(
    document.getElementById('canvas') as HTMLCanvasElement,
    (await load_fight_sword_url())!,
    impact_sound
  )
}
window.probe_model_anchors = async () =>
  probe_model_anchors(
    document.getElementById('canvas') as HTMLCanvasElement,
    await load_character_appearance({
      id: 'hero',
      classe: 'senshi',
      male: true,
      colors: ['#ffffff', '#ff0000', '#0000ff'],
      loadout: {},
    }),
    Object.fromEntries(['tinker', 'fuwa', 'aragne'].map((type) => [type, mob_model_render(type)!]))
  )
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

window.probe_crowd = (morph) => probe_crowd(document.querySelector('canvas')!, morph)

window.run_terrain_route = async (width = 7) => {
  let reason = ''
  const positions: NonNullable<ReturnType<typeof read_pose>>[] = []
  const source = {
    name: 'route-wall',
    size: [1, 4, width] as const,
    anchor: [0, 0, 0] as const,
    blocks: Array.from(
      { length: 4 * width },
      (_, index) => [0, Math.floor(index / width), index % width, 'stone'] as const
    ),
  }
  const world = create_world({
    canvas: document.querySelector('canvas')!,
    world: {
      ...LIFECYCLE_WORLD,
      fixed_structures: [{ source, origin: [132, 1, 128 - Math.floor(width / 2)], rotation: 0, scale: 1 }],
    },
    quality: 'low',
    on_run_stopped: (outcome) => {
      reason = outcome
    },
  })
  try {
    world.set_audio_volume(0)
    world.set_footsteps_enabled(false)
    world.point_at({ x: 128.5, z: 128.5 })
    world.set_active(true)
    world.set_run_target({ x: 136.5, z: 128.5 })
    const deadline = performance.now() + 20_000
    while (!reason && performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const pose = read_pose()
      if (pose) positions.push(pose)
      if (world.state().engine.state === 'failed') throw new Error(JSON.stringify(world.state().engine))
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
    const pose = read_pose()
    return {
      reason,
      detoured: positions.some(({ z }) => Math.abs(z - 128) > 3),
      // Fast movement can cross the entire voxel between rendered frames. Observe the swept segment.
      crossed_wall: positions.some((pose, index) => {
        const previous = positions[index - 1]
        return (
          previous !== undefined &&
          previous.x <= 132.5 &&
          pose.x >= 132.5 &&
          [previous, pose].every(({ y, z }) => y < 4.9 && Math.abs(z - 128) < width / 2)
        )
      }),
      x: pose?.x ?? NaN,
      z: pose?.z ?? NaN,
    }
  } finally {
    world.dispose()
  }
}
