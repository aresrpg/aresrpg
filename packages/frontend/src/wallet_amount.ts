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

export const format_sui = (mist: bigint, fraction_digits = 2, locale?: string): string => {
  const digits = Math.max(0, Math.min(9, fraction_digits))
  const negative = mist < 0n
  const absolute = negative ? -mist : mist
  const whole = locale ? (absolute / MIST_PER_SUI).toLocaleString(locale) : String(absolute / MIST_PER_SUI)
  if (digits === 0) return `${negative ? '-' : ''}${whole}`
  const fraction = (absolute % MIST_PER_SUI).toString().padStart(9, '0').slice(0, digits)
  const separator = locale
    ? new Intl.NumberFormat(locale).formatToParts(1.1).find(({ type }) => type === 'decimal')!.value
    : '.'
  return `${negative ? '-' : ''}${whole}${separator}${fraction}`
}

/** Display-only token amount truncated to six significant digits; wallets confirm the exact value. */
export const format_token = (amount: bigint, decimals: number): string => {
  const base = 10n ** BigInt(decimals)
  const whole = (amount / base).toString()
  const fraction = (amount % base).toString().padStart(decimals, '0')
  const digits = whole === '0' ? Math.max(fraction.search(/[1-9]/), 0) + 6 : Math.max(0, 6 - whole.length)
  const shown = fraction.slice(0, digits).replace(/0+$/, '')
  return shown ? `${whole}.${shown}` : whole
}

/** Informational USD estimate; never a payment amount or an affordability gate. */
export const format_token_usd = (amount: bigint, decimals: number, price: number | null, locale: string): string =>
  price === null
    ? '— USD'
    : `≈${new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format((Number(amount) / 10 ** decimals) * price)}`
