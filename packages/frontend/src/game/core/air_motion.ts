// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

type Horizontal = readonly [number, number]
const AIR_ACCEL = 31.5
const GLIDE_TURN_RATE = 1.8
const GLIDE_TURN_RESPONSE = 3
const GLIDE_THRUST_RESPONSE = 1.5

export const accelerate_horizontal = (
  velocity: Horizontal,
  target: Horizontal,
  rate: number,
  dt: number
): Horizontal => {
  const dx = target[0] - velocity[0]
  const dz = target[1] - velocity[1]
  const fraction = Math.min(1, (rate * dt) / Math.max(1e-9, Math.hypot(dx, dz)))
  return [velocity[0] + dx * fraction, velocity[1] + dz * fraction]
}

/** A glider redirects momentum through an arc. Releasing the controls coasts within the same speed budget. */
export const airborne_velocity = (
  velocity: Horizontal,
  direction: Horizontal,
  speed_limit: number,
  gliding: boolean,
  dt: number
): Horizontal => {
  const input = Math.hypot(...direction)
  if (!gliding)
    return accelerate_horizontal(
      velocity,
      [direction[0] * speed_limit, direction[1] * speed_limit],
      AIR_ACCEL * Number(input > 0),
      dt
    )
  const speed = Math.hypot(...velocity)
  if (input === 0) {
    const keep = Math.min(1, speed_limit / Math.max(speed, 1e-9))
    return [velocity[0] * keep, velocity[1] * keep]
  }
  const target = Math.atan2(direction[0], direction[1])
  const heading = speed < 0.1 ? target : Math.atan2(velocity[0], velocity[1])
  const angle = Math.atan2(Math.sin(target - heading), Math.cos(target - heading))
  const turn =
    Math.sign(angle) * Math.min(Math.abs(angle) * (1 - Math.exp(-GLIDE_TURN_RESPONSE * dt)), GLIDE_TURN_RATE * dt)
  const next_speed = Math.min(
    speed_limit,
    speed + (speed_limit * input - speed) * (1 - Math.exp(-GLIDE_THRUST_RESPONSE * dt))
  )
  return [Math.sin(heading + turn) * next_speed, Math.cos(heading + turn) * next_speed]
}

export { AIR_ACCEL }
