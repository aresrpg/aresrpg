// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** Mean normalized variable-stat roll; exact rational comparison keeps exactly 90% excluded. */
export const roll_quality = (
  ranges: Readonly<{
    min: Readonly<Record<string, number | undefined>>
    max: Readonly<Record<string, number | undefined>>
  }>,
  stats: Readonly<Record<string, number>>
): Readonly<{ basis_points: number; exceptional: boolean }> | null => {
  const rows = Object.entries(ranges.max).flatMap(([key, maximum]) => {
    const minimum = ranges.min[key] ?? 0
    const value = stats[key]
    if (maximum === undefined || maximum <= minimum) return []
    if (![minimum, maximum, value].every(Number.isSafeInteger)) throw new Error('Invalid item roll')
    return [
      { width: BigInt(maximum - minimum), value: BigInt(Math.max(0, Math.min(maximum - minimum, value! - minimum))) },
    ]
  })
  if (!rows.length) return null
  const sum = rows.reduce(
    ({ numerator, denominator }, row) => ({
      numerator: numerator * row.width + row.value * denominator,
      denominator: denominator * row.width,
    }),
    { numerator: 0n, denominator: 1n }
  )
  const divisor = sum.denominator * BigInt(rows.length)
  return { basis_points: Number((sum.numerator * 10_000n) / divisor), exceptional: sum.numerator * 10n > divisor * 9n }
}
