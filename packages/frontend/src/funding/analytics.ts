// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import type { Route } from '@lifi/widget'

import { capture_analytics, type AnalyticsCapture } from '../analytics.ts'

import { FUNDING_SUI_CHAIN, FUNDING_SUI_TOKEN } from './chains.ts'

export type FundingMethod = 'direct' | 'bridge' | 'card' | 'faucet'
type BridgeStage = 'started' | 'completed' | 'failed'
type FundingRoute = Readonly<Pick<Route, 'id' | 'toChainId' | 'toToken' | 'toAddress'>>

export const create_funding_observer = (capture: AnalyticsCapture) => {
  let previous: FundingMethod | null = null
  return (method: FundingMethod): void => {
    if (previous === method) return
    if (previous === null) capture('funding_opened')
    previous = method
    capture('funding_method_viewed', { method })
  }
}

export const useFundingAnalytics = (selected: FundingMethod, network: string): void => {
  const method = network === 'testnet' ? 'faucet' : selected
  const [observe] = useState(() => create_funding_observer(capture_analytics))
  useEffect(() => observe(method), [method, observe])
}

const route_states = (
  state: ReadonlyMap<string, BridgeStage>,
  route: FundingRoute,
  stage: BridgeStage
): ReadonlyMap<string, BridgeStage> => {
  const previous = state.get(route.id)
  if (previous === stage || previous === 'completed') return state
  const next = new Map(state)
  next.set(route.id, stage)
  return next
}

/** Route identities only deduplicate local observations; addresses and transaction data never leave this boundary. */
export const create_bridge_observer = (address: string, capture: AnalyticsCapture) => {
  let state: ReadonlyMap<string, BridgeStage> = new Map()
  return (route: FundingRoute, stage: BridgeStage): boolean => {
    if (
      route.toChainId !== FUNDING_SUI_CHAIN ||
      route.toToken.address !== FUNDING_SUI_TOKEN ||
      route.toAddress?.toLowerCase() !== address.toLowerCase()
    )
      return false
    const next = route_states(state, route, stage)
    if (next === state) return false
    state = next
    capture(`funding_bridge_${stage}`, { method: 'bridge' })
    return true
  }
}
