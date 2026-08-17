// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CheckCircle2, Minus, Plus, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { SeedItem } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'

const Modal = ({ children, close }: Readonly<{ children: ReactNode; close: () => void }>) => {
  useEffect(() => {
    const key = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') close()
    }
    globalThis.addEventListener('keydown', key)
    return () => globalThis.removeEventListener('keydown', key)
  }, [close])
  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      {children}
    </div>,
    document.body
  )
}

export const ShopAmountModal = ({
  item,
  max_quantity,
  price_mist,
  t,
  cancel_label,
  close_label,
  close,
  confirm,
}: Readonly<{
  item: SeedItem
  max_quantity: number
  price_mist: bigint
  t: CopyText
  cancel_label: string
  close_label: string
  close: () => void
  confirm: (quantity: number) => void
}>) => {
  const [quantity, set_quantity] = useState(1)
  const clamp = (value: number): number => Math.max(1, Math.min(max_quantity, Math.floor(value) || 1))
  return (
    <Modal close={close}>
      <section className="w-full max-w-sm border border-border bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <header className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-[13px] font-semibold tracking-[0.2em] text-gold uppercase">{t('amount_title')}</h2>
          <button
            aria-label={close_label}
            className="cursor-pointer text-muted hover:text-text"
            onClick={close}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-3">
            {item_detail_icon(item.item_type) && (
              <img alt="" className="size-14 object-contain" src={item_detail_icon(item.item_type)!} />
            )}
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold tracking-[0.14em] text-gold-light uppercase">
                {item.name}
              </div>
              <div className="mt-1 text-[9px] tracking-[0.15em] text-muted uppercase">
                {t('amount_available', { count: max_quantity })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[9px] tracking-[0.16em] text-muted uppercase">
              {t('amount_quantity')}
            </span>
            <button
              className="btn-outline grid size-9 place-items-center"
              onClick={() => set_quantity(clamp(quantity - 1))}
              type="button"
            >
              <Minus size={13} />
            </button>
            <input
              aria-label={t('amount_quantity')}
              className="h-9 w-16 border border-border bg-bg text-center text-[13px] text-text outline-none"
              inputMode="numeric"
              onChange={(event) => set_quantity(clamp(Number(event.target.value.replaceAll(/\D/g, ''))))}
              value={quantity}
            />
            <button
              className="btn-outline grid size-9 place-items-center"
              onClick={() => set_quantity(clamp(quantity + 1))}
              type="button"
            >
              <Plus size={13} />
            </button>
            <button
              className="btn-outline h-9 px-3 text-[9px] tracking-[0.14em]"
              onClick={() => set_quantity(max_quantity)}
              type="button"
            >
              {t('amount_max')}
            </button>
          </div>
          <div className="flex items-center justify-between border border-gold/25 bg-gold/5 px-4 py-3">
            <span className="text-[9px] tracking-[0.18em] text-muted uppercase">{t('amount_total')}</span>
            <span className="text-sm font-semibold text-gold tabular-nums">
              {format_sui(price_mist * BigInt(quantity), 2)} <small>SUI</small>
            </span>
          </div>
          <div className="flex gap-3">
            <button className="btn-outline flex-1 py-2.5 text-[9px] tracking-[0.18em]" onClick={close} type="button">
              {cancel_label}
            </button>
            <button
              className="btn-gold flex-1 py-2.5 text-[9px] tracking-[0.18em]"
              onClick={() => confirm(quantity)}
              type="button"
            >
              {t('amount_confirm', { count: quantity })}
            </button>
          </div>
        </div>
      </section>
    </Modal>
  )
}

export const ShopSuccessModal = ({
  item,
  t,
  close_label,
  close,
  inventory,
}: Readonly<{ item: SeedItem; t: CopyText; close_label: string; close: () => void; inventory: () => void }>) => (
  <Modal close={close}>
    <section className="w-full max-w-md border border-emerald-400/45 bg-surface shadow-[0_0_35px_rgba(52,211,153,0.1)]">
      <div className="flex flex-col items-center gap-5 p-8 text-center">
        <CheckCircle2 className="text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" size={36} />
        <h2 className="text-[13px] font-semibold tracking-[0.28em] text-emerald-300 uppercase">
          {t('acquisition_complete')}
        </h2>
        <div className="h-px w-full bg-border" />
        <div className="flex items-center gap-3">
          {item_detail_icon(item.item_type) && (
            <img alt="" className="size-14 object-contain" src={item_detail_icon(item.item_type)!} />
          )}
          <span className="text-[12px] font-semibold tracking-[0.16em] text-gold-light uppercase">{item.name}</span>
        </div>
        <p className="text-[10px] leading-5 text-text/70">{t('purchase_success_body')}</p>
        <div className="flex w-full gap-3">
          <button className="btn-gold flex-1 py-2.5 text-[9px] tracking-[0.16em]" onClick={inventory} type="button">
            {t('see_inventory')}
          </button>
          <button className="btn-outline flex-1 py-2.5 text-[9px] tracking-[0.16em]" onClick={close} type="button">
            {close_label}
          </button>
        </div>
      </div>
    </section>
  </Modal>
)
