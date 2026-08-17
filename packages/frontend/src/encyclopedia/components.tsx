// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { ReactNode } from 'react'

export const PANEL = 'border border-white/8 bg-[#0d0d14]/94 shadow-[0_18px_50px_rgba(0,0,0,0.28)]'

export const encyclopedia_layout = Object.freeze({
  body: 'flex min-h-0 flex-1 flex-col',
  detail: 'flex-[3] min-w-[380px] overflow-y-auto border-l border-[#1e1e2e]',
  filters: 'flex shrink-0 flex-col gap-2 border-b border-[#1e1e2e] p-3',
  list: 'min-h-0 flex-1 overflow-y-auto',
  empty: 'flex h-full flex-col items-center justify-center gap-3 py-16 text-[#6b7280]',
})

export const category_pill = (active: boolean): string =>
  `shrink-0 cursor-pointer border-b-2 bg-transparent px-3 py-1 text-[9px] tracking-[0.15em] uppercase transition-colors ${
    active ? 'border-[#c8963c] text-[#c8963c]' : 'border-transparent text-[#6b7280] hover:text-[#c8963c]'
  }`

export const SearchField = ({
  value,
  placeholder,
  change,
}: Readonly<{ value: string; placeholder: string; change: (value: string) => void }>) => (
  <label className="relative flex h-9 items-center border border-[#1e1e2e] bg-[#0a0a0f]/55 text-[#6b7280] focus-within:border-[#c8963c]/45">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 opacity-30" size={14} />
    <input
      className="size-full min-w-0 bg-transparent pr-3 pl-9 text-[9px] tracking-[0.15em] text-[#e8e4dc] uppercase outline-none placeholder:text-[#6b7280]/60"
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
  <button
    className="flex w-full cursor-pointer items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors hover:bg-white/4"
    onClick={select}
    style={{
      borderLeftColor: active ? '#c8963c' : (accent ?? 'rgba(255,255,255,0.08)'),
      background: active ? 'rgba(200,150,60,0.08)' : index % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
    }}
    type="button"
  >
    <EntityIcon label={name} size="size-8" src={icon} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[10px] text-[#dedad2]">{name}</span>
      <span className="mt-1 block truncate text-[8px] tracking-[0.12em] text-[#6e727e] uppercase">{meta}</span>
    </span>
    {badge && (
      <span className="ml-auto shrink-0 border border-[#5ee38d]/20 bg-[#5ee38d]/7 px-2 py-1 text-[8px] tracking-[0.12em] text-[#77d99a] uppercase">
        {badge}
      </span>
    )}
  </button>
)

export const EntityGrid = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-0">{children}</div>
)

export const Section = ({ title, children }: Readonly<{ title: string; children: ReactNode }>) => (
  <section className="space-y-2">
    <h3 className="border-b border-[#1e1e2e] pb-1.5 text-[9px] font-semibold tracking-[0.2em] text-[#6b7280] uppercase">
      {title}
    </h3>
    {children}
  </section>
)

export const Fact = ({ label, value, color }: Readonly<{ label: string; value: ReactNode; color?: string }>) => (
  <div className="flex min-h-8 items-center justify-between gap-3 border border-[#1e1e2e] bg-white/2 px-2.5 py-1.5">
    <span className="text-[8px] tracking-[0.12em] text-[#6b7280] uppercase">{label}</span>
    <span className="text-right text-[10px] text-[#e8e4dc]" style={color ? { color } : undefined}>
      {value}
    </span>
  </div>
)

export const LinkChip = ({ children, select }: Readonly<{ children: ReactNode; select: () => void }>) => (
  <button
    className="cursor-pointer border border-[#1e1e2e] bg-white/2 px-2 py-1.5 text-left text-[9px] text-[#e8e4dc] hover:border-[#c8963c]/35 hover:text-[#c8963c]"
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

export const format_number = (value: number): string => value.toLocaleString('en-US')
export const percent = (basis_points: number): string => `${(basis_points / 100).toLocaleString('en-US')}%`
