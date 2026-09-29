// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { TradeCapRow, TradeRow } from '@aresrpg/protocol'
import { X } from 'lucide-react'
import { useState, type MouseEventHandler, type ReactNode } from 'react'
import { NativeModal, GameWindow } from '@aresrpg/ui'

import { item_icon } from '../content/assets.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'

import { useTradeInventory, useTradeDispatch } from './TradeSource.tsx'
import { OwnedItemDetail } from './OwnedItemDetail.tsx'
import { ItemSnapshotTooltip, useItemSnapshotHover, ItemSnapshotContent } from './ItemSnapshotTooltip.tsx'
import { trade_cap_action } from './trade_view.ts'

type TradeCapCellProps = Readonly<{ cap: TradeCapRow; remove?: () => void; remove_label: string }>

const TradeCapCellView = ({
  cap,
  detail,
  mouse_enter,
  mouse_leave,
  remove,
  remove_label,
  inspect,
}: TradeCapCellProps &
  Readonly<{
    inspect?: (element: Readonly<HTMLElement>) => void
    detail?: ReactNode
    mouse_enter?: MouseEventHandler<HTMLDivElement>
    mouse_leave?: MouseEventHandler<HTMLDivElement>
  }>) => (
  <div className="trade-cap" onMouseEnter={mouse_enter} onMouseLeave={mouse_leave} title={cap.name}>
    <button
      className="trade-cap-inspect"
      type="button"
      aria-label={cap.name}
      onClick={(event) => inspect?.(event.currentTarget)}
    >
      {item_icon(cap.item_type) ? (
        <img alt="" draggable={false} src={item_icon(cap.item_type)!} />
      ) : (
        <span>{cap.name.slice(0, 1).toUpperCase()}</span>
      )}
    </button>
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
  const [open, set_open] = useState(false)
  const item_hover = useItemSnapshotHover(props.cap.object)
  const close = () => {
    set_open(false)
    item_hover.close()
  }
  return (
    <>
      <TradeCapCellView
        {...props}
        inspect={(element) => {
          item_hover.open(element)
          set_open(true)
        }}
        mouse_enter={(event) => item_hover.open(event.currentTarget)}
        mouse_leave={() => {
          if (!open) item_hover.close()
        }}
        detail={open ? null : <ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />}
      />
      {open && (
        <NativeModal label={props.cap.name} close={close} className="aui-modal-scrim">
          <GameWindow
            title={props.cap.name}
            close={close}
            close_label={copy.wallet_close}
            draggable
            className="aui-inspection aui-inspection--item"
          >
            <ItemSnapshotContent
              copy={copy}
              status={item_hover.hover?.status ?? 'loading'}
              item={item_hover.hover?.item ?? null}
            />
          </GameWindow>
        </NativeModal>
      )}
    </>
  )
}
const TradeCapCell = ({ copy, own, ...props }: TradeCapCellProps & Readonly<{ copy?: AppCopy; own: boolean }>) => {
  const [open, set_open] = useState(false)
  const item = useTradeInventory().find((row) => row.id === props.cap.object)
  if (!item && copy && !own) return <SnapshotTradeCapCell {...props} copy={copy} />
  return (
    <>
      <TradeCapCellView {...props} inspect={() => set_open(true)} />
      {open && copy && (
        <NativeModal label={props.cap.name} close={() => set_open(false)} className="aui-modal-scrim">
          <GameWindow
            title={props.cap.name}
            close={() => set_open(false)}
            close_label={copy.wallet_close}
            draggable
            className="aui-inspection aui-inspection--item"
          >
            <OwnedItemDetail
              item={
                item ?? {
                  id: props.cap.object,
                  name: props.cap.name,
                  item_type: props.cap.item_type,
                  category: props.cap.category,
                  level: props.cap.level,
                  amount: props.cap.amount,
                }
              }
              copy={copy}
            />
          </GameWindow>
        </NativeModal>
      )}
    </>
  )
}

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
  const dispatch_app = useTradeDispatch()
  const removable = trade_cap_action({ phase: trade.phase, own }) === 'withdraw' && !pending
  return (
    <div className="trade-offer-grid">
      {caps.map((cap) => (
        <TradeCapCell
          cap={cap}
          own={own}
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
