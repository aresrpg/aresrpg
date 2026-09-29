// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { equipment_comparison } from '../characters/equipment_comparison.ts'
import { useText } from '../i18n/useText.ts'

type Comparison = Readonly<NonNullable<ReturnType<typeof equipment_comparison>>>
type Stats = Readonly<{ min: Readonly<Record<string, number>>; max: Readonly<Record<string, number>> }>

/** Keep a zero-valued candidate row when replacing gear removes a bonus entirely. */
export const comparison_values = (stats: Stats = { min: {}, max: {} }, comparison?: Comparison) => {
  const deltas = Object.fromEntries(comparison?.rows.map(({ stat, delta }) => [stat, delta]) ?? [])
  const missing = Object.fromEntries(Object.keys(deltas).map((stat) => [stat, 0]))
  return { deltas, stats: { min: { ...missing, ...stats.min }, max: { ...missing, ...stats.max } } }
}

export const StatDelta = ({ stat, delta = 0 }: Readonly<{ stat: string; delta?: number }>) =>
  delta === 0 ? null : (
    <strong className="aui-stat-delta" data-equipment-delta={stat} data-gain={delta > 0}>
      {delta > 0 ? '+' : '−'}
      {Math.abs(delta)}
    </strong>
  )

export const ComparisonHeading = ({ comparison }: Readonly<{ comparison?: Comparison }>) => {
  const text = useText()
  if (!comparison) return null
  return (
    <div className="aui-comparison-heading" data-equipment-comparison="">
      <span>{text('ui.equipment_replacing', { name: comparison.previous.name })}</span>
      <strong>{text(comparison.rows.length ? 'ui.equipment_comparison' : 'ui.equipment_unchanged')}</strong>
    </div>
  )
}
