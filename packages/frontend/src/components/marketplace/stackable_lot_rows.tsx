// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import type { MarketplaceListing } from '../../types/chain'
import { format_mist_to_sui } from '../../utils/sui_mist'
import {
  marketplace_buyer_total_mist,
  marketplace_purchase_balance_state,
  type MarketplacePurchaseBalanceState,
} from '../../utils/marketplace_purchase'

import {
  confirm_marketplace_lot_ask,
  marketplace_available_lot_ask,
  marketplace_lot_offers,
  type MarketplaceLotSize,
} from './marketplace_model'

export function LotPurchaseConfirmation({
  listing,
  size,
  royalty_min_mist,
  purchase_state,
  busy,
  on_confirm,
  on_cancel,
}: {
  listing: MarketplaceListing
  size: MarketplaceLotSize
  royalty_min_mist: bigint
  purchase_state: MarketplacePurchaseBalanceState
  busy: boolean
  on_confirm: () => void
  on_cancel: () => void
}) {
  const { t } = useTranslation()
  const ask_mist = BigInt(listing.price_mist)
  const buyer_total_mist = marketplace_buyer_total_mist(ask_mist, royalty_min_mist)

  return (
    <div
      data-marketplace-buy-confirm
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-border bg-gold/[0.06]"
    >
      <span className="text-[9px] tracking-[0.14em] uppercase text-muted">
        {t('marketplace.lots.confirm_lot', { count: size })}
      </span>
      <span className="text-[8px] tracking-[0.1em] uppercase text-muted/70 tabular-nums">
        {t('marketplace.lots.ask_total', { price: format_mist_to_sui(ask_mist, 2) })}
      </span>
      <span className="text-[10px] tracking-[0.1em] uppercase text-cyan tabular-nums">
        {t('marketplace.lots.wallet_total', {
          price: format_mist_to_sui(buyer_total_mist, 2),
        })}
      </span>
      <span className="flex-1 min-w-2" />
      <button
        type="button"
        disabled={busy || purchase_state !== 'ready'}
        onClick={on_confirm}
        className="btn-gold inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] tracking-[0.16em] uppercase disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : null}
        {t(
          purchase_state === 'insufficient_balance'
            ? 'marketplace.purchase.insufficient_balance'
            : 'marketplace.lots.confirm_buy'
        )}
      </button>
      <button
        type="button"
        onClick={on_cancel}
        className="text-[9px] uppercase tracking-[0.15em] text-muted border border-border px-2 py-1.5 hover:text-text transition-colors cursor-pointer"
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}

export function StackableLotRows({
  listings,
  address,
  balance_mist,
  busy,
  royalty_min_mist,
  on_buy,
}: {
  listings: MarketplaceListing[]
  address: string | null
  balance_mist: bigint | null
  busy: boolean
  royalty_min_mist: bigint | null
  on_buy: (listing: MarketplaceListing) => void
}) {
  const { t } = useTranslation()
  const offers = useMemo(() => marketplace_lot_offers(listings), [listings])
  const [armed_size, set_armed_size] = useState<MarketplaceLotSize | null>(null)
  const armed = offers.find((offer) => offer.size === armed_size) ?? null
  const armed_ask = marketplace_available_lot_ask(armed?.asks ?? [], address)

  return (
    <div data-marketplace-lot-market className="flex flex-col">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border">
        {offers.map((offer) => {
          const ask = marketplace_available_lot_ask(offer.asks, address)
          const is_armed = armed_size === offer.size
          const buyer_total_mist =
            ask && royalty_min_mist != null
              ? marketplace_buyer_total_mist(BigInt(ask.price_mist), royalty_min_mist)
              : null
          const purchase_state = ask
            ? marketplace_purchase_balance_state(balance_mist, BigInt(ask.price_mist), royalty_min_mist)
            : 'unknown'
          return (
            <div
              key={offer.size}
              data-marketplace-listing-row
              data-lot-size={offer.size}
              className="flex flex-col gap-2 min-w-0 p-3 bg-surface"
            >
              <button
                data-marketplace-buy-button
                type="button"
                disabled={!ask || busy || purchase_state !== 'ready'}
                aria-expanded={is_armed}
                onClick={() => {
                  if (purchase_state === 'ready') set_armed_size(offer.size)
                }}
                className="btn-gold flex flex-col items-center justify-center gap-1 min-h-16 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-[11px] tracking-[0.18em] uppercase">×{offer.size}</span>
                <span className="text-[9px] tracking-[0.08em] tabular-nums">
                  {ask
                    ? purchase_state === 'insufficient_balance'
                      ? t('marketplace.purchase.insufficient_balance')
                      : buyer_total_mist == null
                        ? '—'
                        : t('marketplace.lots.cheapest_price', {
                            price: format_mist_to_sui(buyer_total_mist, 2),
                          })
                    : t('marketplace.lots.none_listed')}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      {armed_ask && armed && royalty_min_mist != null && (
        <LotPurchaseConfirmation
          listing={armed_ask}
          size={armed.size}
          royalty_min_mist={royalty_min_mist}
          purchase_state={marketplace_purchase_balance_state(
            balance_mist,
            BigInt(armed_ask.price_mist),
            royalty_min_mist
          )}
          busy={busy}
          on_confirm={() => confirm_marketplace_lot_ask(armed.asks, address, on_buy)}
          on_cancel={() => set_armed_size(null)}
        />
      )}

      <div data-marketplace-ask-ladder className="flex flex-col border-t border-border">
        <span className="px-4 py-2 text-[8px] tracking-[0.18em] uppercase text-muted">
          {t('marketplace.lots.ask_ladder')}
        </span>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border">
          {offers.map((offer) => (
            <div key={offer.size} className="flex flex-col gap-1 p-2 bg-surface text-[8px] tabular-nums text-muted">
              <span className="text-gold/80 tracking-[0.12em]">×{offer.size}</span>
              {offer.asks.length === 0 ? (
                <span>{t('marketplace.lots.none_listed')}</span>
              ) : (
                offer.asks.slice(0, 3).map((ask) => {
                  const buyer_total_mist =
                    royalty_min_mist == null
                      ? null
                      : marketplace_buyer_total_mist(BigInt(ask.price_mist), royalty_min_mist)
                  return (
                    <span key={ask.id}>
                      {buyer_total_mist == null ? '—' : format_mist_to_sui(buyer_total_mist, 2)} SUI
                    </span>
                  )
                })
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
