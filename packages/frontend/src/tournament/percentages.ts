// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { basis_points } from '@aresrpg/immutable'

export const parse_percentage = (input: string): number | null => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/^\./, '0.'))
  if (!match) return null
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return bps <= basis_points ? bps : null
}

export const prize_percentage_balance = (values: readonly string[]): number | null => {
  const bps = values.map(parse_percentage)
  return bps.length === 5 && bps.every((value) => value !== null)
    ? basis_points - bps.reduce((sum, value) => sum + value, 0)
    : null
}

export const parse_prize_percentages = (values: readonly string[]): readonly number[] | null => {
  const bps = values.map(parse_percentage)
  return bps.length === 5 &&
    bps.every((value) => value !== null) &&
    bps.reduce((sum, value) => sum + value, 0) === basis_points
    ? bps
    : null
}
