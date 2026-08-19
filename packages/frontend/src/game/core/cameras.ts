// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Camera addons — pluggable views over one frame contract; the director travels between them so
// every switch is one continuous move. The follow addon is a LOSSLESS PORT of the legacy shoulder
// rig (deprecated/engine/src/player/camera_rig.js — spring follow, shoulder offset, hold-to-rotate
// pointer lock, wall-march collision, head-bob, first-person hysteresis, dynamic FOV, cinematic
// mode); the fight addon ports the shipped frontend board rig: fixed orthographic 45°/50° framing,
// a subtle positional wobble, bounded right-drag pan, and independent frustum zoom.

import type { Vec3 } from '@aresrpg/engine'

import type { SolidFn } from './collision.ts'
import { create_pointer_lock_controls } from './pointer_lock.ts'

export type CameraFrame = Readonly<{
  position: Vec3
  target: Vec3
  fov: number
  ortho_blend: number
  ortho_height?: number
}>
export type CameraAnchor = Readonly<{
  x: number
  y: number
  z: number
  eye_height: number
  speed: number
  on_ground: boolean
}>
export type CameraAddon = Readonly<{
  frame: (anchor: CameraAnchor, dt: number) => CameraFrame
  get_yaw: () => number
  attach?: (canvas: HTMLElement) => void
  detach?: () => void
}>

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

const damp = (c: number, t: number, l: number, dt: number): number => c + (t - c) * (1 - Math.exp(-l * dt))

/** Eye pose (yaw/pitch) → a look target 10 m ahead (legacy fly-camera Euler YXZ, forward = −Z). */
const look_target = (position: Vec3, yaw: number, pitch: number): Vec3 => {
  const cos_pitch = Math.cos(pitch)
  return [
    position[0] - Math.sin(yaw) * cos_pitch * 10,
    position[1] + Math.sin(pitch) * 10,
    position[2] - Math.cos(yaw) * cos_pitch * 10,
  ]
}

// ═══ SPECTATE — the pre-login overview (this era's own view; drag pan lives in world.ts) ═══

export const create_spectate_addon = (
  view: Readonly<{
    focus: () => readonly [number, number]
    zoom: () => number
    ground_y: () => number
    yaw: () => number
    pitch: () => number
  }>
): CameraAddon =>
  Object.freeze({
    get_yaw: () => 0,
    frame: () => {
      const [x, z] = view.focus()
      const zoom = view.zoom()
      const ground_y = view.ground_y()
      const arm = zoom * 1.2
      const horizontal = Math.cos(view.pitch()) * arm
      return {
        position: [
          x + Math.sin(view.yaw()) * horizontal,
          ground_y + Math.sin(view.pitch()) * arm,
          z + Math.cos(view.yaw()) * horizontal,
        ] as Vec3,
        target: [x, ground_y, z] as Vec3,
        fov: 48,
        ortho_blend: 0,
      }
    },
  })

// ═══ FOLLOW — the legacy shoulder rig, ported verbatim ═══

const BASE_FOV = 70
const MAX_FOV_BOOST = 10
const MAX_SPEED = 12
const FOV_LAMBDA = 8
const HEAD_HEIGHT = 1.0
const FOLLOW_HALFLIFE = 0.15
const RUN_FOLLOW_HALFLIFE = 0.22 // running trails a touch more; idle/walk stay crisp (cinematic mode removed — owner 2026-08-15)
const ROTATE_SENSITIVITY = 0.0025
const MIN_POLAR = (12 * Math.PI) / 180
const MAX_POLAR = (135 * Math.PI) / 180 // may swing below the head-plane to look steeply up
const SHOULDER_OFFSET = 0.5
const MIN_DIST = 1.2
const MAX_DIST = 8
const ZOOM_LAMBDA = 8
const START_DIST = 4.5
const CAM_WALL_MARGIN = 0.3 // L∞ cube margin every camera anchor keeps off solid faces
const FP_WALL_BACKOFF_MAX = 0.6
const FP_WALL_BACKOFF_STEP = 0.05
const ARM_LAMBDA = 18
const BOB_WALK_HZ = 1.6
const BOB_RUN_HZ = 2.2
const BOB_WALK_AMP = 0.035
const BOB_RUN_AMP = 0.06
const BOB_MIN_SPEED = 0.5
const BOB_WALK_SPEED = 4.8
const BOB_RUN_SPEED = 10.5
const BOB_EASE_LAMBDA = 15
const FP_ENTER_DIST = 1.2
const FP_EXIT_DIST = 1.4
const FP_MIN_DIST = 1.0
const FP_BLEND_S = 0.2

