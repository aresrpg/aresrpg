// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { stat_names } from '@aresrpg/immutable'
import type { ItemSnapshot } from '@aresrpg/sdk/auth'
import type { ItemRow } from '@aresrpg/protocol'
import { Loader2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { item_stat_offset } from '../game/character_stats.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { ItemDetailContext } from './ItemDetailContext.ts'
import { ItemDetailView } from './ItemDetailView.tsx'
import './item_snapshot_tooltip.css'

type ItemTooltipDetails = ItemSnapshot & Pick<ItemRow, 'damages'>

export type ItemSnapshotHover = Readonly<{
  anchor: Readonly<HTMLElement>
  status: 'loading' | 'ready' | 'error'
  item: ItemTooltipDetails | null
}>

export const item_snapshot_detail = (item: Readonly<ItemTooltipDetails>) => {
  const rolled = item.stats
    ? Object.fromEntries(
        stat_names.map((stat) => [stat, item_stat_offset(item, stat)]).filter(([, value]) => value !== 0)
      )
    : null
  return Object.freeze({
    ...item,
    stats: rolled ? Object.freeze({ min: rolled, max: rolled }) : undefined,
  })
}

export const ItemSnapshotContent = ({
  copy,
  status,
  item,
}: Readonly<{ copy: AppCopy; status: ItemSnapshotHover['status']; item: ItemTooltipDetails | null }>) => {
  if (status === 'loading')
    return (
      <span className="item-snapshot-tooltip__loading">
        <Loader2 className="animate-spin" size={13} />
        {copy.fight_hud.chat_fetching_item}
      </span>
    )
  if (status === 'error' || !item)
    return <span className="item-snapshot-tooltip__loading">{copy.fight_hud.chat_item_unavailable}</span>
  const detail = item_snapshot_detail(item)
  const encyclopedia = encyclopedia_text(copy)
  return (
    <ItemDetailView
      category={detail.category}
      damages={detail.damages ?? []}
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

/** Indexed rows stay live while hovered; only the DOM anchor is retained locally. */
export const useItemDetailHover = (item: Readonly<ItemTooltipDetails>) => {
  const [anchor, set_anchor] = useState<Readonly<HTMLElement> | null>(null)
  const hover: ItemSnapshotHover | null = anchor
    ? {
        anchor,
        status: 'ready',
        item,
      }
    : null
  return { open: set_anchor, close: () => set_anchor(null), hover }
}

export const useItemSnapshotHover = (item_id: string) => {
  const wallet = useAppStore((state) => state.session.wallet)
  const [hover, set_hover] = useState<ItemSnapshotHover | null>(null)
  const generation_ref = useRef(0)
  const open = (element: Readonly<HTMLElement>): void => {
    const generation = generation_ref.current + 1
    // eslint-disable-next-line functional/immutable-data -- React ref guards stale async hover completion.
    generation_ref.current = generation
    set_hover(Object.freeze({ anchor: element, status: 'loading', item: null }))
    if (!wallet) return set_hover(Object.freeze({ anchor: element, status: 'error', item: null }))
    void wallet.read_item(item_id).then(
      (item) => {
        if (generation_ref.current === generation) set_hover(Object.freeze({ anchor: element, status: 'ready', item }))
      },
      () => {
        if (generation_ref.current === generation)
          set_hover(Object.freeze({ anchor: element, status: 'error', item: null }))
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

const ItemTooltipSurface = ({ copy, hover }: Readonly<{ copy: AppCopy; hover: ItemSnapshotHover }>) => {
  const root = useRef<HTMLDivElement>(null)
  const [position, set_position] = useState({ left: 12, top: 12 })
  useLayoutEffect(() => {
    const measure = () => {
      const bounds = hover.anchor.getBoundingClientRect(),
        box = root.current!.getBoundingClientRect()
      const left = bounds.right + box.width + 12 < innerWidth ? bounds.right + 8 : bounds.left - box.width - 8
      const next = {
        left: Math.max(12, Math.min(left, innerWidth - box.width - 12)),
        top: Math.max(12, Math.min(bounds.top, innerHeight - box.height - 12)),
      }
      set_position((current) => (current.left === next.left && current.top === next.top ? current : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root.current!)
    globalThis.addEventListener('scroll', measure, true)
    globalThis.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      globalThis.removeEventListener('scroll', measure, true)
      globalThis.removeEventListener('resize', measure)
    }
  }, [hover.anchor])
  return (
    <div ref={root} className="aui-panel item-snapshot-tooltip" role="tooltip" style={position}>
      <ItemDetailContext.Provider value="summary">
        <ItemSnapshotContent copy={copy} status={hover.status} item={hover.item} />
      </ItemDetailContext.Provider>
    </div>
  )
}

// Native windows own their top layer; keep their tooltips in the same DOM subtree.
export const ItemSnapshotTooltip = ({ copy, hover }: Readonly<{ copy: AppCopy; hover: ItemSnapshotHover | null }>) =>
  hover && typeof document !== 'undefined'
    ? createPortal(
        <ItemTooltipSurface copy={copy} hover={hover} />,
        hover.anchor.closest('dialog, .aui-floating-window') ?? document.body
      )
    : null

/** Local inventory/listing details never enter the SDK snapshot reader. */
export const ItemDetailHover = ({
  item,
  children,
}: Readonly<{ item: Readonly<ItemTooltipDetails>; children: ReactNode }>) => {
  const copy = useAppStore((state) => state.copy)
  const detail = useItemDetailHover(item)
  return (
    <div
      className="contents"
      onMouseEnter={(event) => {
        const anchor = event.currentTarget.firstElementChild
        if (event.buttons === 0 && matchMedia('(hover: hover)').matches && anchor instanceof HTMLElement)
          detail.open(anchor)
      }}
      onMouseLeave={detail.close}
      onPointerDown={detail.close}
      onClickCapture={detail.close}
      onFocus={(event) => {
        if (event.target.matches(':focus-visible')) detail.open(event.target)
      }}
      onBlur={detail.close}
    >
      {children}
      {copy && <ItemSnapshotTooltip copy={copy} hover={detail.hover} />}
    </div>
  )
}
