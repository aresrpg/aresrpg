// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Integer loot basis points; mirrors move-math/fight_math.move. */
export const mob_loot_chance_scaled = (base_bp: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base_bp
  const span = high - low
  const scaled = (base_bp * (8n * span + 4n * (level - low))) / (10n * span)
  return scaled > 10_000n ? 10_000n : scaled
}
