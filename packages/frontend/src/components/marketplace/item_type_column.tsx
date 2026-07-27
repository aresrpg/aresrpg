// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ItemImage } from '../items'

import type { MarketplaceTypeBucket } from './marketplace_model'
import { marketplace_item_icon } from './marketplace_icon'

// The per-template picker ("Lorito Cloak (Sapphire)") was a top TAB over the detail
// pane; it becomes the THIRD browse column — Category → Subcategory → THIS item-type list → the listings.
// House idiom (the subcategory column's twin): compact, monospace, uppercase, gold left-accent on the
// active row, zero border-radius. NO rarity/quality tint (dead concept) — the old tab coloured
// each row by quality_color; that is intentionally gone. The search moved here (it filters THIS list).
type ItemTypeColumnProps = {
  types: MarketplaceTypeBucket[]
  selected_template_id: string | null
  search: string
  mobile: boolean
  on_pick: (template_id: string) => void
  on_search: (search: string) => void
}

export function ItemTypeColumn({
  types,
  selected_template_id,
  search,
  mobile,
  on_pick,
  on_search,
}: ItemTypeColumnProps) {
  const { t } = useTranslation()

  return (
    <aside
      data-marketplace-item-type-column
      className={`app-mobile-stack__rail flex flex-col min-h-0 border-r border-border ${mobile ? 'w-full' : 'w-56 shrink-0'}`}
    >
      {/* Search — the item-type filter (moved off the now-compact subcategory column). Same cascade-safe
          padding pattern the encyclopedia inputs use (padding-left:36px, never a `pl-*` utility). */}
      <div className="relative p-2 border-b border-border shrink-0">
        <Search
          size={14}
          aria-hidden="true"
          className="absolute left-5 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none"
        />
        <input
          value={search}
          onChange={(event) => on_search(event.target.value)}
          className="template-input w-full"
          aria-label={t('common.search')}
          placeholder={t('common.search') as string}
          style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', paddingLeft: 36 }}
        />
      </div>

      <nav
        data-marketplace-template-options
        aria-label={t('marketplace.select_item')}
        className="app-mobile-chip-row flex flex-col flex-1 min-h-0 overflow-y-auto"
      >
        {types.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-5 text-muted">
            <span className="text-[8px] tracking-[0.15em] uppercase">{t('marketplace.no_results')}</span>
          </div>
        ) : (
          types.map((type, index) => {
            const is_selected = selected_template_id === type.template_id
            // #1227 — the row's own icon, resolved through the ONE marketplace icon home off the bucket's
            // already-joined asset_slug (browse_panel's all_types builder — catalog slug → item slug → id).
            const icon = marketplace_item_icon({
              slug: type.asset_slug,
              name: type.catalog_name || type.name,
              slot_category: type.classification_item_type,
            })
            return (
              <button
                data-marketplace-template-option={type.template_id}
                key={type.template_id}
                type="button"
                className={`flex items-center gap-2.5 px-4 py-2.5 text-left border-l-2 shrink-0 ${mobile ? 'min-w-max' : 'w-full'}`}
                style={{
                  borderLeftColor: is_selected ? '#c8963c' : 'transparent',
                  background: is_selected
                    ? 'rgba(200,150,60,0.08)'
                    : index % 2 === 1
                      ? 'rgba(255,255,255,0.018)'
                      : 'transparent',
                }}
                aria-pressed={is_selected}
                onClick={() => on_pick(type.template_id)}
              >
                <ItemImage
                  id={icon.id}
                  image_url={icon.image_url ?? undefined}
                  appearance={type.appearance}
                  category={type.classification_item_type}
                  className="w-6 h-6 shrink-0"
                />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span
                    className={`text-[9px] tracking-[0.1em] uppercase truncate w-full ${is_selected ? 'text-gold' : 'text-muted'}`}
                  >
                    {type.name}
                  </span>
                  <span className="flex items-center justify-between gap-3 w-full text-[8px] tracking-[0.08em] uppercase text-muted/45">
                    {/* Hide the level entirely at 0/absent — cosmetics carry no level. */}
                    {type.level > 0 ? <span>{t('entity.level_short', { level: type.level })}</span> : <span />}
                    <span>{t('marketplace.listed', { count: type.listings.length })}</span>
                  </span>
                </div>
              </button>
            )
          })
        )}
      </nav>
    </aside>
  )
}
