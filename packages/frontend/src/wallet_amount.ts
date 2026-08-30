// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const MIST_PER_SUI = 1_000_000_000n

export const parse_sui_amount = (input: string): bigint | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(input.trim())
  if (!match) return null
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] ?? '').padEnd(9, '0') || '0')
  const mist = whole * MIST_PER_SUI + fraction
  return mist > 0n ? mist : null
}

export const format_sui = (mist: bigint, fraction_digits = 2): string => {
  const digits = Math.max(0, Math.min(9, fraction_digits))
  const negative = mist < 0n
  const absolute = negative ? -mist : mist
  const whole = absolute / MIST_PER_SUI
  if (digits === 0) return `${negative ? '-' : ''}${whole}`
  const fraction = (absolute % MIST_PER_SUI).toString().padStart(9, '0').slice(0, digits)
  return `${negative ? '-' : ''}${whole}.${fraction}`
}
