// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Store } from 'lucide-react'
import { catalog, slugs } from 'virtual:item_catalog'

import type { MarketplaceListing } from '../../types/chain'
import { use_auth } from '../../auth'
import { use_template_t } from '../../i18n/template_t'
import { use_marketplace_chain } from '../../stores/marketplace_chain'
import { format_mist_to_sui } from '../../utils/sui_mist'
import { MARKETPLACE_ROYALTY_MIN_MIST, marketplace_purchase_balance_state } from '../../utils/marketplace_purchase'
import { app_mobile_classes, use_mobile_mode } from '../../game/screens/hud/mobile_layout.js'
import { ItemImage } from '../items'
import { ItemHoverTooltip } from '../item_hover_tooltip'
import { use_address_names } from '../../rpc/use_address_names'
import { STACKABLE_CATEGORIES } from '../../constants/item_categories'
import { make_catalog_lookup } from '../../pages/encyclopedia/item_catalog'

import { CharactersPanel } from './characters_panel'
import { BrowseSidebar } from './browse_sidebar'
import { ItemTypeColumn } from './item_type_column'
import { marketplace_item_icon, marketplace_listing_icon_slug } from './marketplace_icon'
import { LedgerItemCard } from './ledger_item_card'
import { MarketplaceListingRow } from './marketplace_listing_row'
import { StackableLotRows } from './stackable_lot_rows'
import { TemplateUnavailableCard } from './template_unavailable_card'
import {
  marketplace_category_of,
  marketplace_detail_item,
  marketplace_item_type_buckets,
  marketplace_types_for_item_type,
  visible_marketplace_listings,
  type MarketplaceCategory,
  type MarketplaceTypeBucket,
} from './marketplace_model'

// BUY remains a keyless /v1 listing browser with the same optimistic submit paths. Browse is a two-column IA:
// the seven MAIN categories stay in column one and the semantic seed-category/item-type buckets occupy column
// two. The right pane keeps template detail first (the shared encyclopedia ItemDetailView inside Ledger chrome),
// then live native-kiosk listing rows below. No template detail card owns a purchase control.

