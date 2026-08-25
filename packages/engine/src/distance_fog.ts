// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CPU twin of the terminal haze curve composed into the Hillaire fog node. This is not a
// second fog system: it only guarantees that the physical aerial perspective closes before
// far terrain ends, hiding the finite shell without washing out the foreground.

export const DISTANCE_HAZE_POWER = 1.5
export const DISTANCE_HAZE_MAX = 0.995

export const distance_haze_factor = (distance: number, near: number, far: number): number => {
  const progress = Math.max(0, Math.min(1, (distance - near) / Math.max(1, far - near)))
  const eased = progress * progress * (3 - 2 * progress)
  return Math.pow(eased, DISTANCE_HAZE_POWER) * DISTANCE_HAZE_MAX
}
