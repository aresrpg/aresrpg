// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Store } from 'lucide-react'

import { get_characters, get_listings } from '../../rpc/client'
import { useRpcView } from '../../rpc/use_view'
import { RpcStale } from '../../rpc/RpcStale'
import { use_auth } from '../../auth'
import { use_marketplace_chain } from '../../stores/marketplace_chain'
import { format_mist_to_sui } from '../../utils/sui_mist'
import {
  MARKETPLACE_ROYALTY_MIN_MIST,
  marketplace_buyer_total_mist,
  marketplace_purchase_balance_state,
} from '../../utils/marketplace_purchase'
import { class_color, CLASS_COLORS } from '../../constants/class_colors'
import { ChipRow } from '../chip_row'
import { useAddressNames } from '../../rpc/use_address_names'

import { MarketplaceListingRow } from './marketplace_listing_row'

// BUY → CHARACTERS category (DECISIONS 07-09 "marketplace real-page shots APPROVED"): characters are a simple
// CATEGORY beside Equipment/Pets/…, with LEVEL + CLASS filter chips GATED TO THIS CATEGORY ONLY (the QTY_STEPS
// chip pattern from the old StackableLine, reused verbatim as ChipRow). Rows come from the RPC listings view
// (category "character") short-polled per the UI-DATA LAW, class-enriched from /v1/characters; `level` is null
// until object-snapshot indexing lands — rendered honestly as "—" and exempt from level-band filtering only
// when no band is active. BUY arms the same in-place confirm as items; PAY fires the real purchase
// (write_listings.buy_character resolves the Character policy's four rules; §17.30's level-30 gate is enforced
// on-chain at purchase — a below-gate buy aborts loudly through the one toast funnel).

// S-56 #2: the fixed 12-class roster — mirrors LEVEL_BANDS as a STATIC option set (never data-derived), so the
// chip row is stable and always visible like LEVEL, instead of disappearing in the empty state (was computed
// from whatever classes happened to be currently listed, so it vanished with zero listings and would still
// have shuffled/incomplete options with some).
const ALL_CLASSES = Object.keys(CLASS_COLORS)

type CharacterRow = {
  item_id: string
  kiosk_id: string
  name: string | null
  level: number | null
  price_mist: string
  seller: string
  class: string | null
}

