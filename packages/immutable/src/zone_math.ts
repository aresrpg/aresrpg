// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { world_center } from './world.ts'

/** Twin of `aresrpg_math::zone_math`: how many mobs a group holds at a distance from the world centre.
 * The shared home of the rule for the population twin and for whoever chooses where to hunt. */
export const GROUP_SIZE_FULL_AT = 10_000n
export const GROUP_SIZE_AVG3_AT = 2_000n

/** `zone_math::distance_blocks` for a block position: the larger axis distance from the world centre.
 * The population rule applies it to the centre of a zone. */
export const center_distance = (x: number, z: number): number =>
  Math.max(Math.abs(x - world_center), Math.abs(z - world_center))

/** `zone_math::ramp`: linear from `from` at the centre to `to` at `full_at` blocks, flat beyond. */
export const distance_ramp = (distance: bigint, full_at: bigint, from: bigint, to: bigint): bigint => {
  const capped = distance > full_at ? full_at : distance
  return from + ((to - from) * capped) / full_at
}

/** `zone_math::group_size_bounds`: the smallest and the largest group drawn at that distance. */
export const mob_group_size_bounds = (distance: bigint): readonly [bigint, bigint] => {
  const low = distance_ramp(distance, GROUP_SIZE_FULL_AT, 1n, 6n)
  // At 2,000 blocks low=2 and high=4: uniform 2..4 has the authored average of three.
  const high = distance_ramp(distance, (GROUP_SIZE_AVG3_AT * 5n) / 3n, 1n, 6n)
  return Object.freeze([low, high < low ? low : high])
}