/** Critically-damped 3D spring (Game Programming Gems 4 form) — ported verbatim, closure shape. */
const create_spring = (initial_halflife: number) => {
  const spring = { halflife: initial_halflife }
  let vx = 0
  let vy = 0
  let vz = 0
  let x = 0
  let y = 0
  let z = 0
  let initialized = false
  return Object.assign(spring, {
    translate: (dx: number, dy: number, dz: number): void => {
      if (!initialized) return
      x += dx
      y += dy
      z += dz
    },
    update: (tx: number, ty: number, tz: number, dt: number): Vec3 => {
      if (!initialized) {
        x = tx
        y = ty
        z = tz
        initialized = true
        return [x, y, z]
      }
      const omega = 4 / spring.halflife
      const exp = Math.exp(-omega * dt)
      const dt_exp = dt * exp
      const pp = (1 + omega * dt) * exp
      const vp = -omega * omega * dt_exp
      const vv = (1 - omega * dt) * exp
      let d = x - tx
      let np = pp * d + dt_exp * vx
      vx = vp * d + vv * vx
      x = np + tx
      d = y - ty
      np = pp * d + dt_exp * vy
      vy = vp * d + vv * vy
      y = np + ty
      d = z - tz
      np = pp * d + dt_exp * vz
      vz = vp * d + vv * vz
      z = np + tz
      return [x, y, z]
    },
  })
}

/** True iff any solid voxel intersects the cube [p−r, p+r]³ (L∞ margin — corner-leak proof). */
const cube_overlaps_solid = (solid_at: SolidFn, x: number, y: number, z: number, r: number): boolean => {
  const x1 = Math.floor(x + r)
  const y1 = Math.floor(y + r)
  const z1 = Math.floor(z + r)
  for (let cy = Math.floor(y - r); cy <= y1; cy += 1)
    for (let cz = Math.floor(z - r); cz <= z1; cz += 1)
      for (let cx = Math.floor(x - r); cx <= x1; cx += 1) if (solid_at(cx, cy, cz)) return true
  return false
}

/** March the margin cube outward, return the LAST proven-clean distance (0 = buried origin). */
const wall_march = (
  solid_at: SolidFn,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max_dist: number,
  margin: number
): number => {
  const STEP = 0.25
  let clear = 0
  for (let t = 0; ; t = Math.min(t + STEP, max_dist)) {
    if (cube_overlaps_solid(solid_at, ox + dx * t, oy + dy * t, oz + dz * t, margin)) return clear
    clear = t
    if (t >= max_dist) return max_dist
  }
}

export type FollowAddon = CameraAddon &
  Readonly<{
    is_rotating: () => boolean
    rotate: (dx: number, dy: number) => void
    dolly: (meters: number) => void
    get_bob_offset: () => number
    is_first_person: () => boolean
    distance: () => number
    translate_y: (amount: number) => void
  }>

