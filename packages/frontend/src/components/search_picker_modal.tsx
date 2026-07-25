// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Package, Search, X } from 'lucide-react'

import { NewBadge } from './entity_display'

export type PickerItem = {
  id: string
  label: string
  category?: string
  sublabel?: string
  color?: string
  icon?: string
  is_new?: boolean
  tags?: string[]
}

function PickerIcon({ src }: { src: string }) {
  const [failed, set_failed] = useState(false)
  useEffect(() => set_failed(false), [src])
  if (failed) return <Package size={16} className="shrink-0 mt-0.5 text-muted/50" aria-hidden="true" />
  return (
    <img
      src={src}
      alt=""
      className="w-4 h-4 shrink-0 mt-0.5"
      style={{ imageRendering: 'pixelated' }}
      onError={() => set_failed(true)}
      onLoad={(event) => {
        if (!event.currentTarget.naturalWidth) set_failed(true)
      }}
    />
  )
}

export function SearchPickerModal({
  title,
  items,
  value,
  on_select,
  on_close,
  pills,
  render_tooltip,
  empty_label,
}: {
  title: string
  items: PickerItem[]
  value?: string
  on_select: (id: string) => void
  on_close: () => void
  pills?: readonly string[]
  render_tooltip?: (id: string) => React.ReactNode | null
  /** What an empty list says. Defaults to NO RESULTS FOUND; a caller whose population is still loading
   *  passes its own line so absence is never rendered as emptiness (cache law). */
  empty_label?: string
}) {
  const { t } = useTranslation()
  const [search, set_search] = useState('')
  const [active_category, set_active_category] = useState<string | null>(null)
  const [active_pills, set_active_pills] = useState<Set<string>>(new Set())
  const search_ref = useRef<HTMLInputElement>(null)
  const selected_ref = useRef<HTMLDivElement>(null)
  const [hovered_id, set_hovered_id] = useState<string | null>(null)
  const [tooltip_pos, set_tooltip_pos] = useState({ x: 0, y: 0 })
  const tooltip_ref = useRef<HTMLDivElement>(null)

  const has_categories = useMemo(() => items.some((i) => i.category), [items])

  const categories = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of items) {
      if (!item.category) continue
      map[item.category] = (map[item.category] || 0) + 1
    }
    return map
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (active_category && item.category !== active_category) return false

      if (search) {
        const s = search.toLowerCase()
        const matches =
          item.id.toLowerCase().includes(s) ||
          item.label.toLowerCase().includes(s) ||
          (item.sublabel || '').toLowerCase().includes(s)
        if (!matches) return false
      }

      if (active_pills.size > 0) {
        const id_lower = item.id.toLowerCase()
        const label_lower = item.label.toLowerCase()
        const sublabel_parts = (item.sublabel || '').toLowerCase().split(/,\s*/)
        let pill_match = false
        for (const pill of active_pills) {
          const p = pill.toLowerCase()
          if (id_lower.includes(p) || label_lower.includes(p) || sublabel_parts.some((w) => w === p)) {
            pill_match = true
            break
          }
        }
        if (!pill_match) return false
      }

      return true
    })
  }, [items, active_category, search, active_pills])

  // Escape key
  useEffect(() => {
    const handle_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', handle_key)
    return () => window.removeEventListener('keydown', handle_key)
  }, [on_close])

  // Scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Auto-focus search
  useEffect(() => {
    search_ref.current?.focus()
  }, [])

  // Scroll to selected item
  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => {
      selected_ref.current?.scrollIntoView({ block: 'center' })
    }, 50)
    return () => clearTimeout(timer)
  }, [value])

  const toggle_pill = (pill: string) => {
    set_active_pills((prev) => {
      const next = new Set(prev)
      if (next.has(pill)) next.delete(pill)
      else next.add(pill)
      return next
    })
  }

  const value_label = value ? items.find((i) => i.id === value)?.label : undefined

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) on_close()
      }}
    >
      <div
        className="bg-surface border border-border flex flex-col"
        style={{ width: '70vw', height: '70vh', maxWidth: 1000, maxHeight: 700 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <Search size={14} className="text-muted shrink-0" />
          <input
            ref={search_ref}
            className="bg-transparent text-[11px] text-text outline-none flex-1 tracking-wide font-mono"
            placeholder={t('search_picker.search_title', { title: title.toUpperCase() })}
            value={search}
            onChange={(e) => set_search(e.target.value)}
            style={{ letterSpacing: '0.15em', textTransform: 'uppercase' }}
          />
          <button
            className="text-muted hover:text-red-400 cursor-pointer transition-colors shrink-0"
            onClick={on_close}
          >
            <X size={14} />
          </button>
        </div>

        {/* Pills */}
        {pills && pills.length > 0 && (
          <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-border shrink-0">
            {pills.map((pill) => (
              <button
                key={pill}
                className={`category-pill ${active_pills.has(pill) ? 'active' : ''}`}
                style={{ padding: '2px 6px', fontSize: 8 }}
                onClick={() => toggle_pill(pill)}
              >
                {pill}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          {has_categories && (
            <div className="w-48 border-r border-border overflow-y-auto shrink-0">
              <button
                className={`w-full text-left px-3 py-2 text-[10px] tracking-[0.15em] uppercase transition-colors cursor-pointer ${
                  !active_category
                    ? 'text-gold bg-gold/5 border-l-2 border-gold'
                    : 'text-text hover:bg-gold/5 border-l-2 border-transparent'
                }`}
                onClick={() => set_active_category(null)}
              >
                {t('common.all')} <span className="text-muted ml-1">({items.length})</span>
              </button>

              {Object.entries(categories).map(([cat, count]) => (
                <button
                  key={cat}
                  className={`w-full text-left px-3 py-2 text-[10px] tracking-[0.15em] uppercase transition-colors cursor-pointer ${
                    active_category === cat
                      ? 'text-gold bg-gold/5 border-l-2 border-gold'
                      : 'text-text hover:bg-gold/5 border-l-2 border-transparent'
                  }`}
                  onClick={() => set_active_category(cat)}
                >
                  <span className="truncate">{cat}</span>
                  <span className="text-muted ml-1">({count})</span>
                </button>
              ))}
            </div>
          )}

          {/* Results list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-muted text-[10px] px-4 py-8 text-center tracking-[0.2em] uppercase">
                {empty_label ?? t('search_picker.no_results')}
              </div>
            )}
            {filtered.map((item, idx) => {
              const is_selected = item.id === value
              return (
                <div
                  key={`${item.id}-${idx}`}
                  ref={is_selected ? selected_ref : undefined}
                  className={`w-full text-left px-4 py-2 flex items-start gap-3 transition-colors cursor-pointer border-l-2 ${
                    is_selected
                      ? 'bg-gold/10 text-gold border-gold'
                      : 'hover:bg-gold/10 hover:text-gold border-transparent'
                  }`}
                  onClick={() => on_select(item.id)}
                  onMouseEnter={
                    render_tooltip
                      ? (e) => {
                          set_hovered_id(item.id)
                          set_tooltip_pos({ x: e.clientX + 12, y: e.clientY + 12 })
                        }
                      : undefined
                  }
                  onMouseMove={
                    render_tooltip
                      ? (e) => {
                          const tx = e.clientX + 12
                          const ty = e.clientY + 12
                          const tw = 296
                          const th = tooltip_ref.current?.offsetHeight || 200
                          const vw = window.innerWidth
                          const vh = window.innerHeight
                          set_tooltip_pos({
                            x: tx + tw > vw ? e.clientX - tw : tx,
                            y: ty + th > vh ? e.clientY - th : ty,
                          })
                        }
                      : undefined
                  }
                  onMouseLeave={render_tooltip ? () => set_hovered_id(null) : undefined}
                >
                  {item.icon && <PickerIcon src={item.icon} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] tracking-wide font-semibold"
                        style={item.color ? { color: item.color } : undefined}
                      >
                        {item.label}
                      </span>
                      {item.is_new && <NewBadge />}
                      {item.category && (
                        <span className="text-[8px] text-muted uppercase tracking-wide shrink-0">{item.category}</span>
                      )}
                    </div>
                    {item.sublabel && (
                      <span className="text-[9px] text-muted block mt-0.5 leading-snug">{item.sublabel}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-[9px] text-muted tracking-wide uppercase">
            {t('search_picker.results_count', { filtered: filtered.length, total: items.length })}
          </span>
          {value && value_label && (
            <span className="text-[9px] text-gold tracking-wide uppercase">
              {t('search_picker.selected', { label: value_label })}
            </span>
          )}
        </div>
      </div>

      {render_tooltip &&
        hovered_id &&
        (() => {
          const content = render_tooltip(hovered_id)
          if (!content) return null
          return (
            <div
              ref={tooltip_ref}
              className="fixed pointer-events-none z-[10000] transition-opacity duration-100"
              style={{ left: tooltip_pos.x, top: tooltip_pos.y, opacity: 1 }}
            >
              {content}
            </div>
          )
        })()}
    </div>,
    document.body
  )
}

export function PickerField({
  label,
  value,
  display,
  placeholder,
  on_pick,
  on_clear,
}: {
  label?: string
  value: string
  display?: string
  placeholder?: string
  on_pick: () => void
  on_clear: () => void
}) {
  const { t } = useTranslation()
  const display_text = display || value

  const trigger = (
    <div className={`${label ? 'flex-1' : ''} relative`}>
      <button
        className="template-input w-full text-left cursor-pointer hover:border-gold/40 transition-colors"
        onClick={on_pick}
      >
        {display_text ? (
          <span>{display_text}</span>
        ) : (
          <span className="text-muted">{placeholder || t('search_picker.select_placeholder')}</span>
        )}
      </button>
      {value && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted text-[9px] hover:text-red-400 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            on_clear()
          }}
        >
          ✕
        </button>
      )}
    </div>
  )

  if (!label) return trigger

  return (
    <div className="flex gap-3 items-start">
      <span className="text-muted text-[9px] w-28 uppercase tracking-wide shrink-0 pt-2">{label}</span>
      {trigger}
    </div>
  )
}
