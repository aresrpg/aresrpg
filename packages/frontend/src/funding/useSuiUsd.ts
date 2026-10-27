// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer } from 'react'

import { decode_assets, NATIVE_SUI_ASSET } from './near.ts'

export const read_sui_usd = async (signal: Readonly<AbortSignal>, send = fetch): Promise<number> => {
  const response = await send('https://1click.chaindefuser.com/v0/tokens', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('SUI price is unavailable')
  const price = decode_assets(await response.json()).find((asset) => asset.asset_id === NATIVE_SUI_ASSET)?.price
  if (!price) throw new Error('SUI price is unavailable')
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
