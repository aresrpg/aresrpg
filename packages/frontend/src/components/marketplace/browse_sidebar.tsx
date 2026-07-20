import { Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_KEYS,
  marketplace_has_subcategories,
  marketplace_item_type_key,
  type MarketplaceCategory,
  type MarketplaceItemTypeBucket,
} from './marketplace_model'

type BrowseSidebarProps = {
  active_category: MarketplaceCategory
  active_item_type: string | null
  category_counts: Map<MarketplaceCategory, number>
  item_types: MarketplaceItemTypeBucket[]
  mobile: boolean
  on_category: (category: MarketplaceCategory) => void
  on_item_type: (item_type: string) => void
}

function item_type_fallback(item_type: string): string {
  return item_type.replace(/_/g, ' ')
}

// The browse rail is now FOUR columns — this component owns the first two:
// (1) the general-category column, always compact; (2) the subcategory column, also compact, RENDERED
// ONLY when the category actually divides into more than one bucket (marketplace_has_subcategories) — a
// lone "pet > pet" self-bucket is noise, so the column vanishes. The per-template item-type list (col 3)
// and the listings (col 4) live in BrowsePanel. The item-search moved to col 3 (it filters that list).
export function BrowseSidebar({
  active_category,
  active_item_type,
  category_counts,
  item_types,
  mobile,
  on_category,
  on_item_type,
}: BrowseSidebarProps) {
  const { t } = useTranslation()
  const active_category_label = t(MARKETPLACE_CATEGORY_KEYS[active_category])
  const show_subcategory = active_category !== 'CHARACTERS' && marketplace_has_subcategories(item_types)

  return (
    <aside
      data-marketplace-browse-sidebar
      className={`app-mobile-stack__rail flex flex-col min-h-0 border-r border-border ${mobile ? 'w-full' : 'shrink-0'}`}
    >
      <div className="px-4 py-3 border-b border-border shrink-0">
        <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
          {t('marketplace.browse_title')}
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav
          data-marketplace-general-categories
          className="app-mobile-chip-row w-36 shrink-0 min-h-0 overflow-y-auto border-r border-border"
          aria-label={t('marketplace.browse_title')}
        >
          {MARKETPLACE_CATEGORIES.map((category) => {
            const is_active = active_category === category
            return (
              <button
                key={category}
                type="button"
                className={`flex items-center justify-between gap-2 w-full px-3 py-3 text-left border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase whitespace-nowrap cursor-pointer transition-colors ${
                  is_active ? 'text-gold bg-gold/[0.05]' : 'text-muted hover:text-gold hover:bg-gold/[0.025]'
                }`}
                aria-current={is_active ? 'page' : undefined}
                onClick={() => on_category(category)}
              >
                <span className="truncate">{t(MARKETPLACE_CATEGORY_KEYS[category])}</span>
                {category !== 'CHARACTERS' && (
                  <span className="text-[8px] text-muted/50 tabular-nums">{category_counts.get(category) ?? 0}</span>
                )}
              </button>
            )
          })}
        </nav>

        {show_subcategory && (
          <div
            data-marketplace-item-types
            className={`flex flex-col min-h-0 ${mobile ? 'flex-1 min-w-0' : 'w-40 shrink-0'}`}
          >
            <nav className="app-mobile-chip-row flex-1 min-h-0 overflow-y-auto" aria-label={active_category_label}>
              {item_types.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-5 text-muted">
                  <Store size={13} className="opacity-25" />
                  <span className="text-[8px] tracking-[0.15em] uppercase">{t('marketplace.no_results')}</span>
                </div>
              ) : (
                item_types.map(({ item_type, listing_count }, index) => {
                  const is_active = active_item_type === item_type
                  return (
                    <button
                      data-marketplace-item-type={item_type}
                      key={item_type}
                      type="button"
                      className="flex items-center justify-between gap-3 w-full px-4 py-2.5 text-left border-l-2"
                      style={{
                        borderLeftColor: is_active ? '#c8963c' : 'transparent',
                        background: is_active
                          ? 'rgba(200,150,60,0.08)'
                          : index % 2 === 1
                            ? 'rgba(255,255,255,0.018)'
                            : 'transparent',
                      }}
                      aria-current={is_active ? 'true' : undefined}
                      onClick={() => on_item_type(item_type)}
                    >
                      <span
                        className={`text-[9px] tracking-[0.1em] uppercase truncate ${
                          is_active ? 'text-gold' : 'text-muted'
                        }`}
                      >
                        {t(marketplace_item_type_key(item_type), item_type_fallback(item_type))}
                      </span>
                      <span className="text-[8px] text-muted/50 tabular-nums shrink-0">{listing_count}</span>
                    </button>
                  )
                })
              )}
            </nav>
          </div>
        )}
      </div>
    </aside>
  )
}
