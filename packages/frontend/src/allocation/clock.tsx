// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import type { BlastSnapshot } from '@aresrpg/sdk/blast'

import type { CopyText } from '../i18n/copy.ts'

/** Minute-resolution clock for sale countdowns; chain lifecycle remains the phase authority. */
export const useMinuteClock = (): number => {
  const [now, set_now] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export const countdown_text = (ms: number, text: CopyText): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return text('sale_countdown', {
    days: Math.floor(minutes / 1440),
    hours: Math.floor(minutes / 60) % 24,
    minutes: minutes % 60,
  })
}

/** While the sale is open: when any wallet may buy without a spot, if the sale has such a phase. */
export const public_line = (sale: BlastSnapshot, now: number, text: CopyText): string | null => {
  if (sale.phase !== 'live' || sale.public_ms === undefined || sale.public_ms === null) return null
  const left = Number(sale.public_ms) - now
  return left > 0 ? text('sale_public_in', { time: countdown_text(left, text) }) : text('sale_public_now')
}
