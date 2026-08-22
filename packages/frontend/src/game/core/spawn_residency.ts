// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type WorldMobGroup = Readonly<{
  id: string
  x: number
  z: number
  members: readonly Readonly<{ mob_type: string; level_scalar: number }>[]
}>

const RENDER_RANGE_BLOCKS = 100

/** Presentation window over complete tracked truth. */
export const rendered_groups = (
  tracked: readonly WorldMobGroup[],
  own: Readonly<{ x: number; z: number }>
): readonly WorldMobGroup[] =>
  tracked
    .map((row) => ({ row, distance: Math.hypot(row.x - own.x, row.z - own.z) }))
    .filter(({ distance }) => distance < RENDER_RANGE_BLOCKS)
    .sort((left, right) => left.distance - right.distance)
    .map(({ row }) => row)
