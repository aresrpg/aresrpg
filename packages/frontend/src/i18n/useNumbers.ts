// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo } from 'react'

import { format_amount } from '../kares/model.ts'
import { format_sui } from '../wallet_amount.ts'

import { useLocale } from './LocaleScope.tsx'

export const useNumbers = () => {
  const locale = useLocale()
  return useMemo(
    () => ({
      number: (value: number | bigint): string => value.toLocaleString(locale),
      compact: (value: number): string =>
        new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value),
      daily: (value: bigint): string => format_sui(value, 3, locale),
      amount: (value: bigint, decimals = 4): string => format_amount(value, decimals, locale),
      sui: (value: bigint, decimals = 2): string => format_sui(value, decimals, locale),
      decimal: (value: number, decimals = 2, minimum_decimals = 0): string =>
        value.toLocaleString(locale, { maximumFractionDigits: decimals, minimumFractionDigits: minimum_decimals }),
    }),
    [locale]
  )
}
