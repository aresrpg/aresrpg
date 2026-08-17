// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Loader2, ShoppingBag } from 'lucide-react'

import { content_catalog, type SeedItem } from '../content/catalog.ts'
import { item_icon } from '../content/assets.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { CopyText } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'

import { loot_box_odds } from './model.ts'

export type ShopCardSale = Readonly<{
  item_type: string
  price: number
  supply: number
  stock: number
  item: SeedItem
}>

const Supply = ({ sale, t }: Readonly<{ sale: ShopCardSale; t: CopyText }>) => {
  const percent = Math.max(0, Math.min(100, (sale.stock / sale.supply) * 100))
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[8px] tracking-[0.08em] text-muted uppercase">
        <span>
          {t('remaining_of_cap', { remaining: sale.stock.toLocaleString(), cap: sale.supply.toLocaleString() })}
        </span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-1 overflow-hidden bg-white/8">
        <div
          className="h-full bg-[linear-gradient(90deg,#8b6914,#c8963c,#f5d0a9)] shadow-[0_0_8px_rgba(200,150,60,0.35)] transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

const Acquire = ({
  busy,
  disabled,
  sale,
  t,
  acquire,
}: Readonly<{
  busy: boolean
  disabled: boolean
  sale: ShopCardSale
  t: CopyText
  acquire: () => void
}>) => (
  <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-3">
    <span className="text-base font-semibold tracking-[0.06em] text-gold tabular-nums">
      {format_sui(BigInt(sale.price) * 1_000_000_000n, 2)} <small className="text-[9px]">SUI</small>
    </span>
    <button
      className="btn-gold flex cursor-pointer items-center gap-2 px-4 py-2 text-[9px] tracking-[0.16em] disabled:cursor-not-allowed"
      disabled={disabled || sale.stock === 0}
      onClick={acquire}
      type="button"
    >
      {busy ? <Loader2 className="animate-spin" size={12} /> : <ShoppingBag size={12} />}
      {busy ? t('processing') : sale.stock === 0 ? t('sold_out') : t('acquire')}
    </button>
  </div>
)

const Case = ({ item, open_detail }: Readonly<{ item: SeedItem; open_detail: () => void }>) => {
  const icon = item_detail_icon(item.item_type) ?? item_icon(item.item_type)
  return (
    <button
      aria-label={item.name}
      className="relative flex h-[280px] w-full cursor-pointer items-center justify-center overflow-hidden border-b border-white/8 bg-[radial-gradient(circle_at_50%_25%,rgba(245,208,169,0.15),rgba(200,150,60,0.04)_38%,rgba(0,0,0,0)_72%)]"
      onClick={open_detail}
      type="button"
    >
      <span className="absolute top-0 h-3/4 w-2/3 bg-[conic-gradient(from_210deg_at_50%_0%,transparent,rgba(245,208,169,0.08),transparent_34%)] blur-xl" />
      {icon ? (
        <img
          alt=""
          className="relative z-[1] h-[72%] w-[72%] object-contain drop-shadow-[0_18px_32px_rgba(0,0,0,0.7)]"
          src={icon}
        />
      ) : (
        <span className="relative z-[1] text-5xl text-gold/30">{item.name.slice(0, 1)}</span>
      )}
      <span className="absolute bottom-8 h-3 w-2/5 rounded-[50%] bg-black/55 blur-md" />
    </button>
  )
}

export const ShopCard = ({
  busy,
  disabled,
  description,
  sale,
  t,
  acquire,
  open_detail,
  open_item,
}: Readonly<{
  busy: boolean
  disabled: boolean
  description: string | null
  sale: ShopCardSale
  t: CopyText
  acquire: () => void
  open_detail: () => void
  open_item: (item_type: string) => void
}>) => {
  const odds = loot_box_odds(sale.item)
  return (
    <article
      className={`overflow-hidden border border-border bg-[#0d0d14]/92 shadow-[0_18px_45px_rgba(0,0,0,0.28)] ${odds.length ? 'lg:col-span-2 lg:grid lg:grid-cols-2' : ''} ${sale.stock === 0 ? 'opacity-55' : ''}`}
    >
      <div>
        <Case item={sale.item} open_detail={open_detail} />
        <div className="flex flex-col gap-3 p-4">
          <h3 className="bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#e8e4dc)] bg-clip-text text-[13px] font-semibold tracking-[0.13em] text-transparent uppercase">
            {sale.item.name}
          </h3>
          {description && <p className="text-[9px] leading-5 tracking-wide text-muted">{description}</p>}
          <Supply sale={sale} t={t} />
          <Acquire acquire={acquire} busy={busy} disabled={disabled} sale={sale} t={t} />
        </div>
      </div>
      {odds.length > 0 && (
        <div className="border-t border-border p-4 lg:border-t-0 lg:border-l">
          <h4 className="text-[10px] font-semibold tracking-[0.24em] text-gold uppercase">{t('drop_rates')}</h4>
          <p className="mt-2 text-[9px] leading-5 text-muted">{t('pool_sub')}</p>
          <div className="mt-4 border-t border-white/8">
            {odds.map((row) => {
              const reward = content_catalog.item(row.item_type)?.item
              return (
                <button
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-white/8 py-2 text-left hover:bg-white/3"
                  key={row.item_type}
                  onClick={() => open_item(row.item_type)}
                  type="button"
                >
                  {item_icon(row.item_type) && (
                    <img alt="" className="size-9 object-contain" src={item_icon(row.item_type)!} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[10px] tracking-[0.1em] text-text uppercase">
                    {reward?.name ?? row.item_type.replaceAll('_', ' ')}
                  </span>
                  <span className="text-[10px] text-gold tabular-nums">{row.percent.toFixed(1)}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </article>
  )
}
