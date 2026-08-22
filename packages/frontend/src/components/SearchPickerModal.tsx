// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Extracted shared picker used by simulator characters, mobs, equipment, relics, and cosmetics.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and DOM events are mutable lifecycle boundaries. */

import { Package, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type PickerItem = Readonly<{
  id: string
  label: string
  category?: string
  sublabel?: string
  color?: string
  icon?: string | null
  is_new?: boolean
  tags?: readonly string[]
}>

export type PickerCopy = Readonly<{
  search: (title: string) => string
  all: string
  no_results: string
  results: (filtered: number, total: number) => string
  selected: (label: string) => string
  new_label: string
}>

export const LONG_PRESS_MS = 400

export const filter_picker_items = ({
  items,
  search,
  category,
  pills,
}: Readonly<{
  items: readonly PickerItem[]
  search: string
  category: string | null
  pills: ReadonlySet<string>
}>): readonly PickerItem[] => {
  const query = search.trim().toLowerCase()
  return items.filter((item) => {
    if (category && item.category !== category) return false
    if (
      query &&
      ![item.id, item.label, item.sublabel ?? '', ...(item.tags ?? [])].some((value) =>
        value.toLowerCase().includes(query)
      )
    )
      return false
    if (pills.size === 0) return true
    const searchable = [item.id, item.label, item.sublabel ?? '', ...(item.tags ?? [])].map((value) =>
      value.toLowerCase()
    )
    return [...pills].some((pill) => searchable.some((value) => value.includes(pill.toLowerCase())))
  })
}

const PickerIcon = ({ src }: Readonly<{ src: string }>) => {
  const [failed, set_failed] = useState(false)
  useEffect(() => set_failed(false), [src])
  return failed ? (
    <Package aria-hidden="true" className="mt-0.5 shrink-0 text-[#6b7280]/50" size={16} />
  ) : (
    <img
      alt=""
      className="mt-0.5 size-4 shrink-0"
      crossOrigin="anonymous"
      onError={() => set_failed(true)}
      onLoad={(event) => {
        if (!event.currentTarget.naturalWidth) set_failed(true)
      }}
      src={src}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

export const SearchPickerModal = ({
  copy,
  title,
  items,
  value,
  on_select,
  on_close,
  pills = [],
  render_tooltip,
  empty_label,
  locked_ids,
}: Readonly<{
  copy: PickerCopy
  title: string
  items: readonly PickerItem[]
  value?: string
  on_select: (id: string) => void
  on_close: () => void
  pills?: readonly string[]
  render_tooltip?: (id: string) => ReactNode | null
  empty_label?: string
  /** rows that render greyed and refuse selection (e.g. worlds above the character's level) */
  locked_ids?: ReadonlySet<string>
}>) => {
  const [search, set_search] = useState('')
  const [category, set_category] = useState<string | null>(null)
  const [active_pills, set_active_pills] = useState<ReadonlySet<string>>(new Set())
  const search_ref = useRef<HTMLInputElement | null>(null)
  const selected_ref = useRef<HTMLButtonElement | null>(null)
  const tooltip_ref = useRef<HTMLDivElement | null>(null)
  const press_timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const press_read = useRef(false)
  const [hovered_id, set_hovered_id] = useState<string | null>(null)
  const [tooltip_position, set_tooltip_position] = useState<Readonly<{ x: number; y: number }>>({ x: 0, y: 0 })
  const categories = useMemo(
    () =>
      Object.freeze(
        Object.entries(
          items.reduce<Record<string, number>>((counts, item) => {
            if (!item.category) return counts
            return { ...counts, [item.category]: (counts[item.category] ?? 0) + 1 }
          }, {})
        )
      ),
    [items]
  )
  const filtered = useMemo(
    () => filter_picker_items({ items, search, category, pills: active_pills }),
    [items, search, category, active_pills]
  )
  const selected_label = value ? items.find(({ id }) => id === value)?.label : undefined

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') on_close()
    }
    globalThis.addEventListener('keydown', keydown)
    search_ref.current?.focus()
    const timer = setTimeout(() => selected_ref.current?.scrollIntoView({ block: 'center' }), 50)
    return () => {
      clearTimeout(timer)
      globalThis.removeEventListener('keydown', keydown)
      document.body.style.overflow = previous
    }
  }, [on_close])

  useEffect(
    () => () => {
      if (press_timer.current) clearTimeout(press_timer.current)
    },
    []
  )

  const cancel_press = (): void => {
    if (press_timer.current) clearTimeout(press_timer.current)
    press_timer.current = null
  }

  const toggle_pill = (pill: string): void =>
    set_active_pills((current) => {
      const next = new Set(current)
      if (next.has(pill)) next.delete(pill)
      else next.add(pill)
      return next
    })

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) on_close()
      }}
      role="presentation"
    >
      <section className="flex h-[70vh] max-h-[700px] w-[70vw] max-w-[1000px] flex-col border border-[#1e1e2e] bg-[#12121a]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[#1e1e2e] px-4 py-3">
          <Search className="shrink-0 text-[#6b7280]" size={14} />
          <input
            className="flex-1 bg-transparent font-mono text-[11px] tracking-[0.15em] text-[#e8e4dc] uppercase outline-none"
            onChange={(event) => set_search(event.target.value)}
            placeholder={copy.search(title.toUpperCase())}
            ref={search_ref}
            value={search}
          />
          <button className="cursor-pointer text-[#6b7280] hover:text-red-400" onClick={on_close} type="button">
            <X size={14} />
          </button>
        </header>
        {pills.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-[#1e1e2e] px-4 py-2">
            {pills.map((pill) => (
              <button
                className={`cursor-pointer border px-1.5 py-0.5 text-[8px] uppercase ${active_pills.has(pill) ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#c8963c]' : 'border-white/8 text-[#6b7280]'}`}
                key={pill}
                onClick={() => toggle_pill(pill)}
                type="button"
              >
                {pill}
              </button>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {categories.length > 0 && (
            <nav className="w-48 shrink-0 overflow-y-auto border-r border-[#1e1e2e]">
              {[
                [null, copy.all, items.length] as const,
                ...categories.map(([name, count]) => [name, name, count] as const),
              ].map(([id, label, count]) => (
                <button
                  className={`block w-full cursor-pointer border-l-2 px-3 py-2 text-left text-[10px] tracking-[0.15em] uppercase ${category === id ? 'border-[#c8963c] bg-[#c8963c]/5 text-[#c8963c]' : 'border-transparent text-[#e8e4dc] hover:bg-[#c8963c]/5'}`}
                  key={id ?? 'all'}
                  onClick={() => set_category(id)}
                  type="button"
                >
                  {label} <span className="ml-1 text-[#6b7280]">({count})</span>
                </button>
              ))}
            </nav>
          )}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-[10px] tracking-[0.2em] text-[#6b7280] uppercase">
                {empty_label ?? copy.no_results}
              </div>
            )}
            {filtered.map((item) => {
              const selected = item.id === value
              const locked = locked_ids?.has(item.id) ?? false
              return (
                <button
                  className={`flex w-full items-start gap-3 border-l-2 px-4 py-2 text-left ${selected ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#c8963c]' : locked ? 'border-transparent text-[#555b66] opacity-45' : 'cursor-pointer border-transparent hover:bg-[#c8963c]/10 hover:text-[#c8963c]'}`}
                  key={item.id}
                  onClick={() => {
                    if (locked || press_read.current) {
                      press_read.current = false
                      set_hovered_id(null)
                      return
                    }
                    on_select(item.id)
                  }}
                  onMouseEnter={
                    render_tooltip
                      ? (event) => {
                          set_hovered_id(item.id)
                          set_tooltip_position({ x: event.clientX + 12, y: event.clientY + 12 })
                        }
                      : undefined
                  }
                  onMouseLeave={render_tooltip ? () => set_hovered_id(null) : undefined}
                  onMouseMove={
                    render_tooltip
                      ? (event) => {
                          const width = 296
                          const height = tooltip_ref.current?.offsetHeight ?? 200
                          set_tooltip_position({
                            x:
                              event.clientX + 12 + width > globalThis.innerWidth
                                ? event.clientX - width
                                : event.clientX + 12,
                            y:
                              event.clientY + 12 + height > globalThis.innerHeight
                                ? event.clientY - height
                                : event.clientY + 12,
                          })
                        }
                      : undefined
                  }
                  onTouchCancel={render_tooltip ? cancel_press : undefined}
                  onTouchEnd={render_tooltip ? cancel_press : undefined}
                  onTouchMove={render_tooltip ? cancel_press : undefined}
                  onTouchStart={
                    render_tooltip
                      ? (event) => {
                          const touch = event.touches.item(0)
                          if (!touch) return
                          const { clientX: x, clientY: y } = touch
                          cancel_press()
                          press_timer.current = setTimeout(() => {
                            press_timer.current = null
                            press_read.current = true
                            set_tooltip_position({
                              x: Math.max(8, x - 296),
                              y: Math.max(8, y - 220),
                            })
                            set_hovered_id(item.id)
                          }, LONG_PRESS_MS)
                        }
                      : undefined
                  }
                  ref={selected ? selected_ref : undefined}
                  type="button"
                >
                  {item.icon && <PickerIcon src={item.icon} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold tracking-wide" style={{ color: item.color }}>
                        {item.label}
                      </span>
                      {item.is_new && (
                        <span className="text-[7px] tracking-wider text-[#5ee38d] uppercase">{copy.new_label}</span>
                      )}
                      {item.category && (
                        <span className="text-[8px] tracking-wide text-[#6b7280] uppercase">{item.category}</span>
                      )}
                    </span>
                    {item.sublabel && <span className="mt-0.5 block text-[9px] text-[#6b7280]">{item.sublabel}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <footer className="flex shrink-0 items-center justify-between border-t border-[#1e1e2e] px-4 py-2 text-[9px] tracking-wide uppercase">
          <span className="text-[#6b7280]">{copy.results(filtered.length, items.length)}</span>
          {selected_label && <span className="text-[#c8963c]">{copy.selected(selected_label)}</span>}
        </footer>
      </section>
      {render_tooltip && hovered_id && (
        <div
          className="pointer-events-none fixed z-[10000] transition-opacity duration-100"
          ref={tooltip_ref}
          style={{ left: tooltip_position.x, top: tooltip_position.y }}
        >
          {render_tooltip(hovered_id)}
        </div>
      )}
    </div>,
    document.body
  )
}
