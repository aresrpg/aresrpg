// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Coins, Store } from 'lucide-react'
import { useMemo, useState } from 'react'

import { item_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import { short_address, SuiUnit } from './marketplace_model.tsx'

const PAGE = 30
const sale_name = (
  row: Readonly<{ name: string | null; item_type: string | null; object: string }>,
  catalog_name: string | undefined
): string => catalog_name ?? row.name ?? (row.item_type ? titleize(row.item_type) : short_address(row.object))

const relative_time = (at_ms: number, locale: string): string => {
  const diff = at_ms - Date.now()
  const abs = Math.abs(diff)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), 'hour')
  return formatter.format(Math.round(diff / 86_400_000), 'day')
}

export const HistoryPanel = ({ locale, text }: Readonly<{ locale: string; text: CopyText }>) => {
  const market = useAppStore(({ marketplace }) => marketplace)
  const [limit, set_limit] = useState(PAGE)
  const profits = useMemo(
    () => market.profits.reduce((sum, row) => sum + BigInt(row.amount_mist), 0n),
    [market.profits]
  )
  const rows = market.history.slice(0, limit)
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col overflow-y-auto bg-surface-high">
      <div className="flex flex-wrap items-center gap-4 px-4 py-4">
        <div className="min-w-[260px] rounded-[5px] border border-border bg-surface px-5 py-4 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
          <p className="text-[8px] tracking-[0.22em] text-[#777b86] uppercase">{text('revenue_30d')}</p>
          <p className="mt-2 inline-flex items-center gap-2 text-[30px] font-semibold leading-none text-[#c8963c] tabular-nums">
            {format_sui(BigInt(market.revenue_30d_mist), 2)} <SuiUnit size={17} />
          </p>
          <p className="mt-2 text-[9px] tracking-[0.12em] text-[#777b86] uppercase">
            {text('sales_count', { count: market.history_total })}
          </p>
        </div>
        {profits > 0n && (
          <div className="min-w-[260px] rounded-[5px] border border-[#c8963c]/35 bg-surface px-5 py-4 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
            <p className="flex items-center gap-1.5 text-[8px] tracking-[0.22em] text-[#777b86] uppercase">
              <Coins size={10} className="text-[#c8963c]" />
              {text('unclaimed')}
            </p>
            <div className="mt-2 flex items-center justify-between gap-4">
              <strong className="inline-flex items-center gap-1.5 text-[22px] text-[#c8963c] tabular-nums">
                {format_sui(profits, 2)} <SuiUnit size={14} />
              </strong>
              <button
                className="h-9 cursor-pointer border border-[#c8963c]/50 bg-[#c8963c]/10 px-4 text-[9px] tracking-[0.15em] text-[#c8963c] uppercase disabled:opacity-40"
                disabled={!!market.pending}
                onClick={() => dispatch_app({ type: 'market/collect_requested' })}
                type="button"
              >
                {text('collect')}
              </button>
            </div>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="grid flex-1 place-items-center">
          <span className="flex items-center gap-2 text-[9px] tracking-[0.18em] text-[#6b7280] uppercase">
            <Store size={17} className="opacity-20" />
            {text('no_history')}
          </span>
        </div>
      ) : (
        <div className="border-t border-border bg-surface">
          <div className="grid grid-cols-[minmax(140px,1.6fr)_80px_minmax(90px,120px)_minmax(100px,1fr)] gap-3 px-3 py-2 text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">
            <span>{text('item')}</span>
            <span>{text('date')}</span>
            <span className="text-right">{text('price')}</span>
            <span>{text('buyer')}</span>
          </div>
          {rows.map((row, index) => {
            const item = row.item_type ? content_catalog.item(row.item_type)?.item : null
            const icon = row.item_type ? item_icon(row.item_type) : null
            return (
              <div
                className={`grid grid-cols-[minmax(140px,1.6fr)_80px_minmax(90px,120px)_minmax(100px,1fr)] items-center gap-3 border-b border-white/7 px-3 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
                key={`${row.object}:${row.ts_ms}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {icon ? (
                    <img alt="" className="size-8 object-contain" src={icon} />
                  ) : (
                    <span className="grid size-8 place-items-center border border-white/10 text-[#c8963c]">◇</span>
                  )}
                  <span className="truncate text-[11px] tracking-[0.05em]">
                    {sale_name(row, item?.name)}
                    {row.amount > 1 ? ` ×${row.amount}` : ''}
                  </span>
                </div>
                <span className="text-[9px] text-[#777b86] uppercase">{relative_time(row.ts_ms, locale)}</span>
                <span className="inline-flex max-w-full items-center justify-end gap-1 truncate whitespace-nowrap text-right text-[11px] tabular-nums">
                  {format_sui(BigInt(row.price_mist), 2)} <SuiUnit />
                </span>
                <span className="truncate text-[10px] tracking-[0.06em] text-[#67adff]">
                  {short_address(row.counterparty)}
                </span>
              </div>
            )
          })}
          {limit < market.history.length && (
            <button
              className="mx-auto my-3 block cursor-pointer border border-white/10 px-4 py-2 text-[8px] tracking-[0.15em] text-[#9da0a9] uppercase"
              onClick={() => set_limit((value) => value + PAGE)}
              type="button"
            >
              {text('load_more')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
