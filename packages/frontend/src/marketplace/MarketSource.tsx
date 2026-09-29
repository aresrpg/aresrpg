// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext, useContext } from 'react'

import type { MarketplaceInput, MarketplaceState } from '../modules/marketplace.ts'
import type { SessionState } from '../modules/session.ts'
import type { ItemCraftSession } from '../components/ItemCrafting.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

type MarketAccount = Pick<SessionState, 'inventory' | 'characters' | 'sui_balance_mist'> &
  Readonly<{ wallet: Pick<NonNullable<SessionState['wallet']>, 'address'> | null }>
export type MarketSource = Readonly<{
  market: MarketplaceState
  account: MarketAccount
  dispatch: (input: MarketplaceInput) => void
  craft_session: ItemCraftSession
}>
/** The real controllers run unchanged against either their live domain or an isolated preview. */
export const MarketSourceContext = createContext<MarketSource | null>(null)
export const useMarketState = () => {
  const source = useContext(MarketSourceContext)
  const live = useAppStore((state) => state.marketplace)
  return source?.market ?? live
}
export const useMarketAccount = (): MarketAccount => {
  const source = useContext(MarketSourceContext)
  const live = useAppStore((state) => state.session)
  return source?.account ?? live
}
export const useMarketDispatch = () => useContext(MarketSourceContext)?.dispatch ?? dispatch_app
export const useMarketCraftSession = () => useContext(MarketSourceContext)?.craft_session
export const useMarketTradeRows = () => {
  const source = useContext(MarketSourceContext)
  const rows = useAppStore((state) => state.trade.rows)
  return source ? [] : rows
}
