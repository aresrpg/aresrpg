// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity, functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- the frame controller mutates its owned simulation state and vectors in one measured hot path. */
// The locomotion brain — LOSSLESS PORT of the proven legacy controller
// (deprecated/engine/src/player/controller.js): WASD relative to camera yaw, linear accel/brake
// ground curves with a minecraft-style multiplicative no-input stop, sprint, a real jump
// (asymmetric gravity + coyote-time + jump-buffer + release-to-cut + double-jump), air control
// preserving momentum, swim-float, auto-step visual smoothing. Pure state + math over
// `{ solid_at, liquid_at }` oracles — every feel constant carried verbatim, do not retune casually.

import { CHARACTER_HEIGHT, ground_height_below, resolve_movement, type SolidFn, type Vec3Mut } from './collision.ts'

// ═══ GAME-FEEL TUNABLES (ported verbatim — the A/B history lives in the legacy source) ═══
const WALK_SPEED = 4.8
export const RUN_SPEED = 10.5
const SWIM_SPEED = 10
const GROUND_ACCEL = 50
const GROUND_BRAKE = 160
const MC_STOP_FACTOR = 0.3
const STOP_SNAP_SPEED = 0.2
const AIR_ACCEL = 31.5
const JUMP_APEX_M = 1.44
const RISE_GRAVITY = 40
const FALL_GRAVITY_MULT = 1.6
const JUMP_FORCE = Math.sqrt(2 * RISE_GRAVITY * JUMP_APEX_M)
const JUMP_CUT_MULT = 0.5
const JUMP_FORWARD_IMPULSE = 3
const AIR_JUMP_MULT = 1.45
const GRAVITY_UNDERWATER = 5
const SWIM_LAMBDA = 12
const SWIM_UP_SPEED = 1.5 * GRAVITY_UNDERWATER
const TERMINAL_FALL = -60
const GLIDE_GRAVITY = 8
const GLIDE_TERMINAL_FALL = -5
const COYOTE_TIME = 0.12
const JUMP_BUFFER = 0.12
const FALL_ANIM_THRESHOLD = 3
const STEP_SMOOTH_MS = 100
const STEP_SMOOTH_LAMBDA = 3000 / STEP_SMOOTH_MS
const STEP_OFFSET_MAX = 1.5

export type PlayerAnim = 'IDLE' | 'WALK' | 'RUN' | 'JUMP' | 'JUMP_RUN' | 'FALL' | 'SWIM'
export type ControllerEnv = Readonly<{
  solid_at: SolidFn
  liquid_at: (x: number, y: number, z: number) => boolean
}>
export type ControllerInput = {
  forward: number
  strafe: number
  jump: boolean
  glide: boolean
  walk: boolean
  speed_scale: number
  yaw: number
}
export type ControllerState = {
  position: Vec3Mut
  velocity: Vec3Mut
  visual_y: number
  facing_yaw: number
  on_ground: boolean
  in_water: boolean
  anim: PlayerAnim
  speed: number
  gait_scale: number
  _since_ground: number
  _jump_buffer: number
  _jump_was_down: boolean
  _air_jumped: boolean
  _air_jump_fired: boolean
  _fall_peak_y: number
  _step_offset: number
}

export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt))

export const create_controller_state = (spawn: Readonly<Vec3Mut>, yaw = 0): ControllerState => ({
  position: [spawn[0], spawn[1], spawn[2]],
  velocity: [0, 0, 0],
  visual_y: spawn[1],
  facing_yaw: yaw,
  on_ground: false,
  in_water: false,
  anim: 'IDLE',
  speed: 0,
  gait_scale: 1,
  _since_ground: 999,
  _jump_buffer: 0,
  _jump_was_down: false,
  _air_jumped: false,
  _air_jump_fired: false,
  _fall_peak_y: spawn[1],
  _step_offset: 0,
})

/** Camera-relative input → world XZ unit direction (legacy fly-camera basis, verbatim). */
export const move_direction = (forward: number, strafe: number, yaw: number): readonly [number, number] => {
  const fwd_x = -Math.sin(yaw)
  const fwd_z = -Math.cos(yaw)
  const right_x = Math.cos(yaw)
  const right_z = -Math.sin(yaw)
  let wx = fwd_x * forward + right_x * strafe
  let wz = fwd_z * forward + right_z * strafe
  const len = Math.hypot(wx, wz)
  if (len > 1e-6) {
    wx /= len
    wz /= len
  } else {
    wx = 0
    wz = 0
  }
  return [wx, wz]
}