export const create_follow_addon = (
  solid_at: SolidFn,
  { yaw = 0, distance = START_DIST }: Readonly<{ yaw?: number; distance?: number }> = {}
): FollowAddon => {
  let azimuth = yaw
  let polar = (72 * Math.PI) / 180
  let target_dist = clamp(distance, MIN_DIST, MAX_DIST)
  let zoom_dist = target_dist
  let arm = target_dist
  const follow = create_spring(FOLLOW_HALFLIFE)
  let fov = BASE_FOV
  let bob_phase = 0
  let bob_amp_env = 0
  let last_bob_y = 0
  let fp_mode = false
  let fp_blend = 0
  let last_arm_blend = target_dist

  const apply_rotate = (dx: number, dy: number): void => {
    azimuth -= dx * ROTATE_SENSITIVITY
    polar = clamp(polar - dy * ROTATE_SENSITIVITY, MIN_POLAR, MAX_POLAR)
  }

  const dolly = (meters: number): void => {
    target_dist = clamp(target_dist + meters, FP_MIN_DIST, MAX_DIST)
  }

  const controls = create_pointer_lock_controls({
    on_rotate: apply_rotate,
    on_wheel: (delta) => dolly(Math.sign(delta) * 0.5),
  })

  const frame = (anchor: CameraAnchor, dt: number): CameraFrame => {
    const { x: head_x, y: feet_y, z: head_z, eye_height, speed, on_ground } = anchor
    const speed_ratio = clamp((speed - BOB_WALK_SPEED) / (BOB_RUN_SPEED - BOB_WALK_SPEED), 0, 1)
    follow.halflife = FOLLOW_HALFLIFE + (RUN_FOLLOW_HALFLIFE - FOLLOW_HALFLIFE) * speed_ratio
    zoom_dist = damp(zoom_dist, target_dist, ZOOM_LAMBDA, dt)
    // First-person hysteresis on the USER'S TARGET distance — a wall squeeze never flips modes.
    const fp_allowed = Reflect.get(globalThis, '__ARES_FP') !== false
    if (!fp_allowed) fp_mode = false
    else if (!fp_mode && target_dist < FP_ENTER_DIST) fp_mode = true
    else if (fp_mode && target_dist > FP_EXIT_DIST) fp_mode = false
    fp_blend = fp_mode ? Math.min(1, fp_blend + dt / FP_BLEND_S) : Math.max(0, fp_blend - dt / FP_BLEND_S)
    // Orbit pivot = spring-smoothed head, laterally biased for the shoulder framing (fades toward
    // a centered first-person eye as the zoom crosses below the classic floor).
    const shoulder = SHOULDER_OFFSET * clamp(zoom_dist / MIN_DIST, 0, 1)
    const head_y = feet_y + Math.max(eye_height, HEAD_HEIGHT)
    const right_x = Math.cos(azimuth)
    const right_z = -Math.sin(azimuth)
    const [pivot_x, pivot_y, pivot_z] = follow.update(
      head_x + right_x * shoulder,
      head_y,
      head_z + right_z * shoulder,
      dt
    )

    const sin_p = Math.sin(polar)
    const cos_p = Math.cos(polar)
    const dir_x = Math.sin(azimuth) * sin_p
    const dir_y = cos_p // polar from straight-UP: < 90° puts the eye ABOVE the pivot, looking down
    const dir_z = Math.cos(azimuth) * sin_p

    // Camera collision: shorten instantly on a wall, ease back out when it clears.
    const free_dist = wall_march(solid_at, pivot_x, pivot_y, pivot_z, dir_x, dir_y, dir_z, zoom_dist, CAM_WALL_MARGIN)
    arm = free_dist < arm ? free_dist : damp(arm, free_dist, ARM_LAMBDA, dt)

    const view_yaw = azimuth
    const pitch = Math.atan2(-cos_p, sin_p)

    // Safe first-person anchor: the head pulled back along the view axis to the first clean point.
    const pivot_dirty = free_dist === 0 && cube_overlaps_solid(solid_at, pivot_x, pivot_y, pivot_z, CAM_WALL_MARGIN)
    let fp_x = head_x
    let fp_y = head_y
    let fp_z = head_z
    if ((fp_blend > 0 || pivot_dirty) && cube_overlaps_solid(solid_at, fp_x, fp_y, fp_z, CAM_WALL_MARGIN)) {
      for (let back = FP_WALL_BACKOFF_STEP; back <= FP_WALL_BACKOFF_MAX + 1e-9; back += FP_WALL_BACKOFF_STEP) {
        const bx = head_x + dir_x * back
        const by = head_y + dir_y * back
        const bz = head_z + dir_z * back
        if (!cube_overlaps_solid(solid_at, bx, by, bz, CAM_WALL_MARGIN)) {
          fp_x = bx
          fp_y = by
          fp_z = bz
          break
        }
      }
    }

    const eye_x = pivot_dirty ? fp_x : pivot_x + dir_x * arm
    const eye_y = pivot_dirty ? fp_y : pivot_y + dir_y * arm
    const eye_z = pivot_dirty ? fp_z : pivot_z + dir_z * arm

    // Dynamic FOV — widens with speed (ratio² easing), spring-damped.
    const ratio = Math.min(speed / MAX_SPEED, 1)
    fov = damp(fov, BASE_FOV + ratio * ratio * MAX_FOV_BOOST, FOV_LAMBDA, dt)

    // Head-bob: pure vertical eye translation, eased envelope, zero when idle/airborne.
    const bob_on = Reflect.get(globalThis, '__ARES_BOB') !== false
    const bob_target =
      bob_on && on_ground && speed > BOB_MIN_SPEED ? BOB_WALK_AMP + (BOB_RUN_AMP - BOB_WALK_AMP) * speed_ratio : 0
    if (bob_target > 0) {
      const bob_hz = BOB_WALK_HZ + (BOB_RUN_HZ - BOB_WALK_HZ) * speed_ratio
      bob_phase = (bob_phase + 2 * Math.PI * bob_hz * dt) % (2 * Math.PI)
    }
    bob_amp_env = damp(bob_amp_env, bob_target, BOB_EASE_LAMBDA, dt)
    const bob_y = bob_amp_env * Math.sin(bob_phase)
    last_bob_y = bob_y

    // First-person blend: pure eye translation onto the safe head anchor — zero look pop.
    const fp_e = fp_blend * fp_blend * (3 - 2 * fp_blend)
    const out: Vec3 = [
      eye_x + (fp_x - eye_x) * fp_e,
      eye_y + (fp_y - eye_y) * fp_e + bob_y,
      eye_z + (fp_z - eye_z) * fp_e,
    ]
    last_arm_blend = arm * (1 - fp_e)
    return { position: out, target: look_target(out, view_yaw, pitch), fov, ortho_blend: 0 }
  }

  return Object.freeze({
    frame,
    get_yaw: () => azimuth,
    attach: (canvas: HTMLElement) => controls.attach(canvas),
    detach: () => controls.detach(),
    is_rotating: () => controls.is_locked(),
    rotate: apply_rotate,
    dolly,
    translate_y: (amount: number) => follow.translate(0, amount, 0),
    get_bob_offset: () => last_bob_y,
    is_first_person: () => fp_mode,
    /// Effective eye distance (collapses to 0 in first person) — the avatar-hide gate.
    distance: () => last_arm_blend,
  })
}

