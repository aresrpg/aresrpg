// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_stat_center } from '@aresrpg/immutable'
import type { ItemSnapshot } from '@aresrpg/sdk/auth'
import { Loader2 } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { ItemDetailView } from './ItemDetailView.tsx'
import './item_snapshot_tooltip.css'

export type ItemSnapshotHover = Readonly<{
  style: CSSProperties
  status: 'loading' | 'ready' | 'error'
  item: ItemSnapshot | null
}>

const item_snapshot_detail = (item: Readonly<ItemSnapshot>) => {
  const rolled = item.stats
    ? Object.fromEntries(
        Object.entries(item.stats)
          .map(([stat, value]) => [stat, value - item_stat_center])
          .filter(([, value]) => value !== 0)
      )
    : null
  return Object.freeze({
    ...item,
    stats: rolled ? Object.freeze({ min: rolled, max: rolled }) : undefined,
  })
}

const ItemSnapshotContent = ({ copy, hover }: Readonly<{ copy: AppCopy; hover: ItemSnapshotHover }>) => {
  if (hover.status === 'loading')
    return (
      <span className="item-snapshot-tooltip__loading">
        <Loader2 className="animate-spin" size={13} />
        {copy.fight_hud.chat_fetching_item}
      </span>
    )
  if (hover.status === 'error' || !hover.item)
    return <span className="item-snapshot-tooltip__loading">{copy.fight_hud.chat_item_unavailable}</span>
  const detail = item_snapshot_detail(hover.item)
  const encyclopedia = encyclopedia_text(copy)
  return (
    <ItemDetailView
      category={detail.category}
      damages={Object.freeze([])}
      item_type={detail.item_type}
      labels={{
        characteristics: encyclopedia('characteristics'),
        damages: encyclopedia('damages'),
        level_short: encyclopedia('level_short', { level: detail.level }),
        range_to: encyclopedia('range_to'),
      }}
      level={detail.level}
      name={detail.name}
      stats={detail.stats}
    />
  )
}

export const useItemSnapshotHover = (item_id: string) => {
  const wallet = useAppStore((state) => state.session.wallet)
  const [hover, set_hover] = useState<ItemSnapshotHover | null>(null)
  const generation_ref = useRef(0)
  const open = (element: Readonly<HTMLElement>): void => {
    const generation = generation_ref.current + 1
    // eslint-disable-next-line functional/immutable-data -- React ref guards stale async hover completion.
    generation_ref.current = generation
    const bounds = element.getBoundingClientRect()
    const style = Object.freeze({ left: bounds.left + bounds.width / 2, top: bounds.top - 8 })
    set_hover(Object.freeze({ style, status: 'loading', item: null }))
    if (!wallet) return set_hover(Object.freeze({ style, status: 'error', item: null }))
    void wallet.read_item(item_id).then(
      (item) => {
        if (generation_ref.current === generation) set_hover(Object.freeze({ style, status: 'ready', item }))
      },
      () => {
        if (generation_ref.current === generation) set_hover(Object.freeze({ style, status: 'error', item: null }))
      }
    )
  }
  const close = (): void => {
    // eslint-disable-next-line functional/immutable-data -- leaving invalidates the in-flight hover generation.
    generation_ref.current += 1
    set_hover(null)
  }
  return Object.freeze({ close, hover, open })
}

export const ItemSnapshotTooltip = ({ copy, hover }: Readonly<{ copy: AppCopy; hover: ItemSnapshotHover | null }>) =>
  hover && typeof document !== 'undefined'
    ? createPortal(
        <div className="item-snapshot-tooltip" style={hover.style}>
          <ItemSnapshotContent copy={copy} hover={hover} />
        </div>,
        document.body
      )
    : null
