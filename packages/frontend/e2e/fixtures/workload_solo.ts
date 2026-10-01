// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { world_terrain } from '@aresrpg/engine'

import { load_crowd } from '../../src/demo/CharacterCrowdLab.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'
import { create_frame_waiter, wait_for_frame_condition } from '../support/frame_waiter.ts'
import { upload_delta } from '../support/gpu_timing_probe.ts'

import { workload_equipped } from './workload_population.tsx'

export const measure_scene = async (
  world: ReturnType<typeof create_world>,
  stage: string,
  seconds: number,
  moving: boolean,
  update?: () => void
) => {
  const frames: Array<Record<string, unknown> & { dt: number }> = []
  await window.solo_profile(stage, true)
  let previous = performance.now()
  let uploads = window.workload_uploads?.(true)
  const started = previous
  world.set_movement({ forward: Number(moving), strafe: 0 })
  window.workload_on_frame = (now): void => {
    const next_uploads = window.workload_uploads?.()
    const { render, chunks } = world.state()
    frames.push({
      dt: now - previous,
      at: now - started,
      pose: read_pose(),
      render,
      chunks,
      uploads: upload_delta(uploads, next_uploads),
    })
    previous = now
    uploads = next_uploads
  }
  await create_frame_waiter({})(seconds * 60, update)
  window.workload_on_frame = undefined
  const pose = read_pose()
  world.set_active(false)
  await window.workload_gpu_done?.()
  const duration_ms = performance.now() - started
  await window.solo_profile(stage, false)
  const ordered = frames.map(({ dt }) => dt).toSorted((a, b) => a - b)
  const summary = {
    stage,
    started,
    fps: (frames.length * 1000) / duration_ms,
    p50: ordered[Math.floor(ordered.length * 0.5)],
    p95: ordered[Math.floor(ordered.length * 0.95)],
    p99: ordered[Math.floor(ordered.length * 0.99)],
    max: ordered.at(-1),
    pose,
  }
  console.info('[workload]', JSON.stringify(summary))
  world.set_active(true)
  return { ...summary, frames }
}

// This fails if the avatar stays blocked: assert the measured route actually crosses city columns.
export const run_solo_walk = async () => {
  const world = create_world({
    canvas: document.querySelector('canvas')!,
    world: world_terrain('nauvis'),
    quality: 'high',
    initial_focus: [420, 0],
    initial_yaw: Math.PI / 2,
  })
  world.point_at({ x: 420, z: 0 })
  world.set_audio_volume(0)
  world.set_time_of_day(0.31)
  world.set_active(true)
  world.set_interactive(true)
  const settled = (): boolean => {
    const { render, chunks } = world.state()
    return (
      render.settled &&
      [chunks.planning, chunks.queued, chunks.in_flight, chunks.evicting].every((count) => count === 0)
    )
  }
  try {
    await wait_for_frame_condition(settled)
    const [actor] = await workload_equipped(await load_crowd(1, world.ground_height))
    world.set_character(actor!)
    await wait_for_frame_condition(() => world.entity_height(actor!.id) !== null)
    await create_frame_waiter({})(120)
    await wait_for_frame_condition(settled)
    const standing = await measure_scene(world, 'standing', 5, false)
    const cold = await measure_scene(world, 'cold-walk', 25, true)
    world.point_at({ x: 420, z: 0 })
    await create_frame_waiter({})(180)
    const warm = await measure_scene(world, 'warm-walk', 25, true)
    const captures: Record<string, string> = {}
    for (const quality of ['low', 'medium', 'high'] as const) {
      world.set_quality(quality, 1)
      await create_frame_waiter({})(30)
      await wait_for_frame_condition(settled)
      await window.workload_gpu_done?.()
      captures[quality] = document.querySelector('canvas')!.toDataURL('image/png')
    }
    return { standing, cold, warm, captures, backend: world.backend() }
  } finally {
    window.workload_on_frame = undefined
    world.dispose()
  }
}

declare global {
  interface Window {
    run_solo_walk: typeof run_solo_walk
    solo_profile: (stage: string, running: boolean) => Promise<void>
  }
}
