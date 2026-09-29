// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

import type { WalkPoint } from './walkable.ts'
import type { RunTarget } from './run_to.ts'

const LEG_RADIUS = 8

type AxisBounds = Readonly<{ min: number; max: number }>
type WalkingLeg = Readonly<{
  target: RunTarget
  exit: 'x' | 'z' | null
  bounds: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
}>

/** End just across a zone boundary, on the origin's one-block search lattice. */
const axis_bounds = (position: number): AxisBounds => {
  const zone_start = chain_to_client_coordinate(
    Math.floor(client_to_chain_coordinate(position) / ZONE_SIZE) * ZONE_SIZE
  )
  return {
    min: position - Math.min(LEG_RADIUS, Math.max(1, Math.floor(position - zone_start) + 1)),
    max: position + Math.min(LEG_RADIUS, Math.max(1, Math.ceil(zone_start + ZONE_SIZE - position))),
  }
}

const axis_fraction = (position: number, delta: number, bounds: AxisBounds): number =>
  delta === 0 ? Infinity : ((delta > 0 ? bounds.max : bounds.min) - position) / delta

/** A far destination selects an exit edge, not one possibly obstructed pixel on that edge. */
export const walking_leg = (origin: WalkPoint, target: RunTarget): WalkingLeg => {
  const x = axis_bounds(origin[0])
  const z = axis_bounds(origin[2])
  const dx = target.x - origin[0]
  const dz = target.z - origin[2]
  const fraction_x = axis_fraction(origin[0], dx, x)
  const fraction_z = axis_fraction(origin[2], dz, z)
  const fraction = Math.min(1, fraction_x, fraction_z)
  return {
    target: { ...target, x: origin[0] + dx * fraction, z: origin[2] + dz * fraction },
    exit: fraction === 1 ? null : fraction_x <= fraction_z ? 'x' : 'z',
    bounds: { min_x: x.min, max_x: x.max, min_z: z.min, max_z: z.max },
  }
}
