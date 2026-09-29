// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from '@aresrpg/engine'

export const actor_facing = (position: Vec3, listener: Vec3 | undefined, resting_yaw: number): number => {
  if (!listener) return resting_yaw
  const x = listener[0] - position[0]
  const z = listener[2] - position[2]
  return Math.hypot(x, z) === 0 ? resting_yaw : Math.atan2(x, z)
}