const catalog_for_name = make_catalog_lookup({ catalog, slugs })
export function BrowsePanel() {
  const { t } = useTranslation()
  const tt = use_template_t()
  const is_mobile = use_mobile_mode()
  const classes = app_mobile_classes(is_mobile)
  const address = use_auth((state) => state.address)
  const balance_mist = use_auth((state) => state.sui_balance_mist)
  const { listings, templates_item, submit_buy, busy } = use_marketplace_chain()
  const [active, set_active] = useState<MarketplaceCategory>('EQUIPMENT')
  const [active_item_type, set_active_item_type] = useState<string | null>(null)
  const [selected, set_selected] = useState<string | null>(null)
  const [confirm_id, set_confirm_id] = useState<string | null>(null)
  const [search, set_search] = useState('')
  const visible_listings = useMemo(() => visible_marketplace_listings(listings), [listings])

  const all_types = useMemo(() => {
    const template_candidates = new Map<string, any[]>()
    const template_by_id = new Map<string, any>()
    for (const template of templates_item) {
      const item_type = String(template.item_type || template.id)
      template_candidates.set(item_type, [...(template_candidates.get(item_type) ?? []), template])
      if (template.template_id) template_by_id.set(String(template.template_id), template)
    }
    const groups: Record<string, MarketplaceTypeBucket> = {}
    for (const listing of visible_listings) {
      const { template_id } = listing.item
      if (!template_id) continue
      const exact_template = template_by_id.get(template_id) ?? null
      const candidates = exact_template ? [] : (template_candidates.get(template_id) ?? [])
      const template: any = exact_template ?? (candidates.length === 1 ? candidates[0] : null)
      const catalog_name = template ? String(template.name || listing.item.name) : ''
      const catalog_entry = catalog_name ? catalog_for_name(catalog_name) : undefined
      const classification_item_type = catalog_entry?.item_type || template?.item_type || template_id
      const quantity = BigInt(listing.item.quantity || 1)
      const unit_price = BigInt(listing.price_mist || '0') / quantity
      if (!groups[template_id]) {
        groups[template_id] = {
          template_id,
          // #1227 — catalog slug (cosmetics, when the private seed catalog resolves) wins, else the listing's
          // OWN raw item_type slug (chain truth — always a valid item_icon_url key), else the template id
          // last resort. Before: template_id-only fallback 404'd every listing the private catalog missed
          // (i.e. almost everything non-cosmetic in production, where that catalog ships empty).
          asset_slug: marketplace_listing_icon_slug(listing.item, catalog_name && slugs[catalog_name]),
          classification_item_type,
          catalog_name,
          name: (template ? tt(template, 'name') : '') || listing.item.name,
          level: listing.item.level,
          category: listing.item.category,
          browse_category: String(template?.category || listing.item.category),
          rarity: listing.item.rarity,
          appearance: listing.item.appearance,
          stackable: STACKABLE_CATEGORIES.has(listing.item.category),
          total: 0,
          cheapest_unit: unit_price,
          listings: [],
          detail_resolved: !!template,
        }
      }
      const group = groups[template_id]
      group.listings.push(listing)
      group.total += listing.item.quantity
      if (unit_price < group.cheapest_unit) group.cheapest_unit = unit_price
    }
    return Object.values(groups).sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  }, [templates_item, tt, visible_listings])

  const category_counts = useMemo(() => {
    const counts = new Map<MarketplaceCategory, number>()
    for (const type of all_types) {
      const category = marketplace_category_of(type.browse_category, type.classification_item_type)
      counts.set(category, (counts.get(category) ?? 0) + type.listings.length)
    }
    return counts
  }, [all_types])

  const item_types = useMemo(
    () =>
      marketplace_item_type_buckets(
        [
          ...templates_item.map((template: any) => ({
            category: String(template.category || ''),
            item_type: String(template.item_type || ''),
          })),
          ...all_types.map((type) => ({
            category: type.browse_category,
            item_type: type.classification_item_type,
            listing_count: type.listings.length,
          })),
        ],
        active
      ),
    [active, all_types, templates_item]
  )

  const selected_item_type = useMemo(
    () =>
      item_types.some((bucket) => bucket.item_type === active_item_type)
        ? active_item_type
        : (item_types[0]?.item_type ?? null),
    [active_item_type, item_types]
  )

  const types = useMemo(
    () => marketplace_types_for_item_type(all_types, active, selected_item_type, search),
    [all_types, active, search, selected_item_type]
  )

  const selected_type = useMemo(
    () => types.find((type) => type.template_id === selected) ?? types[0] ?? null,
    [types, selected]
  )
  const selected_template = selected_type
    ? (templates_item.find(
        (template: any) => String(template.template_id ?? template.id) === selected_type.template_id
      ) ?? null)
    : null
  const listing_rows = useMemo(() => {
    if (!selected_type) return []
    return [...selected_type.listings].sort((left, right) => {
      const a = BigInt(left.price_mist || '0')
      const b = BigInt(right.price_mist || '0')
      return a < b ? -1 : a > b ? 1 : 0
    })
  }, [selected_type])
  const seller_names = use_address_names(listing_rows.map((listing) => listing.seller_sui_address))
  // ONE marketplace icon home (cosmetic-aware, the shop's resolver): the template header, the detail card,
  // and every listing row of the selected template share this — a listed cosmetic now shows its real art
  // instead of the 0x-object-id blank the old direct pass produced.
  const selected_icon = selected_type
    ? marketplace_item_icon({
        slug: selected_type.asset_slug,
        name: selected_type.catalog_name || selected_type.name,
        slot_category: selected_type.classification_item_type,
      })
    : null
  const detail = selected_type?.detail_resolved
    ? {
        ...marketplace_detail_item(
          selected_type,
          catalog_for_name(selected_type.catalog_name),
          selected_type.asset_slug
        ),
        id: selected_icon?.id,
        image_url: selected_icon?.image_url ?? undefined,
      }
    : null

  function pick_category(category: MarketplaceCategory) {
    set_active(category)
    set_active_item_type(null)
    set_selected(null)
    set_confirm_id(null)
    set_search('')
  }

  function pick_item_type(item_type: string) {
    set_active_item_type(item_type)
    set_selected(null)
    set_confirm_id(null)
    set_search('')
  }

  function pick_type(template_id: string) {
    set_selected(template_id)
    set_confirm_id(null)
  }

  function buy(listing: MarketplaceListing) {
    submit_buy(listing)
    set_confirm_id(null)
  }

  return (
    <div data-mobile-stack="chips" className={`${classes.stack} overflow-hidden`}>
      <BrowseSidebar
        active_category={active}
        active_item_type={selected_item_type}
        category_counts={category_counts}
        item_types={item_types}
        mobile={is_mobile}
        on_category={pick_category}
        on_item_type={pick_item_type}
      />

      {/* Column 3 — the per-template item-type list (was a top tab). Absent for CHARACTERS (the roster
          panel owns the whole detail area). Owns the item-search, which filters exactly this list. */}
      {active !== 'CHARACTERS' && (
        <ItemTypeColumn
          types={types}
          selected_template_id={selected_type?.template_id ?? null}
          search={search}
          mobile={is_mobile}
          on_pick={pick_type}
          on_search={set_search}
        />
      )}

      <section className="flex flex-col flex-1 min-w-0 min-h-0">
        {active === 'CHARACTERS' ? (
          <CharactersPanel />
        ) : !selected_type ? (
          <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
            <Store size={20} className="opacity-15" />
            <span className="text-[9px] tracking-[0.2em] uppercase">
              {selected_item_type ? t('marketplace.no_results') : t('marketplace.select_item')}
            </span>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Template header above the listings — icon + name + (level ONLY when real) + listing count.
                Icon + no "LV. 0" (regression guard); the per-template picker is now column 3. */}
            <div
              className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0"
              style={{ background: 'rgba(200,150,60,0.03)' }}
            >
              <ItemImage
                id={selected_icon?.id ?? ''}
                image_url={selected_icon?.image_url ?? undefined}
                appearance={selected_type.appearance}
                category={selected_type.classification_item_type}
                className="w-6 h-6 shrink-0"
              />
              <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-gradient">
                {selected_type.name}
              </span>
              {selected_type.level > 0 && (
                <span className="text-[8px] text-muted">{t('entity.level_short', { level: selected_type.level })}</span>
              )}
              <span className="text-[8px] text-muted ml-auto">
                {t('marketplace.listing', { count: listing_rows.length })}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 lg:p-4">
              <div className="flex flex-col gap-4 min-h-full">
                {detail ? (
                  <LedgerItemCard item={detail} />
                ) : (
                  <TemplateUnavailableCard item_type={selected_type.classification_item_type} />
                )}

                <div data-marketplace-listings className="border border-border">
                  <div
                    className="flex items-center px-4 py-2 border-b border-border"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    <span className="text-[8px] tracking-[0.18em] uppercase text-muted">
                      {t('marketplace.listing', { count: listing_rows.length })}
                    </span>
                  </div>

                  {selected_type.stackable ? (
                    <StackableLotRows
                      listings={listing_rows}
                      address={address}
                      balance_mist={balance_mist}
                      busy={busy}
                      royalty_min_mist={MARKETPLACE_ROYALTY_MIN_MIST}
                      on_buy={buy}
                    />
                  ) : (
                    listing_rows.map((listing, index) => {
                      const is_own = !!address && listing.seller_sui_address === address
                      const armed = confirm_id === listing.id
                      const price_mist = BigInt(listing.price_mist)
                      const price_label = `${format_mist_to_sui(price_mist, 2)} SUI`
                      const purchase_state = marketplace_purchase_balance_state(balance_mist, price_mist)
                      return (
                        <ItemHoverTooltip
                          key={listing.id}
                          item={{ ...listing.item, name: selected_type.name }}
                          template={selected_template}
                        >
                          {(handlers) => (
                            <MarketplaceListingRow
                              seller_address={listing.seller_sui_address}
                              seller_name={seller_names[listing.seller_sui_address]}
                              item_name={selected_type.name}
                              price_label={price_label}
                              quantity={listing.item.quantity}
                              visual={
                                <ItemImage
                                  id={selected_icon?.id ?? ''}
                                  image_url={selected_icon?.image_url ?? undefined}
                                  appearance={listing.item.appearance}
                                  category={selected_type.classification_item_type}
                                  className="w-8 h-8 shrink-0"
                                />
                              }
                              own={is_own}
                              armed={armed}
                              purchase_state={purchase_state}
                              busy={busy}
                              alternate={index % 2 === 0}
                              on_arm={() => set_confirm_id(listing.id)}
                              on_confirm={() => buy(listing)}
                              on_cancel={() => set_confirm_id(null)}
                              on_mouse_enter={(event) => {
                                handlers.onMouseEnter(event)
                                ;(event.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(200,150,60,0.15)'
                              }}
                              on_mouse_leave={(event) => {
                                handlers.onMouseLeave()
                                ;(event.currentTarget as HTMLElement).style.boxShadow = 'none'
                              }}
                            />
                          )}
                        </ItemHoverTooltip>
                      )
                    })
                  )}

                  {!selected_type.stackable && listing_rows.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-muted">
                      <span className="text-[9px] tracking-[0.2em] uppercase">{t('marketplace.no_results')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
