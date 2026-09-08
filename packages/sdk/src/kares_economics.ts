// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const KARES_UNIT = 1_000_000_000n
export const KARES_SUPPLY = 1_000_000n * KARES_UNIT
export const COMMUNITY_VESTING_MS = 1_825n * 86_400_000n
/** Presentation mirror pinned to offering.move by the SDK contract census test. */
export const KARES_ALLOCATION = Object.freeze({
  offering: 400_000n * KARES_UNIT,
  liquidity: 160_000n * KARES_UNIT,
  rewards: 200_000n * KARES_UNIT,
  team: 30_000n * KARES_UNIT,
  combat: 100_000n * KARES_UNIT,
  community: 110_000n * KARES_UNIT,
})

export const KARES_LAUNCH_AVAILABLE = KARES_ALLOCATION.offering + KARES_ALLOCATION.liquidity + KARES_ALLOCATION.team
