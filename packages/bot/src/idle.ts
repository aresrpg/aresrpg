// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_controller_state,
  step_controller,
  is_gliding,
  MOUNT_SPEED_SCALE,
  type ControllerInput,
} from '@aresrpg/engine/locomotion/controller'
import { ground_height_below } from '@aresrpg/engine/locomotion/collision'
import { walking_edge, type WalkPoint, type WalkWorld } from '@aresrpg/engine/locomotion/walkable'
import { begin_walking } from '@aresrpg/engine/locomotion/walking'

import pet_wings from '../../../seed/content/pet_wings.json'

import { run_ref_of } from './run_ref.ts'
import { gameplay_observed_ms, travel_destination, type GameplayContext } from './gameplay_context.ts'
import type { Lane } from './control.ts'
import { profession_item } from './profession_catalog.ts'

const IDLE_RADIUS = 50
// Ordinary jump-button gestures: tap, or tap/release/hold for the mounted mid-air jump and glide.
const JUMP_PRESSES = [
  [[0, 100]],
  [
    [0, 100],
    [200, 2500],
  ],
] as const
export const idle_travels = (context: GameplayContext, lane: Lane) => {
  if (
    [
      lane.paused,
      lane.needs_resync,
      lane.active_command,
      lane.pending,
      lane.reconciliation_command,
      run_ref_of(lane),
    ].some(Boolean)
  )
    return null
  const chain_ms = gameplay_observed_ms(context)
  return context.snapshot.characters
    .filter((character) =>
      [
        character.custody === 'kiosk',
        !character.active_fight,
        !character.ambush,
        !character.dungeon_run,
        character.world === character.checkpoint_world,
        character.x != null,
        character.z != null,
        character.at_ms != null && BigInt(character.at_ms) <= chain_ms,
      ].every(Boolean)
    )
    .map((character) => ({
      ...travel_destination(character, character.x!, character.z!),
      riding: character.equipment.some(
        (item) =>
          item.slot === 'pet' &&
          profession_item(item.item_type)?.category === 'pet' &&
          Object.hasOwn(pet_wings, item.item_type)
      ),
    }))
}

export type IdleState = Readonly<{
  anchor: WalkPoint
  yaw: number
  move_until: number
  change_at: number
  jump_at: number
  jump_started: number
  double_jump: boolean
}>
export const begin_idle = (position: WalkPoint, now: number, random: () => number): IdleState => ({
  anchor: position,
  yaw: 0,
  move_until: now,
  change_at: now + 3000 + random() * 6000,
  jump_at: now + 15000 + random() * 20000,
  jump_started: -Infinity,
  double_jump: false,
})

const idle_intent = (
  position: WalkPoint,
  state: IdleState,
  now: number,
  random: () => number,
  riding: boolean,
  on_ground: boolean
) => {
  let next = state
  if (now >= state.change_at) {
    const yaw =
      Math.hypot(position[0] - state.anchor[0], position[2] - state.anchor[2]) > IDLE_RADIUS / 2
        ? Math.atan2(position[0] - state.anchor[0], position[2] - state.anchor[2])
        : random() * Math.PI * 2
    const move_until = now + 2000 + random() * 3000
    next = { ...state, yaw, move_until, change_at: move_until + 3000 + random() * 6000 }
  }
  const forward = Number(now < next.move_until)
  if ([riding === Boolean(forward), now >= next.jump_at, on_ground].every(Boolean))
    next = {
      ...next,
      jump_at: now + 15000 + random() * 20000,
      jump_started: now,
      double_jump: riding && random() < 0.5,
    }
  const age = now - next.jump_started
  const presses = JUMP_PRESSES[Number(riding && next.double_jump)]!
  const jump = presses.some(([from, until]) => age >= from && age < until)
  const input: ControllerInput = {
    yaw: next.yaw,
    forward,
    strafe: 0,
    jump,
    glide: riding && jump,
    walk: true,
    speed_scale: riding ? MOUNT_SPEED_SCALE : 1,
  }
  return { state: next, input }
}

/** Idle only takes collision-checked walking edges; it never uses travel's direct passage fallback. */
export const step_idle = (
  world: WalkWorld,
  previous: ReturnType<typeof create_controller_state> | undefined,
  position: WalkPoint,
  state: IdleState,
  now: number,
  elapsed_ms: number,
  random: () => number,
  riding: boolean
) => {
  const body = previous
    ? {
        ...previous,
        position: [...previous.position] as [number, number, number],
        velocity: [...previous.velocity] as [number, number, number],
      }
    : create_controller_state([...position])
  const next = idle_intent(position, state, now, random, riding, body.on_ground)
  // Spawn clearance searches upward; an airborne anchor is not a supporting floor.
  const floor = ground_height_below(world.solid_at, position[0], position[1], position[2])
  const footing: WalkPoint = [
    position[0],
    world.ground_height(position[0], position[2], floor ?? undefined),
    position[2],
  ]
  const stopped = {
    state: { ...next.state, move_until: now, jump_started: -Infinity },
    motion: null,
    position,
    riding,
    gliding: false,
  }
  const dx = -Math.sin(next.input.yaw) * next.input.forward
  const dz = -Math.cos(next.input.yaw) * next.input.forward
  if (!walking_edge(world, footing, position[0] + dx, position[2] + dz)) return stopped
  const steps = Math.min(8, Math.max(1, Math.ceil(elapsed_ms / (1000 / 60))))
  const dt = Math.min(1 / 60, Math.max(0, elapsed_ms) / 1000 / steps)
  for (let index = 0; index < steps; index += 1) step_controller(body, next.input, world, dt)
  const target = { x: body.position[0], z: body.position[2] }
  if (
    Math.hypot(target.x - state.anchor[0], target.z - state.anchor[2]) > IDLE_RADIUS ||
    !walking_edge(world, footing, target.x, target.z)
  )
    return stopped
  return {
    state: next.state,
    motion: { body, walking: begin_walking(body.position, target) },
    position: body.position,
    riding,
    gliding: is_gliding(body, next.input),
  }
}
