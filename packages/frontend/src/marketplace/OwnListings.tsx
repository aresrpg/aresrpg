// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { Search, Store } from 'lucide-react'
import type { ItemCategory } from '@aresrpg/immutable'

import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { MARKET_GROUPS, market_categories, type MarketGroup } from '../modules/marketplace.ts'

import { MarketCategoryIcon } from './MarketCategoryIcon.tsx'
import { useMarketState } from './MarketSource.tsx'
import { OwnListingStack } from './OwnListingStack.tsx'
import { own_listing_stacks } from './own_listing_stacks.ts'
import { CategoryName, listing_name } from './marketplace_model.tsx'

export const OwnListings = ({ text }: Readonly<{ text: CopyText }>) => {
  const market = useMarketState()
  const localized_numbers = useNumbers()
  const [query, set_query] = useState('')
  const [group, set_group] = useState<MarketGroup | ''>('')
  const filtered = market.own_listings.filter(
    (listing) =>
      listing_name(listing).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (!group ||
        (group === 'CHARACTERS'
          ? listing.kind === 'character'
          : market_categories(group).includes(listing.category as ItemCategory)))
  )
  const sections = group
    ? [[null, filtered] as const]
    : [...Map.groupBy(filtered, ({ kind, category }) => (kind === 'character' ? null : category))]
  return (
    <section
      className="market-own-listings flex min-h-0 min-w-0 flex-col bg-surface"
      aria-label={text('your_listings')}
    >
      <h3 className="market-panel-title">
        <Store size={16} aria-hidden="true" />
        {text('your_listings')}
        <span className="market-count">{localized_numbers.number(market.own_listings.length)}</span>
      </h3>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 border border-border bg-bg px-3 text-muted">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            className="h-11 min-w-0 w-full bg-transparent text-xs text-text outline-none"
            aria-label={text('search')}
            placeholder={text('search')}
            value={query}
            onChange={(event) => set_query(event.target.value)}
          />
        </label>
        <select
          aria-label={text('browse')}
          className="h-11 max-w-full border border-border bg-surface-high px-3 text-xs text-text"
          value={group}
          onChange={(event) => set_group(event.target.value as MarketGroup | '')}
        >
          <option value="">{text('filter_all')}</option>
          {MARKET_GROUPS.map((value) => (
            <option key={value} value={value}>
              {text(`group_${value.toLowerCase()}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="market-own-listings-scroll min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <PanelEmpty text={text(market.own_listings.length ? 'filter_empty' : 'no_listings')} />
        ) : (
          sections.map(([category, listings]) => (
            <section key={category ?? 'characters'}>
              {!group && (
                <h4 className="market-listing-section-title">
                  <MarketCategoryIcon category={category ?? 'CHARACTERS'} />
                  <span>{category ? <CategoryName category={category} /> : text('characters')}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </h4>
              )}
              <div className="market-own-listings-grid">
                {own_listing_stacks(listings).map((stack) => (
                  <OwnListingStack key={stack.key} listings={stack.listings} text={text} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  )
}

const PanelEmpty = ({ text }: Readonly<{ text: string }>) => (
  <p className="p-8 text-center text-xs text-muted">{text}</p>
)
