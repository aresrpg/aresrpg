// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** Presentation mirror pinned to the rewards package by contract tests. */
export const KARES_UNIT = 1_000_000_000n
export const KARES_SUPPLY = 1_000_000_000n * KARES_UNIT
export const KARES_PER_MASTERY_POINT = 1_000n
export const COMMUNITY_VESTING_MS = 1_825n * 86_400_000n
export const KARES_ALLOCATION = Object.freeze({
  rewards: 200_000_000n * KARES_UNIT,
  team: 30_000_000n * KARES_UNIT,
  combat: 100_000_000n * KARES_UNIT,
  community: 110_000_000n * KARES_UNIT,
})
export const COMBAT_DAILY_BUDGET = KARES_ALLOCATION.combat / 1_825n
export const KARES_RESERVE_SUPPLY = KARES_ALLOCATION.rewards + KARES_ALLOCATION.combat + KARES_ALLOCATION.community
export const mastery_kares_price = (points: bigint): bigint => points * KARES_PER_MASTERY_POINT * KARES_UNIT

/** Bound the repeated existing redemption doors to one practical atomic transaction. */
export const MASTERY_PURCHASE_LIMIT = 50
export const mastery_purchase_maximum = (balance: bigint, points: bigint): number => {
  if (balance <= 0n || points <= 0n) return 0
  const affordable = balance / mastery_kares_price(points)
  return Number(affordable < BigInt(MASTERY_PURCHASE_LIMIT) ? affordable : BigInt(MASTERY_PURCHASE_LIMIT))
}

export const valid_mastery_purchase_quantity = (count: number, maximum = MASTERY_PURCHASE_LIMIT): boolean =>
  Number.isInteger(count) && count >= 1 && count <= maximum