// ═══ FIGHT — the shipped fixed-angle orthographic board rig ═══

export const FIGHT_POLAR_RAD = (50 * Math.PI) / 180
const FIGHT_AZIMUTH = Math.PI / 4
const FIGHT_FOV = 66
const FIGHT_LOOK_UP_RAD = 0.07
const PAN_ENVELOPE_FRAC = 0.35
const PAN_METERS_PER_PIXEL = 0.015
const ZOOM_MIN = 11
const ZOOM_MAX = 42

export type FightBoardFrame = Readonly<{
  origin: Readonly<{ x: number; y: number; z: number }>
  grid_w: number
  grid_h: number
  cell_size: number
}>

export const idle_wobble = (seconds: number): Readonly<{ x: number; y: number; z: number }> => {
  const wave = seconds * 2 * Math.PI * 0.2
  return {
    x: 0.08 * Math.sin(wave),
    y: 0.04 * Math.sin(wave * 0.8 + 1.7),
    z: 0.08 * Math.cos(wave * 0.9 + 0.5),
  }
}

export type FightAddon = CameraAddon &
  Readonly<{
    pan_by_pixels: (dx: number, dy: number) => void
    zoom_by: (steps: number) => void
    reset: () => void
    get_state: () => Readonly<{ pan_x: number; pan_z: number; zoom: number }>
  }>

