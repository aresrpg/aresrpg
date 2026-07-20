// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D50 — the "you're broke" pre-validation card. Shown INSTEAD of the paid character-create flow when
// the connected wallet can't cover the price + gas headroom. It never attempts a doomed mint tx and
// never toasts an error — it just explains the shortfall and offers ADD FUNDS. The gate that decides to
// mount this (CharactersDrawer) only fires for a SELF-PAID create: the FIRST character is free/sponsored,
// so a fresh low-SUI zkLogin user forging their first one never sees this. ADD FUNDS opens the EXISTING
// fund-wallet UI (open_fund_wallet) — the same modal the create flow's own on_fund route uses.
//
// Portalled to <body> so a single mount overlays BOTH CharactersDrawer variants (in-world drawer +
// companion page). Because <body> is outside the HUD token scopes, colors are the house palette hex
// (design canon) directly, not var(--…) tokens which wouldn't resolve here.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { open_fund_wallet } from '../../core/fund-modal.js'
import './create-broke-card.css'

/**
 * The shared "you're broke" pre-validation card. Character-create is the default caller; the shop reuses the
 * SAME card (the shared "you're broke" modal) via two optional overrides: `message_key` swaps the
 * create-flavored line for a purchase one, and `on_add_funds` routes ADD FUNDS to the caller's own fund UI
 * (the shop's AddFundsModal) instead of the global `open_fund_wallet` store.
 * @param {{
 *   price_sui: number,
 *   balance_mist: bigint | null,
 *   address: string | null,
 *   on_close: () => void,
 *   message_key?: string,
 *   on_add_funds?: () => void,
 * }} props
 */
export function CreateBrokeCard({
  price_sui,
  balance_mist,
  address,
  on_close,
  message_key = 'characters.broke.message',
  on_add_funds,
}) {
  const { t } = useTranslation()

  // Esc closes (mirrors the other HUD overlays / the fund modal).
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [on_close])

  const balance_sui = balance_mist == null ? 0 : Number(balance_mist) / 1e9
  // Surface the SAME figure the gate keys on: price + 0.2 SUI gas headroom.
  const needed_sui = price_sui + 0.2
  const fmt = (/** @type {number} */ n) => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

  const add_funds = () => {
    // Caller-supplied fund UI takes precedence (the shop hands its own AddFundsModal); otherwise reuse the
    // global fund-wallet modal (same as wallet_bar / the create flow's on_fund route).
    if (on_add_funds) on_add_funds()
    else open_fund_wallet({ address: address ?? '', required_sui: price_sui, balance_sui })
    on_close()
  }

  return createPortal(
    <div
      className="chr-broke"
      onClick={(e) => {
        if (e.target === e.currentTarget) on_close()
      }}
    >
      <div className="chr-broke__card" role="dialog" aria-modal="true">
        <div className="chr-broke__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
            <path d="M7 6h1v4" />
            <path d="m16.71 13.88.7.71-2.82 2.82" />
          </svg>
        </div>
        <h3 className="chr-broke__title">{t('characters.broke.title')}</h3>
        <p className="chr-broke__msg">{t(message_key, { needed: fmt(needed_sui) })}</p>
        <div className="chr-broke__meta">
          <span className="chr-broke__chip chr-broke__chip--low">
            <b>{t('characters.broke.balance')}</b>
            <span>
              {fmt(balance_sui)} {t('wallet.sui')}
            </span>
          </span>
          <span className="chr-broke__chip">
            <b>{t('characters.broke.price')}</b>
            <span>
              {fmt(price_sui)} {t('wallet.sui')}
            </span>
          </span>
        </div>
        <div className="chr-broke__actions">
          <button type="button" className="chr-broke__cancel" onClick={on_close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="chr-broke__fund" onClick={add_funds}>
            {t('wallet.add_funds')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
