// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from './types.ts'

export const AURA_TRAIL_LIFETIME = 700
export const AURA_TRAIL_LIMIT = 12
export type AuraParticle = Readonly<{ position: Vec3; born: number; serial: number }>
export type AuraTrail = Readonly<{
  position: Vec3
  at: number
  carry: number
  serial: number
  particles: readonly AuraParticle[]
}>

/** Only observed displacement emits. Teleports and resumed visibility start a fresh trail. */
export const advance_aura_trail = (
  previous: AuraTrail | undefined,
  position: Vec3,
  now: number,
  scale: number
): AuraTrail => {
  const empty = { position, at: now, carry: 0, serial: 0, particles: [] }
  if (!previous) return empty
  const dx = position[0] - previous.position[0]
  const dz = position[2] - previous.position[2]
  const distance = Math.hypot(dx, dz)
  if (distance > 4 * scale || now - previous.at > 250) return empty
  const spacing = 0.28 * scale
  const count = Math.min(AURA_TRAIL_LIMIT, Math.floor((previous.carry + distance) / spacing))
  const born = Array.from({ length: count }, (_, index): AuraParticle => {
    const fraction = (spacing - previous.carry + index * spacing) / Math.max(distance, 0.001)
    return {
      position: [
        previous.position[0] + dx * fraction,
        previous.position[1] + (position[1] - previous.position[1]) * fraction,
        previous.position[2] + dz * fraction,
      ],
      born: now,
      serial: previous.serial + index,
    }
  })
  return {
    position,
    at: now,
    carry: (previous.carry + distance) % spacing,
    serial: previous.serial + count,
    particles: [...previous.particles.filter((particle) => now - particle.born < AURA_TRAIL_LIFETIME), ...born].slice(
      -AURA_TRAIL_LIMIT
    ),
  }
}
