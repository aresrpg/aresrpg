// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminShopSaleRow } from '@aresrpg/protocol'

import { content_catalog, titleize } from '../content/catalog.ts'
import { env } from '../env.ts'
import { explorer_transaction_url } from '../explorer.ts'
import { format_sui } from '../wallet_amount.ts'

const text = (copy: Readonly<Record<string, string>>, key: string, fallback: string): string => copy[key] || fallback
const sale_name = (sale: AdminShopSaleRow): string =>
  content_catalog.item(sale.item_type)?.item.name ?? titleize(sale.item_type)

export const AdminSalesTable = ({
  copy,
  rows,
}: Readonly<{ copy: Readonly<Record<string, string>>; rows: readonly AdminShopSaleRow[] }>) => (
  <table className="w-full min-w-[850px] border-collapse text-left">
    <thead className="sticky top-0 z-10 bg-surface">
      <tr className="border-y border-border text-[8px] tracking-[0.14em] text-[#6b7280] uppercase">
        <th className="px-3 py-2">{text(copy, 'buyer', 'Buyer')}</th>
        <th className="px-3 py-2">{text(copy, 'item', 'Item')}</th>
        <th className="px-3 py-2">{text(copy, 'quantity', 'Quantity')}</th>
        <th className="px-3 py-2">{text(copy, 'unit_price', 'Unit price')}</th>
        <th className="px-3 py-2">{text(copy, 'total', 'Total')}</th>
        <th className="px-3 py-2">{text(copy, 'when', 'When')}</th>
        <th className="px-3 py-2" aria-label={text(copy, 'transaction', 'Transaction')} />
      </tr>
    </thead>
    <tbody>
      {rows.map((sale, index) => (
        <tr className={`border-b border-border/70 text-[10px] ${index % 2 ? 'bg-white/[0.018]' : ''}`} key={sale.id}>
          <td className="px-3 py-2 font-mono text-[9px] text-[#70bdf2]">
            {sale.buyer.slice(0, 8)}…{sale.buyer.slice(-4)}
          </td>
          <td className="px-3 py-2">
            <span className="block text-[#e8e4dc]">{sale_name(sale)}</span>
            <span className="mt-0.5 block text-[8px] tracking-[0.08em] text-[#6b7280] uppercase">{sale.item_type}</span>
          </td>
          <td className="px-3 py-2 tabular-nums">{sale.quantity.toLocaleString()}</td>
          <td className="px-3 py-2 whitespace-nowrap text-[#c8963c] tabular-nums">
            {format_sui(BigInt(sale.unit_price_mist), 3)} SUI
          </td>
          <td className="px-3 py-2 whitespace-nowrap text-[#c8963c] tabular-nums">
            {format_sui(BigInt(sale.total_mist), 3)} SUI
          </td>
          <td className="px-3 py-2 whitespace-nowrap text-[#a6a0aa]">
            {new Date(sale.timestamp_ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </td>
          <td className="px-3 py-2">
            <a
              className="font-mono text-[9px] text-[#70bdf2] hover:text-white"
              href={explorer_transaction_url(env.network, sale.tx_digest)}
              rel="noreferrer"
              target="_blank"
            >
              {sale.tx_digest.slice(0, 7)}… ↗
            </a>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)
