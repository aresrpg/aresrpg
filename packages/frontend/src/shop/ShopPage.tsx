// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Hourglass } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AddFundsModal } from '../components/AddFundsModal.tsx'
import { content_catalog, type SeedItem } from '../content/catalog.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { stack_merge_target_row } from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { format_sui } from '../wallet_amount.ts'

import { ShopCard, type ShopCardSale } from './ShopCard.tsx'
import { ShopAmountModal, ShopSuccessModal } from './ShopModals.tsx'
import { purchase_limit, SHOP_SECTION_ORDER, shop_section, type ShopSection } from './model.ts'

type AuthoredSale = (typeof content_catalog.shop.sales)[number] & Readonly<{ item: SeedItem }>

const authored_sales = content_catalog.shop.sales.filter((sale): sale is AuthoredSale => sale.item !== null)

export default function ShopPage({
  copy,
  navigate,
  session,
}: Readonly<{ copy: AppCopy; navigate: (path: string) => void; session: SessionState }>) {
  const t = copy_text(copy.shop_page)
  const encyclopedia_t = copy_text(copy.encyclopedia_page)
  const description_of = (item_type: string): string | null => {
    const key = `item_descriptions.${item_type}`
    const description = encyclopedia_t(key)
    return description === key ? null : description
  }
  const [active_section, set_active_section] = useState<ShopSection | null>(null)
  const [selected, set_selected] = useState<ShopCardSale | null>(null)
  const [busy, set_busy] = useState<string | null>(null)
  const [success, set_success] = useState<SeedItem | null>(null)
  const [show_funds, set_show_funds] = useState(false)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)

  const sales = useMemo(() => {
    const live = new Map(session.shop?.sales.map((sale) => [sale.item_type, sale]) ?? [])
    return authored_sales.flatMap((sale) => {
      const state = live.get(sale.item_type)
      if (!state?.enabled) return []
      return [
        Object.freeze({
          ...sale,
          price: Number(BigInt(state.price)) / 1_000_000_000,
          infinite: state.infinite,
          stock: state.infinite ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(state.supply)),
        }),
      ]
    })
  }, [session.shop])
  const sections = SHOP_SECTION_ORDER.flatMap((section) => {
    const rows = sales.filter(({ item }) => shop_section(item) === section).sort((a, b) => a.price - b.price)
    return rows.length ? [Object.freeze({ section, rows })] : []
  })
  const visible = active_section ? sections.filter(({ section }) => section === active_section) : sections

  const request_purchase = (sale: ShopCardSale): void => {
    const limit = purchase_limit({
      balance_mist: session.sui_balance_mist,
      category: sale.item.category,
      price_mist: BigInt(sale.price) * 1_000_000_000n,
      stock: sale.stock,
    })
    if (limit === 0) {
      set_show_funds(true)
      return
    }
    set_selected(Object.freeze({ ...sale, stock: Math.min(sale.stock, limit) }))
  }

  const purchase = (sale: ShopCardSale, quantity: number): void => {
    const { wallet } = session
    if (!wallet || busy) return
    set_selected(null)
    set_busy(sale.item_type)
    const pending = toast.loading(t('buy_pending'))
    const existing = stack_merge_target_row(session.inventory, listings, sale.item_type)
    void wallet
      .buy_shop_item({
        item_type: sale.item_type,
        category: sale.item.category,
        price_mist: BigInt(sale.price) * 1_000_000_000n,
        quantity,
        existing_item_id: existing?.id ?? null,
        existing_kiosk_id: existing?.kiosk ?? null,
      })
      .then(() => {
        dispatch_app({ type: 'shop/purchased', item_type: sale.item_type, quantity })
        // the minted item STREAMS from the server (ItemWritten — projection-driven);
        // the receipt only unlocks the next action
        set_success(sale.item)
        pending.success(t('buy_success'))
        dispatch_app({ type: 'wallet/refresh' })
      })
      .catch(pending.error)
      .finally(() => set_busy(null))
  }

  return (
    <section className="pointer-events-auto min-h-full flex-1 overflow-y-auto border border-border bg-bg/97 p-3 lg:p-8">
      <header className="mb-6">
        <div className="text-[8px] tracking-[0.3em] text-gold uppercase">{t('subtitle')}</div>
        <div className="mt-1 flex items-end justify-between gap-4">
          <h1 className="bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#f0c474)] bg-clip-text text-3xl font-semibold tracking-[0.13em] text-transparent uppercase">
            {t('title')}
          </h1>
          {session.sui_balance_mist !== null && (
            <div className="text-right">
              <div className="text-[8px] tracking-[0.2em] text-muted uppercase">{t('wallet')}</div>
              <div className="mt-1 text-sm font-semibold text-gold tabular-nums">
                {format_sui(session.sui_balance_mist, 2)} SUI
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center gap-3 border-y border-white/8 py-3 text-[9px] leading-5 tracking-[0.08em] text-muted">
          <Hourglass className="shrink-0 text-gold/60" size={15} />
          {t('limited_edition_notice')}
        </div>
        <div className="mt-5 flex flex-wrap gap-1 border-b border-border">
          <button
            className={`cursor-pointer border-b-2 px-3 py-2 text-[9px] tracking-[0.15em] uppercase ${active_section === null ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-text'}`}
            onClick={() => set_active_section(null)}
            type="button"
          >
            {t('filter_all')}
          </button>
          {sections.map(({ section }) => (
            <button
              className={`cursor-pointer border-b-2 px-3 py-2 text-[9px] tracking-[0.15em] uppercase ${active_section === section ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-text'}`}
              key={section}
              onClick={() => set_active_section(section)}
              type="button"
            >
              {t(`sections.${section}`)}
            </button>
          ))}
        </div>
      </header>

      {visible.map(({ section, rows }) => (
        <div className="mb-8" key={section}>
          <div className="mb-4 flex items-center gap-3 text-[10px] font-semibold tracking-[0.26em] text-gold uppercase">
            {t(`sections.${section}`)} <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((sale) => (
              <ShopCard
                acquire={() => request_purchase(sale)}
                busy={busy === sale.item_type}
                description={description_of(sale.item_type)}
                disabled={busy !== null || !session.wallet}
                key={sale.item_type}
                open_detail={() => navigate(`/encyclopedia/items/${encodeURIComponent(sale.item_type)}`)}
                open_item={(item_type) => navigate(`/encyclopedia/items/${encodeURIComponent(item_type)}`)}
                sale={sale}
                t={t}
              />
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <ShopAmountModal
          close={() => set_selected(null)}
          cancel_label={copy.cancel}
          close_label={copy.wallet_close}
          confirm={(quantity) => purchase(selected, quantity)}
          item={selected.item}
          max_quantity={selected.stock}
          price_mist={BigInt(selected.price) * 1_000_000_000n}
          t={t}
        />
      )}
      {success && (
        <ShopSuccessModal
          close={() => set_success(null)}
          close_label={copy.wallet_close}
          inventory={() => navigate('/characters')}
          item={success}
          t={t}
        />
      )}
      {show_funds && session.wallet && (
        <AddFundsModal address={session.wallet.address} copy={copy} on_close={() => set_show_funds(false)} />
      )}
    </section>
  )
}