const accelerate_horizontal = (vel: Vec3Mut, tx: number, tz: number, rate: number, dt: number): void => {
  const dx = tx - vel[0]
  const dz = tz - vel[2]
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-9) return
  const step = Math.min(dist, rate * dt)
  vel[0] += (dx / dist) * step
  vel[2] += (dz / dist) * step
}

const turn_toward = (facing: number, target: number, lambda: number, dt: number): number => {
  let delta = target - facing
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return facing + delta * (1 - Math.exp(-lambda * dt))
}

/** Advance one fixed step: intent → curves → jump → gravity → collide → ground/anim bookkeeping. */
export const step_controller = (
  state: ControllerState,
  input: Readonly<ControllerInput>,
  env: ControllerEnv,
  step_dt: number
): ControllerState => {
  const dt = Math.min(0.05, Math.max(1e-4, step_dt)) // a huge hitch must not launch the body
  state._air_jump_fired = false
  const { solid_at, liquid_at } = env
  const [pos_x, pos_y, pos_z] = state.position
  const vel = state.velocity

  const head_y = pos_y + CHARACTER_HEIGHT * 0.9
  const in_water = liquid_at(Math.floor(pos_x), Math.floor(head_y), Math.floor(pos_z))
  state.in_water = in_water

  const [dir_x, dir_z] = move_direction(input.forward, input.strafe, input.yaw)
  const has_move = dir_x !== 0 || dir_z !== 0
  const ground_speed = (input.walk ? WALK_SPEED : RUN_SPEED) * (input.speed_scale || 1)

  if (in_water) {
    // water keeps the legacy exponential glide — swimming is MEANT to feel fluid, not crisp
    vel[0] = damp(vel[0], dir_x * SWIM_SPEED, SWIM_LAMBDA, dt)
    vel[2] = damp(vel[2], dir_z * SWIM_SPEED, SWIM_LAMBDA, dt)
  } else if (state.on_ground) {
    if (has_move) {
      const rate = vel[0] * dir_x + vel[2] * dir_z < -0.01 ? GROUND_BRAKE : GROUND_ACCEL
      accelerate_horizontal(vel, dir_x * ground_speed, dir_z * ground_speed, rate, dt)
    } else {
      // Minecraft-style multiplicative stop: a minimal present glide with a soft tail, then snap
      // only the imperceptible crawl.
      const keep = MC_STOP_FACTOR ** (dt * 20)
      vel[0] *= keep
      vel[2] *= keep
      if (Math.hypot(vel[0], vel[2]) < STOP_SNAP_SPEED) {
        vel[0] = 0
        vel[2] = 0
      }
    }
  } else if (has_move) {
    accelerate_horizontal(vel, dir_x * ground_speed, dir_z * ground_speed, AIR_ACCEL, dt)
  }

  const jump_pressed = input.jump && !state._jump_was_down
  const jump_released = !input.jump && state._jump_was_down
  state._jump_was_down = input.jump
  if (jump_pressed) state._jump_buffer = JUMP_BUFFER
  state._jump_buffer = Math.max(0, state._jump_buffer - dt)

  if (in_water) {
    vel[1] = input.jump ? SWIM_UP_SPEED : -GRAVITY_UNDERWATER
  } else {
    if (jump_released && !state.on_ground && vel[1] > 0) vel[1] *= JUMP_CUT_MULT
    const can_jump = state.on_ground || state._since_ground < COYOTE_TIME
    if (state._jump_buffer > 0 && can_jump) {
      vel[1] = JUMP_FORCE
      if (has_move) {
        vel[0] += dir_x * JUMP_FORWARD_IMPULSE
        vel[2] += dir_z * JUMP_FORWARD_IMPULSE
      }
      state._jump_buffer = 0
      state._since_ground = 999 // consume coyote
      state.on_ground = false
    } else if (jump_pressed && !can_jump && !state._air_jumped) {
      // Double-jump: one mid-air bounce, REPLACES vy, keeps horizontal momentum.
      vel[1] = JUMP_FORCE * AIR_JUMP_MULT
      if (has_move) {
        vel[0] += dir_x * JUMP_FORWARD_IMPULSE
        vel[2] += dir_z * JUMP_FORWARD_IMPULSE
      }
      state._air_jumped = true
      state._jump_buffer = 0
      state._air_jump_fired = true
    } else {
      const gliding = input.glide && vel[1] <= 0
      const gravity = gliding ? GLIDE_GRAVITY : vel[1] > 0 ? RISE_GRAVITY : RISE_GRAVITY * FALL_GRAVITY_MULT
      vel[1] = Math.max(gliding ? GLIDE_TERMINAL_FALL : TERMINAL_FALL, vel[1] - gravity * dt)
    }
  }

  const res = resolve_movement(solid_at, [pos_x, pos_y, pos_z], vel, dt, {})
  state.position = res.position
  state.velocity = res.velocity

  if (res.on_ground) {
    state._since_ground = 0
    state._air_jumped = false // the air-jump charge refills on landing
  } else state._since_ground += dt
  state.on_ground = res.on_ground

  if (res.on_ground) [, state._fall_peak_y] = state.position
  else state._fall_peak_y = Math.max(state._fall_peak_y, state.position[1])

  // Auto-step visual smoothing: the collision step stays instant; the RENDERED feet absorb the
  // snap into a decaying offset (~STEP_SMOOTH_MS), easing avatar + camera up the block.
  if (res.stepped && state.position[1] > pos_y)
    state._step_offset = Math.max(-STEP_OFFSET_MAX, state._step_offset - (state.position[1] - pos_y))
  state._step_offset = damp(state._step_offset, 0, STEP_SMOOTH_LAMBDA, dt)
  state.visual_y = state.position[1] + state._step_offset

  const sp = Math.hypot(state.velocity[0], state.velocity[2])
  state.speed = sp
  if (has_move) state.facing_yaw = turn_toward(state.facing_yaw, Math.atan2(dir_x, dir_z), 12, dt)

  state.anim = classify_anim(state)
  state.gait_scale =
    state.anim === 'RUN'
      ? Math.min(1.6, Math.max(0.5, sp / RUN_SPEED))
      : state.anim === 'WALK'
        ? Math.min(1.6, Math.max(0.5, sp / WALK_SPEED))
        : 1
  return state
}

