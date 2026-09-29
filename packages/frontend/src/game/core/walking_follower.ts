// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_controller_state, step_controller } from './controller.ts'
import { begin_walking, step_walking } from './walking.ts'
import type { WalkPoint, WalkWorld } from './walkable.ts'
import type { RunTarget } from './run_to.ts'

type FollowerMotion = Readonly<{
  body: ReturnType<typeof create_controller_state>
  walking: ReturnType<typeof begin_walking>
}>

/** Followers share run-to's bounded local detours and direct passage through hard obstacles. */
export const step_walking_follower = (
  world: WalkWorld,
  previous: FollowerMotion | null,
  position: WalkPoint,
  target: RunTarget,
  elapsed_ms: number
): Readonly<{ motion: FollowerMotion; position: WalkPoint; distance: number }> => {
  const body = previous
    ? {
        ...previous.body,
        position: [...previous.body.position] as [number, number, number],
        velocity: [...previous.body.velocity] as [number, number, number],
      }
    : create_controller_state([...position])
  let walking = previous?.walking ?? begin_walking(position, target)
  let distance = Infinity
  const steps = Math.min(8, Math.max(0, Math.ceil(elapsed_ms / (1000 / 60))))
  const dt = Math.min(1 / 60, Math.max(0, elapsed_ms) / 1000 / Math.max(1, steps))
  for (let index = 0; index < steps; index += 1) {
    const step = step_walking(world, walking, body.position, target, dt)
    walking = step.state
    if (step.status === 'planning') break
    step_controller(
      body,
      {
        yaw: step.yaw,
        forward: step.forward,
        phase_target: step.phase_target,
        strafe: 0,
        jump: false,
        glide: false,
        walk: false,
        speed_scale: 1,
      },
      world,
      dt
    )
    distance = Math.hypot(target.x - body.position[0], target.z - body.position[2])
  }
  return { motion: { body, walking }, position: body.position, distance }
}
