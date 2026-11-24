// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppState } from '../store.ts'
import { useAppStore } from '../store.ts'
import { selected_character } from '../modules/session.ts'
export type TradeData = Readonly<{
  rows: AppState['trade']['rows']
  pending_operation: AppState['trade']['pending']
  inventory: AppState['session']['inventory']
  balance: AppState['session']['sui_balance_mist']
  listings: AppState['marketplace']['own_listings']
  own_name: string | null
  players: readonly Readonly<{ owner: string; name: string }>[]
}>
export const useTradeInventory = () => useAppStore((state) => state.session.inventory)
export const useTradeData = (): TradeData => {
  const rows = useAppStore((state) => state.trade.rows)
  const pending_operation = useAppStore((state) => state.trade.pending)
  const inventory = useAppStore((state) => state.session.inventory)
  const balance = useAppStore((state) => state.session.sui_balance_mist)
  const listings = useAppStore((state) => state.marketplace.own_listings)
  const own_name = useAppStore((state) => selected_character(state.session)?.name ?? null)
  const players = useAppStore((state) => state.world.all_players)
  return { rows, pending_operation, inventory, balance, listings, own_name, players: Object.values(players) }
}
