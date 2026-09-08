// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer } from 'react'
import { finance_label, parse_amount, type KaresCopy } from '@aresrpg/frontend/finance'

export const read_usd_quote = (value: unknown): bigint => {
  const data = (value as { data?: { base?: unknown; currency?: unknown; amount?: unknown } } | null)?.data
  const amount = typeof data?.amount === 'string' ? parse_amount(data.amount) : null
  if (data?.base !== 'SUI' || data.currency !== 'USD' || amount === null)
    throw new Error('Invalid Coinbase SUI/USD quote')
  return amount
}

export const usd_market_cap = (mist: bigint, quote: bigint): string => {
  // Both inputs have nine decimal places; round the display to cents using integers.
  const cents = (mist * quote + 5_000_000_000_000_000n) / 10_000_000_000_000_000n
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}

export const LaunchMarketCap = ({ amount, copy }: Readonly<{ amount: bigint | null; copy: KaresCopy }>) => {
  const [quote, receive_quote] = useReducer((_: bigint | null, value: bigint | null) => value, null)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch('https://api.coinbase.com/v2/prices/SUI-USD/spot', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        })
        if (!response.ok) throw new Error(`SUI/USD quote failed: ${response.status}`)
        const updated = read_usd_quote(await response.json())
        if (!controller.signal.aborted) receive_quote(updated)
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('SUI/USD quote unavailable.', error)
        receive_quote(null)
      }
    }
    void refresh()
    const timer = globalThis.setInterval(() => void refresh(), 60_000)
    return () => {
      controller.abort()
      globalThis.clearInterval(timer)
    }
  }, [])
  return (
    <div data-launch-market-cap="" title={`${copy.launch_market_cap_note} · Coinbase SUI/USD`}>
      <p className={finance_label}>{copy.launch_market_cap} · USD</p>
      <p className="mt-2 text-xl font-medium text-gold-light tabular-nums">
        {amount === null || quote === null ? '—' : usd_market_cap(amount, quote)}
      </p>
    </div>
  )
}