export const classify_anim = (
  state: Readonly<ControllerState>,
  { ground_gait = 'auto' }: Readonly<{ ground_gait?: 'auto' | 'walk' | 'run' }> = {}
): PlayerAnim => {
  const moving = state.speed > 0.5
  if (state.in_water) return 'SWIM'
  if (!state.on_ground) {
    if (state.velocity[1] > 0.5) return moving ? 'JUMP_RUN' : 'JUMP'
    // FALL only past a REAL drop — hops/terraces/jump arcs hold the air pose instead of flickering.
    if (state.velocity[1] < -2 && state._fall_peak_y - state.position[1] > FALL_ANIM_THRESHOLD) return 'FALL'
    return moving ? 'JUMP_RUN' : 'JUMP'
  }
  if (moving) {
    if (ground_gait === 'walk') return 'WALK'
    if (ground_gait === 'run') return 'RUN'
    return state.speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'RUN' : 'WALK'
  }
  return 'IDLE'
}

/** Snap the body to stand on the ground directly below (spawn helper). */
export const ground_controller = (state: ControllerState, env: ControllerEnv, from_y?: number): void => {
  const [x, , z] = state.position
  const gy = ground_height_below(env.solid_at, x, from_y ?? state.position[1], z)
  if (gy !== null) {
    state.position[1] = gy
    state.visual_y = gy
    state.velocity[1] = 0
    state.on_ground = true
    state._since_ground = 0
  }
}

export const CONTROLLER_CONSTANTS = Object.freeze({
  WALK_SPEED,
  RUN_SPEED,
  SWIM_SPEED,
  GLIDE_GRAVITY,
  GLIDE_TERMINAL_FALL,
  GROUND_ACCEL,
  GROUND_BRAKE,
  MC_STOP_FACTOR,
  STOP_SNAP_SPEED,
  AIR_ACCEL,
  RISE_GRAVITY,
  FALL_GRAVITY_MULT,
  JUMP_APEX_M,
  JUMP_FORCE,
  JUMP_CUT_MULT,
  AIR_JUMP_MULT,
  COYOTE_TIME,
  JUMP_BUFFER,
  FALL_ANIM_THRESHOLD,
  STEP_SMOOTH_MS,
})
