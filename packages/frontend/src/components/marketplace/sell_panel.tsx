// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Tag } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { use_auth } from '../../auth'
import { use_template_t } from '../../i18n/template_t'
import { use_marketplace_chain, type ListableItem, type ListableCharacter } from '../../stores/marketplace_chain'
import { parse_2_decimal_sui, format_mist_to_sui } from '../../utils/sui_mist'
import { get_level } from '../../experience'
import { class_color } from '../../constants/class_colors'

import { InventoryPanel } from './inventory_panel'
import { MyLotsPanel } from './my_lots_panel'
import { SellItemHeader } from './sell_item_header'
import {
  marketplace_lot_sizes_for_owned_quantity,
  marketplace_lot_offers,
  visible_marketplace_listings,
  type MarketplaceLotSize,
} from './marketplace_model'

// SELL tab — the THREE-COLUMN layout (D35 amendment), L→R:
//   1. YOUR LISTINGS  — your active kiosk listings + a danger-outline DELIST.
//   2. SET-PRICE CARD — the middle form (kept as-is): price input + LIST FOR SALE. Populated by the inventory pick.
//   3. INVENTORY      — the aggregated sellable grid (+ the CHARACTERS sub-category, DECISIONS 07-09).
// Shared selection/price state lives HERE so the grid (col 3) and the card (col 2) stay in sync — the list happens
// in the card, no modal/picker. STACKABLES use native kiosk listings in forced 1/10/100/1000 lots and expose only
// sizes covered by the owned balance. Characters list exactly like items (§17.30 mirrored where known).
// All writes ride the OPTIMISTIC store.

// §17.30 — characters list on the market from level 30 (enforced on-chain at purchase; mirrored here).
const CHARACTER_LIST_MIN_LEVEL = 30

