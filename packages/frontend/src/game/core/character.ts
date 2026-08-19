// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character-controller facade — LOSSLESS PORT of the legacy contract
// (deprecated/engine/src/player/character_controller.js): the game loop sends INPUT and reads the
// TRANSFORM; physics runs fixed-step internally with render interpolation (the D215 anti-jitter),
// spawns and teleports auto-eject from solid. Pointing the system at another character is just
// `teleport` with that character's position — camera and terrain follow the transform.

import { eject_from_solid, type SolidFn, type Vec3Mut } from './collision.ts'
import {
  create_controller_state,
  step_controller,
  type ControllerEnv,
  type ControllerInput,
  type PlayerAnim,
} from './controller.ts'

/** Physics fixed step (s); tick(dt) accumulates toward this — any caller cadence is stable. */
const FIXED_STEP = 1 / 60
/** Max accumulated steps per tick — a background tab returning after seconds must not explode. */
const MAX_STEPS_PER_TICK = 8

export type CharacterInput = Readonly<Partial<ControllerInput>>
export type CharacterTransform = Readonly<{
  position: Readonly<Vec3Mut>
  visual_y: number
  facing_yaw: number
  on_ground: boolean
  in_water: boolean
  air_jumped: boolean
  speed: number
  anim: PlayerAnim
  gait_scale: number
  velocity: Readonly<Vec3Mut>
}>

export type CharacterController = Readonly<{
  set_input: (input: CharacterInput) => void
  tick: (dt: number) => void
  get_transform: () => CharacterTransform
  teleport: (position: Readonly<Vec3Mut>, opts?: Readonly<{ eject?: boolean }>) => void
  reconcile_ground: (previous_ground: number, next_ground: number) => void
  dispose: () => void
}>

export type ProjectedGroundResult = Readonly<{
  position_y: number
  velocity_y: number
  on_ground: boolean
  displacement: number
}>

/** Reconcile a capsule with a display-only ground projection. A seated body rides the
 * surface in either direction; an airborne body is only pushed up when relief intersects it. */
export const reconcile_projected_ground = ({
  position_y,
  velocity_y,
  on_ground,
  previous_ground,
  next_ground,
}: Readonly<{
  position_y: number
  velocity_y: number
  on_ground: boolean
  previous_ground: number
  next_ground: number
}>): ProjectedGroundResult => {
  const seated = on_ground || Math.abs(position_y - previous_ground) < 0.001
  const next_y = seated ? position_y + next_ground - previous_ground : Math.max(position_y, next_ground)
  const supported = seated || position_y < next_ground
  return Object.freeze({
    position_y: next_y,
    velocity_y: supported ? Math.max(0, velocity_y) : velocity_y,
    on_ground: supported,
    displacement: next_y - position_y,
  })
}

export const create_character_controller = ({
  solid_at,
  liquid_at,
  position,
  yaw = 0,
}: Readonly<{
  solid_at: SolidFn
  liquid_at: ControllerEnv['liquid_at']
  position: Readonly<Vec3Mut>
  yaw?: number
}>): CharacterController => {
  const env: ControllerEnv = Object.freeze({ solid_at, liquid_at })
  // A buried spawn is ejected to the nearest air BEFORE the body exists — the camera never opens
  // inside solid.
  const spawn = eject_from_solid(env.solid_at, [position[0], position[1], position[2]])
  const state = create_controller_state(spawn, yaw)
  // [D215] fixed-step physics renders at frame rate: keep the previous step's pose and let
  // get_transform interpolate by the accumulator fraction — avatar and camera read one smooth source.
  const prev = { position: [...state.position] as Vec3Mut, visual_y: state.visual_y, facing_yaw: state.facing_yaw }
  const input: ControllerInput = { forward: 0, strafe: 0, jump: false, glide: false, walk: false, speed_scale: 1, yaw }
  let acc = 0
  let air_jump_event = false
  let disposed = false

  return Object.freeze({
    set_input: (next: CharacterInput) => {
      if (disposed) return
      if (next.forward !== undefined) input.forward = next.forward
      if (next.strafe !== undefined) input.strafe = next.strafe
      if (next.jump !== undefined) input.jump = next.jump
      if (next.glide !== undefined) input.glide = next.glide
      if (next.walk !== undefined) input.walk = next.walk
      if (next.speed_scale !== undefined) input.speed_scale = next.speed_scale
      if (next.yaw !== undefined) input.yaw = next.yaw
    },

    tick: (dt: number) => {
      if (disposed) return
      acc = Math.min(acc + Math.max(0, dt), FIXED_STEP * MAX_STEPS_PER_TICK)
      let air_jumped = false
      while (acc >= FIXED_STEP) {
        ;[prev.position[0], prev.position[1], prev.position[2]] = state.position
        prev.visual_y = state.visual_y
        prev.facing_yaw = state.facing_yaw
        step_controller(state, input, env, FIXED_STEP)
        if (state._air_jump_fired) air_jumped = true
        acc -= FIXED_STEP
      }
      air_jump_event = air_jumped
    },

    get_transform: () => {
      const a = Math.min(1, acc / FIXED_STEP)
      const lerp = (p: number, c: number): number => p + (c - p) * a
      const underwater_moving = state.in_water && state.speed > 0.5
      // wrap-aware yaw lerp (shortest arc) so a heading flip never spins the long way for a frame.
      let dyaw = state.facing_yaw - prev.facing_yaw
      if (dyaw > Math.PI) dyaw -= Math.PI * 2
      if (dyaw < -Math.PI) dyaw += Math.PI * 2
      return Object.freeze({
        position: [
          lerp(prev.position[0], state.position[0]),
          lerp(prev.position[1], state.position[1]),
          lerp(prev.position[2], state.position[2]),
        ] as Vec3Mut,
        visual_y: lerp(prev.visual_y, state.visual_y),
        facing_yaw: prev.facing_yaw + dyaw * a,
        on_ground: state.on_ground,
        in_water: state.in_water,
        air_jumped: air_jump_event,
        speed: state.speed,
        anim: state.in_water ? (underwater_moving ? 'SWIM' : 'IDLE') : state.anim,
        gait_scale: state.gait_scale,
        velocity: [...state.velocity] as Vec3Mut,
      })
    },

    teleport: (p, opts = {}) => {
      if (disposed) return
      // Every adopted position is ejected to the nearest air; `{ eject: false }` is creative-fly's
      // deliberate move-through-solids.
      const target = opts.eject === false ? p : eject_from_solid(env.solid_at, [p[0], p[1], p[2]])
      state.position = [target[0], target[1], target[2]]
      ;[, state.visual_y] = target
      ;[prev.position[0], prev.position[1], prev.position[2]] = state.position
      prev.visual_y = state.visual_y
      state.velocity = [0, 0, 0]
    },

    reconcile_ground: (previous_ground, next_ground) => {
      if (disposed || previous_ground === next_ground) return
      const result = reconcile_projected_ground({
        position_y: state.position[1],
        velocity_y: state.velocity[1],
        on_ground: state.on_ground,
        previous_ground,
        next_ground,
      })
      state.position = [state.position[0], result.position_y, state.position[2]]
      state.visual_y += result.displacement
      state.velocity = [state.velocity[0], result.velocity_y, state.velocity[2]]
      state.on_ground = result.on_ground
      if (result.on_ground) state._since_ground = 0
      prev.position[1] += result.displacement
      prev.visual_y += result.displacement
    },

    dispose: () => {
      disposed = true
    },
  })
}