export function CharactersPanel() {
  const { t } = useTranslation()
  const address = use_auth((s) => s.address)
  const balance_mist = use_auth((s) => s.sui_balance_mist)
  const submit_buy_character = use_marketplace_chain((s) => s.submit_buy_character)
  const busy = use_marketplace_chain((s) => s.busy)
  // Owner standing ask (DECISIONS 07-10): LEVEL filter = min/max INPUTS, not band chips. Empty = unbounded
  // on that end; kept as strings (digit-sanitized) so a half-typed bound never coerces to NaN mid-edit.
  const [min_level, set_min_level] = useState('')
  const [max_level, set_max_level] = useState('')
  const [klass, set_klass] = useState<string | null>(null)
  const [confirm_id, set_confirm_id] = useState<string | null>(null)

  // Listings (category "character") + class enrichment off the character docs, one atomic fetcher.
  const view = useRpcView<CharacterRow[]>(
    async (signal) => {
      const page = await get_listings({ category: 'character', limit: 200 }, signal)
      const ids = page.listings.map((l) => l.item_id)
      const chars = ids.length ? await get_characters({ ids }, signal) : []
      const class_of = new Map(chars.map((c) => [c.id, c.class]))
      return page.listings.map((l) => ({
        item_id: l.item_id,
        kiosk_id: l.kiosk_id,
        name: l.name,
        level: l.level,
        price_mist: l.price_mist,
        seller: l.seller,
        class: class_of.get(l.item_id) ?? null,
      }))
    },
    { deps: [] }
  )

  const rows = view.data ?? []

  const filtered = useMemo(() => {
    let out = rows
    const lo = min_level === '' ? null : Number(min_level)
    const hi = max_level === '' ? null : Number(max_level)
    // A listed character with null level (pending object-snapshot indexing) is excluded once a bound is set —
    // it can't be proven in-range, and faking it in would be dishonest.
    if (lo != null) out = out.filter((r) => r.level != null && r.level >= lo)
    if (hi != null) out = out.filter((r) => r.level != null && r.level <= hi)
    if (klass) out = out.filter((r) => r.class === klass)
    return out
  }, [rows, min_level, max_level, klass])
  const seller_names = useAddressNames(filtered.map((row) => row.seller))

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* LEVEL + CLASS chips — gated to this category only (never rendered on item categories) */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-border shrink-0">
        <div className="flex flex-col gap-1.5">
          <span className="text-[8px] tracking-[0.16em] uppercase text-muted">{t('marketplace.filter_level')}</span>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={min_level}
              onChange={(e) => set_min_level(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label={t('marketplace.level_min')}
              className="template-input tabular-nums"
              style={{ width: 62, fontSize: 11, letterSpacing: '0.06em', padding: '5px 8px', textAlign: 'center' }}
            />
            <span className="text-muted text-[11px]">–</span>
            <input
              inputMode="numeric"
              value={max_level}
              onChange={(e) => set_max_level(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label={t('marketplace.level_max')}
              className="template-input tabular-nums"
              style={{ width: 62, fontSize: 11, letterSpacing: '0.06em', padding: '5px 8px', textAlign: 'center' }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[8px] tracking-[0.16em] uppercase text-muted">{t('marketplace.filter_class')}</span>
          <ChipRow options={ALL_CLASSES} active={klass} on_pick={set_klass} />
        </div>
        <span className="ml-auto">
          <RpcStale stale={view.stale} offline={view.error != null && view.data == null} />
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted">
          <Store size={18} style={{ opacity: 0.15 }} />
          <span className="text-[9px] tracking-[0.2em] uppercase">
            {view.loading ? t('common.loading') : t('marketplace.no_results')}
          </span>
        </div>
      ) : (
        filtered.map((row, idx) => {
          const color = class_color(row.class)
          const is_own = !!address && row.seller === address
          const armed = confirm_id === row.item_id
          const price_mist = BigInt(row.price_mist)
          const buyer_total_mist =
            MARKETPLACE_ROYALTY_MIN_MIST == null
              ? null
              : marketplace_buyer_total_mist(price_mist, MARKETPLACE_ROYALTY_MIN_MIST)
          const price_label = buyer_total_mist == null ? '—' : `${format_mist_to_sui(buyer_total_mist, 2)} SUI`
          const purchase_state = marketplace_purchase_balance_state(balance_mist, price_mist)
          return (
            <MarketplaceListingRow
              key={row.item_id}
              seller_address={row.seller}
              seller_name={seller_names[row.seller]}
              item_name={row.name ?? t('marketplace.unnamed_character')}
              price_label={price_label}
              own={is_own}
              armed={armed}
              purchase_state={purchase_state}
              busy={busy}
              alternate={idx % 2 === 0}
              visual={
                <>
                  {/* Class-colored portrait swatch (no character art on-chain yet — honest placeholder). */}
                  <div
                    className="w-8 h-8 shrink-0 flex items-center justify-center border"
                    style={{ borderColor: `${color}66`, background: `${color}22` }}
                  >
                    <span className="text-[8px] uppercase font-semibold" style={{ color }}>
                      {(row.class ?? '?').slice(0, 2)}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[11px] text-text font-semibold truncate">
                      {row.name ?? t('marketplace.unnamed_character')}
                    </span>
                    <span className="text-[9px] tracking-[0.1em] uppercase text-muted">
                      Lv. {row.level ?? '—'} &middot; {row.class ?? '—'}
                    </span>
                  </div>
                </>
              }
              on_arm={() => set_confirm_id(row.item_id)}
              on_confirm={() => {
                submit_buy_character(row)
                set_confirm_id(null)
              }}
              on_cancel={() => set_confirm_id(null)}
            />
          )
        })
      )}
    </div>
  )
}
