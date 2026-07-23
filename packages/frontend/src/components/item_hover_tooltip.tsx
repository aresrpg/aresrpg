// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { safe_json_parse } from '../safe_json_parse'
import { use_template_t } from '../i18n/template_t'
import { use_content } from '../pages/encyclopedia/content'
import { type ItemInfo } from '../types/chain'
import { display_rolled_stats, has_authored_stats, resolve_rolled_stats } from '../chain/rolled_stats.js'

import { ItemDetailView } from './entity_display'
import { marketplace_item_icon } from './marketplace/marketplace_icon'

// Builds the shape ItemDetailView expects from an ItemInfo + its template.
export function to_detail_item(
  item: ItemInfo,
  tmpl: any,
  tt: ReturnType<typeof use_template_t>,
  rolled_stats: Record<string, number> | null = null
) {
  const stats = display_rolled_stats(rolled_stats)
  const authored_stats =
    tmpl?.stats ?? safe_json_parse<Record<string, number | [number, number]>>(tmpl?.statsJson ?? item.stats_json, {})
  const damages = safe_json_parse(item.damages_json, []) || []
  const consumable = safe_json_parse(item.consumable_json, null)
  const particle = safe_json_parse(item.particle_trail_json, null)
  const name = tmpl ? tt(tmpl, 'name') || item.name || item.template_id : item.name || item.template_id
  const description = tmpl ? tt(tmpl, 'description') || item.description || '' : item.description || ''
  // Resolve the icon through the ONE marketplace home (cosmetic-aware): the on-chain template id is a 0x
  // object id ItemImage cannot render, so a listed cosmetic showed no art.
  const icon = marketplace_item_icon({ slug: item.template_id, name, slot_category: item.category })
  return {
    id: icon.id,
    image_url: icon.image_url ?? undefined,
    appearance: item.appearance,
    name,
    category: item.category,
    rarity: item.rarity,
    level: item.level || 0,
    damages,
    stats,
    stats_unavailable: rolled_stats == null && has_authored_stats(authored_stats),
    description,
    consumable_effect: consumable,
    weapon_class: item.weapon_class,
    particle_trail: particle,
  }
}

type TooltipState = { item: ItemInfo; rect: DOMRect; rolled_stats: Record<string, number> | null } | null

type WrapperProps = {
  item: ItemInfo
  /** Exact live template metadata when the item carries a canonical object id instead of a seed slug. */
  template?: any
  children: (handlers: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave: () => void
    onMouseMove?: (e: React.MouseEvent<HTMLElement>) => void
  }) => ReactNode
  delay_ms?: number
}

// Wraps any element and provides hover handlers that pop a rich ItemDetailView tooltip.
// Usage:
//   <ItemHoverTooltip item={item}>
//     {handlers => <div {...handlers}>...</div>}
//   </ItemHoverTooltip>
export function ItemHoverTooltip({ item, template, children, delay_ms = 300 }: WrapperProps) {
  const [state, set_state] = useState<TooltipState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hover_request = useRef(0)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      hover_request.current += 1
    }
  }, [item.id])

  const handlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const request_id = ++hover_request.current
      const rolled_stats_read = resolve_rolled_stats(item.id).catch(() => null)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        if (hover_request.current !== request_id) return
        set_state({ item, rect, rolled_stats: null })
        void rolled_stats_read.then((rolled_stats) => {
          if (hover_request.current === request_id) set_state({ item, rect, rolled_stats })
        })
      }, delay_ms)
    },
    onMouseLeave: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      hover_request.current += 1
      set_state(null)
    },
  }

  return (
    <>
      {children(handlers)}
      {state && (
        <TooltipPortal
          item={state.item}
          template={template}
          anchor_rect={state.rect}
          rolled_stats={state.rolled_stats}
        />
      )}
    </>
  )
}

// Renders the ItemDetailView in a portal, positioned near the anchor.
// Flips side if near the right edge; clamps vertically to viewport.
function TooltipPortal({
  item,
  template,
  anchor_rect,
  rolled_stats,
}: {
  item: ItemInfo
  template?: any
  anchor_rect: DOMRect
  rolled_stats: Record<string, number> | null
}) {
  const tt = use_template_t()
  const { templates } = use_content()
  const tmpl = template ?? (templates.item || []).find((tp: any) => tp.id === item.template_id)
  const detail = to_detail_item(item, tmpl, tt, rolled_stats)

  const viewport_w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewport_h = typeof window !== 'undefined' ? window.innerHeight : 800
  const tooltip_w = 320
  const gap = 8

  // Prefer right side; flip to left if not enough room.
  const space_right = viewport_w - anchor_rect.right
  const show_on_right = space_right >= tooltip_w + gap
  const left = show_on_right ? anchor_rect.right + gap : Math.max(gap, anchor_rect.left - tooltip_w - gap)

  // Vertical: align to top of anchor, but if that would overflow the viewport,
  // shift up so the tooltip's bottom edge stays inside. maxHeight is then the
  // remaining space so long tooltips scroll internally rather than clip off-screen.
  const preferred_h = 480 // upper bound we try to reserve if space allows
  const raw_top = Math.max(gap, anchor_rect.top)
  const space_below = viewport_h - raw_top - gap
  const top = space_below >= preferred_h ? raw_top : Math.max(gap, viewport_h - preferred_h - gap)
  const max_tooltip_h = viewport_h - top - gap

  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        left,
        top,
        width: tooltip_w,
        maxHeight: max_tooltip_h,
        zIndex: 9999,
      }}
    >
      <div
        className="overflow-y-auto p-4"
        style={{
          maxHeight: max_tooltip_h,
          background: 'rgba(10,10,15,0.98)',
          border: '1px solid rgba(200,150,60,0.4)',
          boxShadow: '0 0 40px rgba(0,0,0,0.6), 0 0 8px rgba(200,150,60,0.15)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <ItemDetailView item={detail as any} />
      </div>
    </div>,
    document.body
  )
}
