// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A mob's level band scales its template. Integer mirrors of move-math/fight_math.move.

export const mob_band_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base
  const span = high - low
  return (base * (6n * span + 10n * (level - low))) / (10n * span)
}

export const mob_effect_value_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  const scaled = mob_band_scaled(base, low, high, level)
  return base > 0n && scaled === 0n ? 1n : scaled
}

export const mob_centered_band_scaled = (
  value: bigint,
  center: bigint,
  low: bigint,
  high: bigint,
  level: bigint
): bigint => {
  if (value >= center) return center + mob_band_scaled(value - center, low, high, level)
  if (high === low) return value
  const span = high - low
  const scaled = ((center - value) * (16n * span - 10n * (level - low))) / (10n * span)
  return scaled >= center ? 0n : center - scaled
}

export const mob_loot_chance_scaled = (base_bp: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base_bp
  const span = high - low
  const scaled = (base_bp * (8n * span + 4n * (level - low))) / (10n * span)
  return scaled > 10_000n ? 10_000n : scaled
}

export const mob_pool_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base
  const span = high - low
  const denominator = 10n * span
  const numerator = base * (10n * span + 3n * (level - low))
  return (numerator + denominator / 2n) / denominator
}
