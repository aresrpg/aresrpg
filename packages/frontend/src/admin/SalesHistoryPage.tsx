// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminRangeDays } from '@aresrpg/protocol'

import { PANEL } from '../encyclopedia/components.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

import { AdminRangeSelector } from './AdminRangeSelector.tsx'
import { AdminSalesTable } from './AdminSalesTable.tsx'

const SALES_RANGES: readonly AdminRangeDays[] = Object.freeze([7, 30, 90])
const text = (copy: Readonly<Record<string, string>>, key: string, fallback: string): string => copy[key] || fallback

export const SalesHistoryPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const sales = useAppStore((state) => state.admin.sales)
  const loading_first = sales.status === 'loading' && sales.rows.length === 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-surface/50 p-3">
      <header className={`${PANEL} flex shrink-0 items-center justify-between gap-4 px-3 py-2`}>
        <div className="min-w-0">
          <h1 className="truncate text-[10px] font-semibold tracking-[0.16em] text-[#d9d5cd] uppercase">
            {text(copy, 'sales_history', 'Shop sales history')}
          </h1>
          <p className="mt-1 text-[8px] text-[#6b7280]">
            {text(copy, 'sales_retention', 'Exact transaction details are retained for 90 days')}
          </p>
        </div>
        <AdminRangeSelector
          change={(days) => dispatch_app({ type: 'admin/sales_range_changed', days })}
          copy={copy}
          days={sales.range_days}
          ranges={SALES_RANGES}
        />
      </header>
      <section className={`${PANEL} flex min-h-0 flex-1 flex-col overflow-hidden`}>
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2 text-[8px] tracking-[0.12em] text-[#6b7280] uppercase">
          <span>
            {sales.rows.length.toLocaleString()} {text(copy, 'transactions', 'transactions')}
          </span>
          <button
            className="ml-auto text-[#c8963c]"
            onClick={() => dispatch_app({ type: 'admin/sales_refresh' })}
            type="button"
          >
            ↻ {text(copy, 'refresh', 'Refresh')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading_first ? (
            <div className="grid h-full place-items-center text-[9px] tracking-[0.14em] text-[#6b7280] uppercase">
              {text(copy, 'loading', 'Loading…')}
            </div>
          ) : sales.rows.length === 0 ? (
            <div className="grid h-full place-items-center text-[9px] tracking-[0.14em] text-[#6b7280] uppercase">
              {text(copy, 'no_sales_history', 'No sales in this period')}
            </div>
          ) : (
            <AdminSalesTable copy={copy} rows={sales.rows} />
          )}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-center border-t border-border">
          {sales.error ? (
            <button
              className="text-[8px] tracking-[0.12em] text-[#ff8caa] uppercase"
              onClick={() => dispatch_app({ type: 'admin/sales_more' })}
              type="button"
            >
              {sales.error} · {text(copy, 'retry', 'Retry')}
            </button>
          ) : sales.next_cursor ? (
            <button
              className="border border-border px-4 py-2 text-[8px] tracking-[0.12em] text-[#c8963c] uppercase disabled:opacity-30"
              disabled={sales.status === 'loading'}
              onClick={() => dispatch_app({ type: 'admin/sales_more' })}
              type="button"
            >
              {sales.status === 'loading' ? text(copy, 'loading', 'Loading…') : text(copy, 'load_more', 'Load more')}
            </button>
          ) : (
            <span className="text-[8px] tracking-[0.12em] text-[#555b66] uppercase">
              {text(copy, 'end_of_history', 'End of retained history')}
            </span>
          )}
        </footer>
      </section>
    </div>
  )
}
