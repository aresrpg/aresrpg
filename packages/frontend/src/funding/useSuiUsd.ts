// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer } from 'react'

import { FUNDING_SUI_CHAIN, FUNDING_SUI_TOKEN } from './chains.ts'

export const read_sui_usd = async (signal: Readonly<AbortSignal>, send = fetch): Promise<number> => {
  const query = new URLSearchParams({ chain: String(FUNDING_SUI_CHAIN), token: FUNDING_SUI_TOKEN })
  const response = await send(`https://li.quest/v1/token?${query}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('SUI price is unavailable')
  const token: unknown = await response.json()
  if (!token || typeof token !== 'object') throw new Error('Invalid SUI price response')
  const { chainId: chain_id, address, priceUSD: price_usd } = token as Readonly<Record<string, unknown>>
  if (chain_id !== FUNDING_SUI_CHAIN || address !== FUNDING_SUI_TOKEN || typeof price_usd !== 'string')
    throw new Error('Invalid SUI price response')
  const price = Number(price_usd)
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid SUI price')
  return price
}

/** An optional display quote; never used to authorize a payment or enable creation. */
export const useSuiUsd = (enabled: boolean): number | null => {
  const [price, received] = useReducer((_previous: number | null, next: number | null) => next, null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const refresh = (): void => {
      void read_sui_usd(controller.signal)
        .then((price) => {
          if (!controller.signal.aborted) received(price)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          console.warn('SUI price estimate unavailable.', error)
          received(null)
        })
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [enabled])
  return enabled ? price : null
}
