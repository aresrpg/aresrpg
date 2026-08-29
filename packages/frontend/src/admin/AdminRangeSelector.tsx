// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminRangeDays } from '@aresrpg/protocol'

import { category_pill } from '../encyclopedia/components.tsx'

export const ADMIN_RANGES: readonly AdminRangeDays[] = Object.freeze([1, 7, 30, 90, 365])

export const admin_range_label = (copy: Readonly<Record<string, string>>, days: AdminRangeDays): string => {
  if (days === 1) return copy.range_24h || '24H'
  if (days === 365) return copy.range_1y || '1Y'
  return copy[`range_${days}d`] || `${days}D`
}

export const AdminRangeSelector = ({
  copy,
  days,
  ranges = ADMIN_RANGES,
  change,
}: Readonly<{
  copy: Readonly<Record<string, string>>
  days: AdminRangeDays
  ranges?: readonly AdminRangeDays[]
  change: (days: AdminRangeDays) => void
}>) => (
  <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
    {ranges.map((range) => (
      <button className={category_pill(days === range)} key={range} onClick={() => change(range)} type="button">
        {admin_range_label(copy, range)}
      </button>
    ))}
  </div>
)