export const create_fight_addon = ({
  board,
  viewport = () => [1, 1],
}: Readonly<{
  board: () => FightBoardFrame
  viewport?: () => readonly [number, number]
}>): FightAddon => {
  let pan_x = 0
  let pan_z = 0
  let zoom = 0
  let elapsed = 0
  let dragging: Readonly<{ x: number; y: number; id: number }> | null = null
  let canvas: HTMLElement | null = null

  const pan_limits = (): readonly [number, number] => {
    const frame = board()
    return [
      frame.grid_w * frame.cell_size * 0.5 * PAN_ENVELOPE_FRAC,
      frame.grid_h * frame.cell_size * 0.5 * PAN_ENVELOPE_FRAC,
    ]
  }
  const clamp_pan = (): void => {
    const [limit_x, limit_z] = pan_limits()
    pan_x = clamp(pan_x, -limit_x, limit_x)
    pan_z = clamp(pan_z, -limit_z, limit_z)
  }
  const pan_by_pixels = (dx: number, dy: number): void => {
    pan_x -= (Math.cos(FIGHT_AZIMUTH) * dx + Math.sin(FIGHT_AZIMUTH) * dy) * PAN_METERS_PER_PIXEL
    pan_z += (Math.sin(FIGHT_AZIMUTH) * dx - Math.cos(FIGHT_AZIMUTH) * dy) * PAN_METERS_PER_PIXEL
    clamp_pan()
  }
  const reset = (): void => {
    pan_x = 0
    pan_z = 0
    zoom = 0
  }
  const on_down = (event: PointerEvent): void => {
    if (event.button !== 2) return
    event.preventDefault()
    dragging = { x: event.clientX, y: event.clientY, id: event.pointerId }
    canvas?.setPointerCapture(event.pointerId)
  }
  const on_move = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return
    pan_by_pixels(event.clientX - dragging.x, event.clientY - dragging.y)
    dragging = { x: event.clientX, y: event.clientY, id: dragging.id }
  }
  const on_up = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    dragging = null
  }
  const on_wheel = (event: WheelEvent): void => {
    event.preventDefault()
    zoom = clamp(zoom + Math.sign(event.deltaY) * 0.8, -21, 20)
  }
  const on_context_menu = (event: Event): void => event.preventDefault()

  return Object.freeze({
    frame: (_anchor: CameraAnchor, dt: number) => {
      elapsed += dt
      const frame = board()
      clamp_pan()
      const width = frame.grid_w * frame.cell_size
      const height = frame.grid_h * frame.cell_size
      const center_x = frame.origin.x + width / 2 + pan_x
      const center_z = frame.origin.z + height / 2 + pan_z
      const diagonal = Math.hypot(width, height)
      const fit = diagonal / 2 / Math.tan((FIGHT_FOV * Math.PI) / 360)
      const base = clamp(fit, 22, 32)
      const distance = clamp(base + zoom, ZOOM_MIN, ZOOM_MAX)
      const [viewport_width, viewport_height] = viewport()
      const aspect = Math.max(1, viewport_width) / Math.max(1, viewport_height)
      const half_x = (width * Math.abs(Math.cos(FIGHT_AZIMUTH)) + height * Math.abs(Math.sin(FIGHT_AZIMUTH))) / 2
      const half_y =
        ((width * Math.abs(Math.sin(FIGHT_AZIMUTH)) + height * Math.abs(Math.cos(FIGHT_AZIMUTH))) / 2) *
          Math.cos(FIGHT_POLAR_RAD) +
        1.2
      const ortho_height = Math.max(half_y, half_x / aspect) * 2.16 * (distance / base)
      const horizontal = base * Math.sin(FIGHT_POLAR_RAD)
      const wobble = idle_wobble(elapsed)
      const position: Vec3 = [
        center_x + horizontal * Math.sin(FIGHT_AZIMUTH) + wobble.x,
        frame.origin.y + base * Math.cos(FIGHT_POLAR_RAD) + 1.2 + wobble.y,
        center_z + horizontal * Math.cos(FIGHT_AZIMUTH) + wobble.z,
      ]
      const aim_y =
        position[1] -
        Math.hypot(position[0] - center_x, position[2] - center_z) *
          Math.tan(Math.PI / 2 - FIGHT_POLAR_RAD - FIGHT_LOOK_UP_RAD)
      return {
        position,
        target: [center_x, aim_y, center_z] as Vec3,
        fov: FIGHT_FOV,
        ortho_blend: 1,
        ortho_height,
      }
    },
    get_yaw: () => FIGHT_AZIMUTH,
    attach: (element: HTMLElement) => {
      canvas = element
      element.addEventListener('pointerdown', on_down)
      globalThis.addEventListener('pointermove', on_move)
      globalThis.addEventListener('pointerup', on_up)
      globalThis.addEventListener('pointercancel', on_up)
      element.addEventListener('wheel', on_wheel, { passive: false })
      element.addEventListener('contextmenu', on_context_menu)
    },
    detach: () => {
      if (!canvas) return
      canvas.removeEventListener('pointerdown', on_down)
      globalThis.removeEventListener('pointermove', on_move)
      globalThis.removeEventListener('pointerup', on_up)
      globalThis.removeEventListener('pointercancel', on_up)
      canvas.removeEventListener('wheel', on_wheel)
      canvas.removeEventListener('contextmenu', on_context_menu)
      canvas = null
      dragging = null
    },
    pan_by_pixels,
    zoom_by: (steps: number) => {
      zoom = clamp(zoom + steps, -21, 20)
    },
    reset,
    get_state: () => Object.freeze({ pan_x, pan_z, zoom }),
  })
}

