// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useReducer } from 'react'
import type { TradeRow, ItemRow } from '@aresrpg/protocol'
import { Handshake } from 'lucide-react'

import { TradeDialog } from '../../components/TradeDialog.tsx'
import { TradeSourceContext } from '../../components/TradeSource.tsx'
import type { TradeInput } from '../../modules/trade.ts'
import { adventure_inventory } from '../../adventure/projection.ts'
import { content_catalog } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
const PEER_ITEMS: readonly ItemRow[] = adventure_inventory(
  content_catalog.items.filter((item) => item.category === 'ring').slice(0, 2)
).map((item, index) => ({ ...item, id: `peer-${index}`, kiosk: 'peer-kiosk' }))
const initial_trade = (): TradeRow => ({
  id: 'preview-trade',
  a: 'preview-own',
  b: 'preview-rin',
  phase: 'negotiating',
  offer_revision: 1,
  accept_a: false,
  accept_b: false,
  sui_a: '0',
  sui_b: '1500000000',
  kares_a: '0',
  kares_b: '40000000000',
  caps_a: [],
  caps_b: PEER_ITEMS.map((item) => ({
    object: item.id,
    name: item.name,
    level: item.level,
    amount: item.amount,
    item_type: item.item_type,
    category: item.category,
    kiosk: item.kiosk,
  })),
})
const preview_trade = (state: Readonly<TradeRow>, input: TradeInput): TradeRow => {
  switch (input.type) {
    case 'trade/commit_offer': {
      const removed = new Set(input.removals.map(({ cap }) => cap.object))
      return {
        ...state,
        offer_revision: state.offer_revision + 1,
        accept_a: false,
        accept_b: false,
        sui_a: String(input.sui),
        kares_a: String(input.kares),
        caps_a: [
          ...state.caps_a.filter((cap) => !removed.has(cap.object)),
          ...input.additions.map(({ item, amount }) => ({
            object: item.id,
            name: item.name,
            item_type: item.item_type,
            category: item.category,
            level: item.level,
            kiosk: item.kiosk,
            amount,
          })),
        ],
      }
    }
    case 'trade/accept':
      return { ...state, accept_a: true }
    case 'trade/cancel':
      return { ...state, phase: 'cancelled' }
    default:
      return state
  }
}
export const TradeExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [trade, dispatch] = useReducer(preview_trade, undefined, initial_trade)
  const inventory = useMemo(
    () =>
      adventure_inventory(
        ['hat', 'ring', 'consumable', 'resource'].flatMap((category) =>
          content_catalog.items.filter((item) => item.category === category).slice(0, 6)
        )
      ),
    []
  )
  return (
    <WorkshopSurface copy={copy} title={copy.trade_panel.title} icon={<Handshake />}>
      {(header) => (
        <TradeSourceContext.Provider
          value={{
            data: {
              rows: [trade],
              pending_operation: null,
              inventory: [...inventory, ...PEER_ITEMS],
              balance: 12420000000n,
              listings: [],
              own_name: 'Senshi',
              players: [{ owner: 'preview-rin', name: 'Rin' }],
            },
            dispatch: (input) => {
              if (input.type === 'trade/open' && input.trade === null) header.close()
              else dispatch(input)
            },
          }}
        >
          <TradeDialog copy={copy} active={trade} address="preview-own" />
        </TradeSourceContext.Provider>
      )}
    </WorkshopSurface>
  )
}
