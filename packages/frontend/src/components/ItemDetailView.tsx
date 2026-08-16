// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import { element_colors, item_category_colors, stat_colors } from '../visual_identity.ts'

const titleize = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export const ItemDetailView = ({
  category,
  children,
  damages,
  description,
  icon,
  labels,
  level,
  name,
  obtention,
  stats,
}: Readonly<{
  category: string
  children?: ReactNode
  damages: readonly Readonly<{ element: string; from: number; to: number; damage_type: string }>[]
  description?: string | null
  icon: string | null
  labels: Readonly<{ characteristics: string; damages: string; level_short: string; range_to: string }>
  level: number
  name: string
  obtention?: string | null
  stats?: Readonly<{ min: Readonly<Record<string, number>>; max: Readonly<Record<string, number>> }>
}>) => {
  const stat_rows = stats
    ? Object.entries(stats.max).filter(([key, maximum]) => maximum !== 0 || (stats.min[key] ?? 0) !== 0)
    : []
  const has_characteristics = damages.length > 0 || stat_rows.length > 0

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex items-start gap-4">
        {icon && (
          <img
            alt=""
            className="size-[94px] shrink-0 object-contain drop-shadow-[0_0_8px_rgba(200,150,60,0.3)]"
            src={icon}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="truncate text-[13px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
              {name}
            </span>
            {level > 0 && (
              <span className="ml-auto shrink-0 border border-[#c8963c]/35 bg-[#c8963c]/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] whitespace-nowrap text-[#c8963c] uppercase">
                {labels.level_short}
              </span>
            )}
          </div>
          <span
            className="text-[10px] tracking-[0.15em] uppercase"
            style={{ color: item_category_colors[category] ?? '#6b7280' }}
          >
            {titleize(category)}
          </span>
          {description && <span className="mt-1 text-[9px] leading-relaxed text-[#777] italic">{description}</span>}
        </div>
      </header>

      {obtention && <p className="text-[9px] tracking-[0.05em] text-[#6b7280]">{obtention}</p>}

      {(has_characteristics || children) && <div className="h-px w-full bg-white/6" />}
      {has_characteristics && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">
            {labels.characteristics}
          </h3>
          {damages.length > 0 && (
            <div className="flex flex-col gap-1">
              {damages.map((damage, index) => {
                const color = element_colors[damage.element] ?? '#ffffff'
                return (
                  <div className="text-[10px] tracking-wide" key={`${damage.element}-${index}`}>
                    <span style={{ color }}>{damage.from}</span>
                    <span className="text-[#aaa]"> - </span>
                    <span style={{ color }}>{damage.to}</span>
                    <span className="text-[#aaa]"> {labels.damages} </span>
                    <span style={{ color }}>{titleize(damage.element)}</span>
                  </div>
                )
              })}
            </div>
          )}
          {stat_rows.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {stat_rows.map(([key, maximum], index) => {
                const minimum = stats?.min[key] ?? maximum
                const color = stat_colors[key] ?? '#e8e4dc'
                const signed = (value: number): string => `${value < 0 ? '' : '+'}${value}`
                return (
                  <div
                    className="px-2 py-1 text-[10px] tracking-wide"
                    key={key}
                    style={{ background: index % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                  >
                    <span style={{ color: minimum < 0 ? '#ff5555' : color }}>{signed(minimum)}</span>
                    {minimum !== maximum && (
                      <>
                        <span className="text-[#aaa]"> {labels.range_to} </span>
                        <span style={{ color: maximum < 0 ? '#ff5555' : color }}>{maximum}</span>
                      </>
                    )}
                    <span className="text-[#aaa]"> </span>
                    <span style={{ color }}>{titleize(key)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
      {children}
    </div>
  )
}
