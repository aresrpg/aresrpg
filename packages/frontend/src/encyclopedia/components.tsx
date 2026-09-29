// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CollectionTile, FloatingWindow, GameWindow } from '@aresrpg/ui'
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { useText } from '../i18n/useText.ts'

import type { EncyclopediaText } from './copy.ts'

export const PANEL = 'border border-border bg-surface/96 shadow-[0_18px_50px_rgba(0,0,0,0.24)]'

export const encyclopedia_layout = Object.freeze({
  body: 'flex min-h-0 flex-1 flex-col',
  filters: 'enc-filters flex shrink-0 flex-col gap-2 border-b border-border p-3',
  list: 'min-h-0 flex-1 overflow-y-auto',
  empty: 'flex h-full flex-col items-center justify-center gap-3 py-16 text-[#6b7280]',
})

/** One mounted list preserves filters while narrow layouts show its routed detail. */
export const EncyclopediaBrowser = ({
  list,
  detail,
  rail,
  back,
  text,
}: Readonly<{
  list: ReactNode
  detail: ReactNode
  rail?: ReactNode
  back: () => void
  text: EncyclopediaText
}>) => {
  const ui = useText()
  const identity = useId()
  return (
    <div className="enc-browser aui-catalogue-browser flex min-h-0 min-w-0 flex-1">
      {rail}
      {list}
      {detail && (
        <FloatingWindow identity={identity} close={back} label={ui('ui.character_details')}>
          <GameWindow
            draggable
            title={ui('ui.character_details')}
            close={back}
            close_label={ui('wallet_close')}
            className="aui-catalogue-details"
          >
            <div className="aui-catalogue-detail-body">{detail}</div>
          </GameWindow>
        </FloatingWindow>
      )}
    </div>
  )
}

export const SearchField = ({
  value,
  placeholder,
  change,
}: Readonly<{ value: string; placeholder: string; change: (value: string) => void }>) => (
  <label className="aui-search-field">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 opacity-30" size={14} />
    <input
      type="search"
      aria-label={placeholder}
      className="aui-search-input"
      onChange={(event) => change(event.target.value)}
      placeholder={placeholder}
      value={value}
    />
  </label>
)

export const EntityIcon = ({
  src,
  label,
  size = 'size-10',
}: Readonly<{ src: string | null; label: string; size?: string }>) =>
  src ? (
    <img alt="" className={`${size} shrink-0 object-contain drop-shadow-[0_0_10px_rgba(200,150,60,0.18)]`} src={src} />
  ) : (
    <span
      className={`${size} grid shrink-0 place-items-center border border-white/8 bg-white/3 text-xs text-[#c8963c]`}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  )

export const EntityButton = ({
  active,
  icon,
  index = 0,
  accent,
  name,
  meta,
  badge,
  select,
}: Readonly<{
  active: boolean
  icon: string | null
  index?: number
  accent?: string
  name: string
  meta: string
  badge?: string
  select: () => void
}>) => (
  <CollectionTile
    selected={active}
    on_select={select}
    entry={{ id: name, label: name, image: icon ?? undefined, meta, badge }}
  />
)

export const EntityGrid = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="aui-collection">{children}</div>
)

export const Section = ({ title, children }: Readonly<{ title: string; children: ReactNode }>) => (
  <section className="space-y-2">
    <h3 className="border-b border-border pb-1.5 text-[9px] font-semibold tracking-[0.2em] text-[#6b7280] uppercase">
      {title}
    </h3>
    {children}
  </section>
)

export const Fact = ({ label, value, color }: Readonly<{ label: string; value: ReactNode; color?: string }>) => (
  <div className="flex min-h-8 items-center justify-between gap-3 border border-border bg-white/2 px-2.5 py-1.5">
    <span className="text-[8px] tracking-[0.12em] text-[#6b7280] uppercase">{label}</span>
    <span className="text-right text-[10px] text-[#e8e4dc]" style={color ? { color } : undefined}>
      {value}
    </span>
  </div>
)

export const LinkChip = ({ children, select }: Readonly<{ children: ReactNode; select: () => void }>) => (
  <button
    className="cursor-pointer border border-border bg-white/2 px-2 py-1.5 text-left text-[9px] text-[#e8e4dc] hover:border-[#c8963c]/35 hover:text-[#c8963c]"
    onClick={select}
    type="button"
  >
    {children}
  </button>
)

export const Pager = ({
  page,
  pages,
  previous,
  next,
}: Readonly<{ page: number; pages: number; previous: () => void; next: () => void }>) => (
  <div className="flex h-9 items-center justify-between border-t border-white/8 px-2 text-[8px] tracking-[0.14em] text-[#777b86]">
    <button className="p-2 disabled:opacity-20" disabled={page === 0} onClick={previous} type="button">
      <ChevronLeft size={13} />
    </button>
    <span>{pages === 0 ? '0 / 0' : `${page + 1} / ${pages}`}</span>
    <button className="p-2 disabled:opacity-20" disabled={page + 1 >= pages} onClick={next} type="button">
      <ChevronRight size={13} />
    </button>
  </div>
)

export const Empty = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="grid min-h-40 place-items-center p-8 text-center text-[9px] tracking-[0.14em] text-[#6e727e] uppercase">
    {children}
  </div>
)