// ═══ DIRECTOR — owns the live addon; every switch is one continuous travel ═══

const TRAVEL_SECONDS = 0.45

const ease = (amount: number): number => amount * amount * (3 - 2 * amount)
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount

const mix_frames = (from: CameraFrame, to: CameraFrame, amount: number): CameraFrame => ({
  position: [
    lerp(from.position[0], to.position[0], amount),
    lerp(from.position[1], to.position[1], amount),
    lerp(from.position[2], to.position[2], amount),
  ],
  target: [
    lerp(from.target[0], to.target[0], amount),
    lerp(from.target[1], to.target[1], amount),
    lerp(from.target[2], to.target[2], amount),
  ],
  fov: lerp(from.fov, to.fov, amount),
  ortho_blend: lerp(from.ortho_blend, to.ortho_blend, amount),
  ortho_height:
    from.ortho_height === undefined || to.ortho_height === undefined
      ? to.ortho_height
      : lerp(from.ortho_height, to.ortho_height, amount),
})

export type CameraDirector = Readonly<{
  use: (addon: CameraAddon) => void
  active: () => CameraAddon
  set_enabled: (enabled: boolean) => void
  frame: (anchor: CameraAnchor, dt: number) => CameraFrame
}>

export const create_camera_director = (initial: CameraAddon, canvas: HTMLElement): CameraDirector => {
  let active = initial
  let last_frame: CameraFrame | null = null
  let departure: CameraFrame | null = null
  let travel = 1
  let enabled = true
  active.attach?.(canvas)

  return Object.freeze({
    use: (addon: CameraAddon) => {
      if (addon === active) return
      if (enabled) active.detach?.()
      departure = last_frame
      travel = last_frame === null ? 1 : 0
      active = addon
      if (enabled) active.attach?.(canvas)
    },
    active: () => active,
    set_enabled: (next: boolean) => {
      if (next === enabled) return
      enabled = next
      if (next) active.attach?.(canvas)
      else active.detach?.()
    },
    frame: (anchor: CameraAnchor, dt: number) => {
      const destination = active.frame(anchor, dt)
      travel = Math.min(1, travel + dt / TRAVEL_SECONDS)
      const frame = travel >= 1 || departure === null ? destination : mix_frames(departure, destination, ease(travel))
      last_frame = frame
      return frame
    },
  })
}
