// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const clamp_scalar = (value: number): number => Math.max(0, Math.min(100, value))

export const mob_level_from_scalar = (level_min: number, level_max: number, scalar: number): number =>
  level_min + Math.floor(((level_max - level_min) * clamp_scalar(scalar)) / 100)

export const mob_scalar_from_level = (level_min: number, level_max: number, level: number): number => {
  const span = level_max - level_min
  if (span <= 0) return 50
  return clamp_scalar(((Math.max(level_min, Math.min(level_max, level)) - level_min) * 100) / span)
}
