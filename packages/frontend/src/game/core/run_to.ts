// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const RUN_TO_ARRIVAL_DISTANCE = 2

export type RunTarget = Readonly<{ x: number; z: number; ride_pet?: boolean }>

/** Automation waits for a following companion to reach the ordinary mount radius. */
export const run_to_mount = ({
  requested,
  available,
  riding,
  nearby,
}: Readonly<{
  requested: boolean
  available: boolean
  riding: boolean
  nearby: boolean
}>): 'run' | 'mount' | 'wait' => {
  if (!requested || !available || riding) return 'run'
  return nearby ? 'mount' : 'wait'
}

export const run_to_input = (
  current: Readonly<{ x: number; z: number }>,
  target: Readonly<{ x: number; z: number }>
): Readonly<{ arrived: boolean; yaw: number }> => {
  const dx = target.x - current.x
  const dz = target.z - current.z
  return Object.freeze({
    arrived: Math.hypot(dx, dz) <= RUN_TO_ARRIVAL_DISTANCE,
    yaw: Math.atan2(-dx, -dz),
  })
}
