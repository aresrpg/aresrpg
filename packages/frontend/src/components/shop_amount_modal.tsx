// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { format_mist_to_sui } from '../utils/sui_mist'
import { cosmetic_icon_of } from '../game/cosmetic_icons.js'

import { ItemImage } from './items'

// AMOUNT modal — the UNIVERSAL quantity ask before ANY shop purchase fires (every category
// asks, not just lootboxes). N is clamped to [1, max_qty], where max_qty already folds in the remaining supply,
// the wallet's affordable count, and the on-chain MAX_BUY_QUANTITY (all computed by the caller). Confirm hands N
// back so the caller composes ONE `shop::buy_many` PTB for exactly N. Qty-locked rows (supply 1 / one affordable)
// still pass through with the stepper pinned at 1 — the modal doubles as the purchase confirm.
// Gothic-terminal house idiom (sharp corners, mono, gold), mirroring ShopSuccessModal's portal/esc/scroll-lock.
export function ShopAmountModal({
  item,
  display_name,
  max_qty,
  on_confirm,
  on_close,
}: {
  item: { item_template_id: string; category: string; price_mist: bigint }
  display_name: string
  max_qty: number
  on_confirm: (qty: number) => void
  on_close: () => void
}) {
  const { t } = useTranslation()
  const template_slug = slugs[display_name]
  const icon_slug = cosmetic_icon_of({ slug: template_slug, name: display_name }) ?? template_slug ?? ''
  const cap = Math.max(1, Math.floor(max_qty))
  const [qty, set_qty] = useState(1)

  // Escape-to-close + lock body scroll while open (mirrors ShopSuccessModal / AddFundsModal).
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', on_key)
      document.body.style.overflow = prev
    }
  }, [on_close])

  const clamp = (n: number) => Math.max(1, Math.min(cap, Math.floor(n) || 1))
  const total_mist = item.price_mist * BigInt(qty)

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) on_close()
      }}
    >
      <div
        className="bg-surface border border-border w-full max-w-sm mx-4"
        style={{ animation: 'modal-enter 0.3s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-gold text-[13px] tracking-[0.2em] uppercase font-semibold">{t('shop.amount_title')}</h2>
          <button
            type="button"
            onClick={on_close}
            className="cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
            aria-label="Close"
          >
            <X size={16} className="text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <ItemImage id={icon_slug} category={item.category} className="w-12 h-12 object-contain shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-gradient text-[12px] tracking-[0.15em] uppercase font-semibold truncate">
                {display_name}
              </span>
              <span className="text-muted text-[9px] tracking-[0.15em] uppercase">
                {t('shop.amount_available', { count: cap })}
              </span>
            </div>
          </div>

          {/* Stepper + MAX */}
          <div className="flex items-center gap-2">
            <span className="text-muted text-[9px] tracking-[0.16em] uppercase flex-1">
              {t('shop.amount_quantity')}
            </span>
            <button
              type="button"
              className="btn-outline w-9 h-9 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={qty <= 1}
              onClick={() => set_qty((q) => clamp(q - 1))}
              aria-label="Decrease"
            >
              <Minus size={13} />
            </button>
            <input
              inputMode="numeric"
              value={qty}
              onChange={(e) => set_qty(clamp(Number(e.target.value.replace(/[^0-9]/g, '')) || 1))}
              className="template-input w-16 text-center tabular-nums"
              style={{ fontSize: 13, letterSpacing: '0.08em', padding: '6px' }}
              aria-label={t('shop.amount_quantity')}
            />
            <button
              type="button"
              className="btn-outline w-9 h-9 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={qty >= cap}
              onClick={() => set_qty((q) => clamp(q + 1))}
              aria-label="Increase"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="btn-outline px-3 h-9 text-[9px] tracking-[0.16em] uppercase disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={qty >= cap}
              onClick={() => set_qty(cap)}
            >
              {t('shop.amount_max')}
            </button>
          </div>

          {/* Live total = N × price */}
          <div
            className="flex items-center justify-between border border-gold/25 px-4 py-3"
            style={{ background: 'rgba(200,150,60,0.05)' }}
          >
            <span className="text-muted text-[9px] tracking-[0.2em] uppercase">{t('shop.amount_total')}</span>
            <span className="text-gold text-[14px] tracking-[0.08em] tabular-nums font-semibold">
              {format_mist_to_sui(total_mist, 2)} <span className="text-[10px]">SUI</span>
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn-outline flex-1 py-2.5 text-[10px] tracking-[0.2em] cursor-pointer"
              onClick={on_close}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-gold flex-1 py-2.5 text-[10px] tracking-[0.2em] cursor-pointer"
              onClick={() => on_confirm(clamp(qty))}
            >
              {t('shop.amount_confirm', { count: qty })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
