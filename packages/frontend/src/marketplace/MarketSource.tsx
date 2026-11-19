// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext, useContext } from 'react'
import type { TradeRow } from '@aresrpg/protocol'

import type { MarketplaceInput, MarketplaceState } from '../modules/marketplace.ts'
import type { SessionState } from '../modules/session.ts'
import type { ItemCraftSession } from '../components/ItemCrafting.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

type MarketAccount = Pick<SessionState, 'inventory' | 'characters' | 'sui_balance_mist'> &
  Readonly<{ wallet: Pick<NonNullable<SessionState['wallet']>, 'address'> | null }>
/** What an account can do on the market. The player's own wallet does all of it. */
export type MarketCapabilities = Readonly<{ characters: boolean; withdraw: boolean; history: boolean }>
const EVERYTHING: MarketCapabilities = Object.freeze({ characters: true, withdraw: true, history: true })
export type MarketSource = Readonly<{
  market: MarketplaceState
  account: MarketAccount
  dispatch: (input: MarketplaceInput) => void
  craft_session?: ItemCraftSession
  /** Trades that lock some of the account's items; a source without any locks nothing. */
  trades?: readonly TradeRow[]
  capabilities?: MarketCapabilities
}>
/** The real controllers run unchanged against their live domain, an isolated preview, or another
 * account: the source says whose bag, balance and listings these are and how that account trades. */
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
const NO_TRADES: readonly TradeRow[] = Object.freeze([])
export const useMarketTradeRows = () => {
  const source = useContext(MarketSourceContext)
  const rows = useAppStore((state) => state.trade.rows)
  return source ? (source.trades ?? NO_TRADES) : rows
}
export const useMarketCapabilities = () => useContext(MarketSourceContext)?.capabilities ?? EVERYTHING
