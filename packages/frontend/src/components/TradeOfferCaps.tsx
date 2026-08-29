// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { TradeCapRow, TradeRow } from '@aresrpg/protocol'
import { X } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'

import { item_icon } from '../content/assets.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { dispatch_app } from '../store.ts'

import { ItemSnapshotTooltip, useItemSnapshotHover } from './ItemSnapshotTooltip.tsx'
import { trade_cap_action } from './trade_view.ts'

type TradeCapCellProps = Readonly<{ cap: TradeCapRow; remove?: () => void; remove_label: string }>

const TradeCapCellView = ({
  cap,
  detail,
  mouse_enter,
  mouse_leave,
  remove,
  remove_label,
}: TradeCapCellProps &
  Readonly<{
    detail?: ReactNode
    mouse_enter?: MouseEventHandler<HTMLDivElement>
    mouse_leave?: MouseEventHandler<HTMLDivElement>
  }>) => (
  <div className="trade-cap" onMouseEnter={mouse_enter} onMouseLeave={mouse_leave} title={cap.name}>
    {item_icon(cap.item_type) ? (
      <img alt="" draggable={false} src={item_icon(cap.item_type)!} />
    ) : (
      <span>{cap.name.slice(0, 1).toUpperCase()}</span>
    )}
    <span>{cap.name}</span>
    {cap.amount > 1 && <small>×{cap.amount}</small>}
    {remove && (
      <button aria-label={remove_label} onClick={remove} type="button">
        <X size={11} />
      </button>
    )}
    {detail}
  </div>
)

const SnapshotTradeCapCell = ({ copy, ...props }: TradeCapCellProps & Readonly<{ copy: AppCopy }>) => {
  const item_hover = useItemSnapshotHover(props.cap.object)
  return (
    <TradeCapCellView
      {...props}
      detail={<ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />}
      mouse_enter={(event) => item_hover.open(event.currentTarget)}
      mouse_leave={item_hover.close}
    />
  )
}

const TradeCapCell = ({ copy, ...props }: TradeCapCellProps & Readonly<{ copy?: AppCopy }>) =>
  copy ? <SnapshotTradeCapCell {...props} copy={copy} /> : <TradeCapCellView {...props} />

export const OfferCaps = ({
  caps,
  copy,
  own,
  pending,
  trade,
  text,
  remove_cap,
}: Readonly<{
  caps: readonly TradeCapRow[]
  copy?: AppCopy
  own: boolean
  pending: boolean
  trade: TradeRow
  text: CopyText
  remove_cap?: (cap: Readonly<TradeCapRow>) => void
}>) => {
  const removable = trade_cap_action({ phase: trade.phase, own }) === 'withdraw' && !pending
  return (
    <div className="trade-offer-grid">
      {caps.map((cap) => (
        <TradeCapCell
          cap={cap}
          copy={copy}
          key={cap.object}
          remove={
            removable
              ? () =>
                  remove_cap ? remove_cap(cap) : dispatch_app({ type: 'trade/withdraw_cap', trade: trade.id, cap })
              : undefined
          }
          remove_label={text('remove_item')}
        />
      ))}
      {caps.length === 0 && <p>{own ? text('drop_items') : text('empty_offer')}</p>}
    </div>
  )
}
