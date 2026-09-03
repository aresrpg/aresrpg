// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import type { TradeCapRow, TradePhase } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'

export type TradeTerminalDelta = Readonly<{
  trade: string
  phase: Extract<TradePhase, 'settling' | 'cancelled'>
  offer_revision: number
  remove_caps: readonly string[]
  clear_sui: 'a' | 'b' | null
  closed: boolean
}>
export type TradeStackTargets = Readonly<Record<string, Readonly<{ id: string; kiosk: string }> | undefined>>
export type SettlementRow = Readonly<{
  cap: TradeCapRow
  target?: Readonly<{ id: string; kiosk: string }>
}>
export type SettlementGroup = Readonly<{ owner: KioskOwnerCap; rows: readonly SettlementRow[] }>

const MAX_ITEM_AMOUNT = 0xffff_ffff

export const coalesced_settlement_rows = (rows: readonly SettlementRow[], kiosk: string): readonly SettlementRow[] => {
  const available = new Map<string, readonly Readonly<{ id: string; amount: number }>[]>()
  return Object.freeze(
    rows.map((row) => {
      if (row.target || !item_is_stackable(row.cap.category)) return row
      const targets = available.get(row.cap.item_type) ?? []
      const target = targets.find(({ amount }) => amount + row.cap.amount <= MAX_ITEM_AMOUNT)
      if (target) {
        available.set(
          row.cap.item_type,
          targets.map((candidate) =>
            candidate.id === target.id
              ? Object.freeze({ ...candidate, amount: candidate.amount + row.cap.amount })
              : candidate
          )
        )
        return Object.freeze({ ...row, target: Object.freeze({ id: target.id, kiosk }) })
      }
      available.set(
        row.cap.item_type,
        Object.freeze([...targets, Object.freeze({ id: row.cap.object, amount: row.cap.amount })])
      )
      return row
    })
  )
}