export function SellPanel() {
  const { t } = useTranslation()
  const tt = use_template_t()
  const address = use_auth((s) => s.address)
  const { listings, templates_item, submit_listing, submit_delist, busy } = use_marketplace_chain()
  const submit_list_character = use_marketplace_chain((s) => s.submit_list_character)
  const load_listable = use_marketplace_chain((s) => s.load_listable)

  // LAZY own-kiosk-bag sweep (S-87, /v1/owner-items + /v1/characters?owner=): fires ONLY when the SELL tab is
  // actually open (this panel mounts only then) — never on the buy-path load — and the store caches it per
  // session, so tab-toggling never re-sweeps. STORM FIX: same ref idiom as shop.tsx's `reload_claims_ref` —
  // depend on the STABLE `address` only (not the zustand action, which never actually re-fires the effect
  // itself, but the SAME defensive shape the pet-claims lane established); the real double-fire this closes
  // is React StrictMode's dev-only double-mount racing two concurrent loads past `load_listable`'s own cache
  // guard (closed at the store level too — see marketplace_chain.ts).
  const load_listable_ref = useRef(load_listable)
  load_listable_ref.current = load_listable

  useEffect(() => {
    load_listable_ref.current()
  }, [address])

  const [selected, set_selected] = useState<ListableItem | null>(null)
  const [selected_char, set_selected_char] = useState<ListableCharacter | null>(null)
  const [price, set_price] = useState('')
  const [price_error, set_price_error] = useState(false)
  const [lot_size, set_lot_size] = useState<MarketplaceLotSize>(1)

  function template_of(identity: string) {
    const exact = templates_item.find((template: any) => template.template_id === identity)
    const candidates = exact ? [] : templates_item.filter((template: any) => template.id === identity)
    return exact ?? (candidates.length === 1 ? candidates[0] : null)
  }

  function name_of(identity: string, fallback: string): string {
    const tmpl = template_of(identity)
    return (tmpl ? tt(tmpl, 'name') : '') || fallback
  }

  // Toggle-select from the inventory grid → populate the middle card (reset the form on every change).
  // Item and character picks are mutually exclusive — the card renders exactly one.
  function on_select(it: ListableItem) {
    set_selected((cur) => (cur?.id === it.id ? null : it))
    set_selected_char(null)
    set_price('')
    set_price_error(false)
    set_lot_size(1)
  }

  function on_select_character(c: ListableCharacter) {
    set_selected_char((cur) => (cur?.id === c.id ? null : c))
    set_selected(null)
    set_price('')
    set_price_error(false)
  }

  // The only icon fact this panel derives locally: the AUTHORED catalog identity of the picked item (#1296).
  // The fallback chain itself lives in marketplace_listing_icon_slug — SellItemHeader calls it, this panel
  // never re-implements it.
  const selected_template = selected ? template_of(selected.template_id ?? selected.slug) : null
  const catalog_name = String(selected_template?.name ?? '')
  const catalog_slug = catalog_name ? slugs[catalog_name] : undefined

  const selected_identity = selected ? (selected.template_id ?? selected.id) : null
  const available_lot_sizes = marketplace_lot_sizes_for_owned_quantity(selected?.quantity ?? 0)
  const ladder = useMemo(
    () =>
      marketplace_lot_offers(
        visible_marketplace_listings(listings).filter(
          (listing) => !selected_identity || listing.item.template_id === selected_identity
        )
      ),
    [listings, selected_identity]
  )
  // The selected stackable row is the aggregated template balance. Live object selection belongs to the
  // compose edge, where the shared covering selector sees fresh kiosk custody.
  const listing_item = selected
  const can_list = !!listing_item && !busy && !!price.trim()

  // OPTIMISTIC list — validate the price, fire it; the card clears + the row appears in col 1 instantly.
  function do_list() {
    if (!listing_item) return
    let price_mist: bigint
    try {
      price_mist = parse_2_decimal_sui(price.trim())
    } catch {
      set_price_error(true)
      return
    }
    submit_listing(listing_item, price_mist, selected?.stackable ? lot_size : undefined)
    set_selected(null)
    set_price('')
  }

  // Character listing — same card, same flow (§17.30 level gate mirrored on the button).
  const char_level = selected_char ? get_level(selected_char.experience) : 0
  const can_list_char = !!selected_char && char_level >= CHARACTER_LIST_MIN_LEVEL && !busy && !!price.trim()

  function do_list_character() {
    if (!selected_char) return
    let price_mist: bigint
    try {
      price_mist = parse_2_decimal_sui(price.trim())
    } catch {
      set_price_error(true)
      return
    }
    submit_list_character(selected_char, price_mist)
    set_selected_char(null)
    set_price('')
  }

  return (
    <div className="flex flex-col lg:flex-row flex-1 min-h-0">
      {/* ── COL 1 — YOUR LISTINGS ── */}
      <MyLotsPanel listings={listings} address={address} busy={busy} on_delist={submit_delist} name_of={name_of} />

      {/* ── COL 2 — SET-PRICE CARD (kept as-is) ── */}
      <div className="flex flex-col w-full lg:w-[340px] lg:min-w-[340px] border-b lg:border-b-0 lg:border-r border-border lg:min-h-0 lg:overflow-y-auto">
        <div className="px-4 pt-3 pb-2 shrink-0">
          <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
            {t('marketplace.list_for_sale')}
          </span>
        </div>

        {selected_char ? (
          // ── CHARACTER card — identical listing flow (§17.30 level-30 gate mirrored) ──
          <div
            className="mx-4 mb-3 p-3 border border-border flex flex-col gap-2.5"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 shrink-0 flex items-center justify-center border"
                style={{
                  borderColor: `${class_color(selected_char.classe)}66`,
                  background: `${class_color(selected_char.classe)}22`,
                }}
              >
                <span
                  className="text-[10px] uppercase font-semibold"
                  style={{ color: class_color(selected_char.classe) }}
                >
                  {(selected_char.classe || '?').slice(0, 2)}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-text text-[11px] tracking-[0.12em] uppercase font-semibold truncate">
                  {selected_char.name}
                </span>
                <span className="text-muted text-[8px] tracking-[0.1em] uppercase">
                  Lv. {char_level} &middot; {selected_char.classe}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted text-[8px] tracking-[0.2em] uppercase">{t('marketplace.price_label')}</span>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  inputMode="decimal"
                  className="template-input flex-1"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => {
                    set_price(e.target.value)
                    set_price_error(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && can_list_char) do_list_character()
                  }}
                  style={{ fontSize: 12, letterSpacing: '0.1em' }}
                />
                <span className="text-cyan text-[10px] tracking-[0.2em] uppercase font-semibold">SUI</span>
              </div>
            </div>

            {price_error && (
              <span className="text-red-400 text-[8px] tracking-[0.1em] uppercase">
                {t('marketplace.price_required')}
              </span>
            )}
            {char_level < CHARACTER_LIST_MIN_LEVEL && (
              <span className="text-amber-400 text-[8px] tracking-[0.1em] uppercase">
                {t('marketplace.characters.level_gate', { level: CHARACTER_LIST_MIN_LEVEL })}
              </span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!can_list_char}
                onClick={do_list_character}
                className="btn-gold flex-1 py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('marketplace.list_for_sale')}
              </button>
              <button
                type="button"
                onClick={() => set_selected_char(null)}
                className="btn-outline py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase cursor-pointer"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center text-muted">
            <Tag size={18} style={{ opacity: 0.15 }} />
            <span className="text-[9px] tracking-[0.15em] uppercase">{t('marketplace.select_to_list')}</span>
          </div>
        ) : selected.stackable ? (
          // ── STACKABLE → native kiosk lot listing ──
          <div
            className="mx-4 mb-3 p-3 border border-border flex flex-col gap-2.5"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <SellItemHeader
              item={selected}
              catalog_name={catalog_name}
              catalog_slug={catalog_slug}
              display_name={name_of(selected.template_id ?? selected.slug, selected.name)}
              subtitle={t('marketplace.lots.inventory_total', { count: selected.quantity })}
            />

            {available_lot_sizes.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted text-[8px] tracking-[0.2em] uppercase">
                  {t('marketplace.lots.choose_size')}
                </span>
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${available_lot_sizes.length}, minmax(0, 1fr))` }}
                >
                  {available_lot_sizes.map((size) => {
                    const offer = ladder.find((row) => row.size === size)
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => set_lot_size(size)}
                        className={`flex flex-col items-center gap-0.5 border px-1 py-1.5 text-[9px] tabular-nums ${
                          lot_size === size ? 'border-gold text-gold bg-gold/10' : 'border-border text-muted'
                        }`}
                      >
                        <span>×{size}</span>
                        {offer?.cheapest ? (
                          <span className="text-[7px]">
                            {format_mist_to_sui(BigInt(offer.cheapest.price_mist), 2)} SUI
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-muted text-[8px] tracking-[0.2em] uppercase">{t('marketplace.price_label')}</span>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  className="template-input flex-1"
                  placeholder="0.00"
                  value={price}
                  onChange={(event) => {
                    set_price(event.target.value)
                    set_price_error(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && can_list) do_list()
                  }}
                  style={{ fontSize: 12, letterSpacing: '0.1em' }}
                />
                <span className="text-cyan text-[10px] tracking-[0.2em] uppercase font-semibold">SUI</span>
              </div>
            </div>

            {price_error && (
              <span className="text-red-400 text-[8px] tracking-[0.1em] uppercase">
                {t('marketplace.price_required')}
              </span>
            )}
            <span className="text-muted/70 text-[8px] tracking-[0.08em]">
              {t('marketplace.lots.paid_automatically')}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!can_list}
                onClick={do_list}
                className="btn-gold flex-1 py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('marketplace.lots.list_lot', { count: lot_size })}
              </button>
              <button
                type="button"
                onClick={() => set_selected(null)}
                className="btn-outline py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase cursor-pointer"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="mx-4 mb-3 p-3 border border-border flex flex-col gap-2.5"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <SellItemHeader
              item={selected}
              catalog_name={catalog_name}
              catalog_slug={catalog_slug}
              display_name={name_of(selected.template_id ?? selected.slug, selected.name)}
              subtitle={
                <>
                  {selected.category} &middot; Lv. {selected.level}
                  {selected.quantity > 1 ? ` · ×${selected.quantity}` : ''}
                </>
              }
            />

            <div className="flex flex-col gap-1">
              <span className="text-muted text-[8px] tracking-[0.2em] uppercase">{t('marketplace.price_label')}</span>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  inputMode="decimal"
                  className="template-input flex-1"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => {
                    set_price(e.target.value)
                    set_price_error(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && can_list) do_list()
                  }}
                  style={{ fontSize: 12, letterSpacing: '0.1em' }}
                />
                <span className="text-cyan text-[10px] tracking-[0.2em] uppercase font-semibold">SUI</span>
              </div>
            </div>

            {price_error && (
              <span className="text-red-400 text-[8px] tracking-[0.1em] uppercase">
                {t('marketplace.price_required')}
              </span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!can_list}
                onClick={do_list}
                className="btn-gold flex-1 py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('marketplace.list_for_sale')}
              </button>
              <button
                type="button"
                onClick={() => set_selected(null)}
                className="btn-outline py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase cursor-pointer"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── COL 3 — INVENTORY (characters sub-category + aggregated item grid) ── */}
      <div className="flex flex-col flex-1 lg:min-h-0">
        <InventoryPanel
          selected_id={selected?.id ?? null}
          on_select={on_select}
          selected_character_id={selected_char?.id ?? null}
          on_select_character={on_select_character}
        />
      </div>
    </div>
  )
}
