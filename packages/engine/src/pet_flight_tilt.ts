// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from './types.ts'

export type PetFlightTilt = Readonly<{ position: Vec3; yaw: number; bank: number; pitch: number }>
const clamp = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value))

/** Local and remote pets bank from observed motion, without another orientation field on the wire. */
export const advance_pet_flight_tilt = (
  previous: PetFlightTilt | undefined,
  position: Vec3,
  yaw: number,
  gliding: boolean,
  dt: number
): PetFlightTilt => {
  if (!previous) return { position, yaw, bank: 0, pitch: 0 }
  const turn = Math.atan2(Math.sin(yaw - previous.yaw), Math.cos(yaw - previous.yaw))
  const horizontal = Math.hypot(position[0] - previous.position[0], position[2] - previous.position[2])
  const active = Number(gliding && horizontal < 8)
  const bank = clamp((-turn / Math.max(dt, 0.001)) * 0.32, 0.55) * active
  const pitch = clamp(Math.atan2(previous.position[1] - position[1], Math.max(horizontal, 0.01)), 0.25) * active
  const ease = 1 - Math.exp(-7 * dt)
  return {
    position,
    yaw,
    bank: previous.bank + (bank - previous.bank) * ease,
    pitch: previous.pitch + (pitch - previous.pitch) * ease,
  }
}
