// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { MarketOwnListings } from '@aresrpg/ui'
import { Search, Store } from 'lucide-react'
import type { ItemCategory } from '@aresrpg/immutable'

import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { MARKET_GROUPS, market_categories, type MarketGroup } from '../modules/marketplace.ts'
import { useSiteStore } from '../store.ts'

import { MarketCategoryIcon } from './MarketCategoryIcon.tsx'
import { OwnListingStack } from './OwnListingStack.tsx'
import { own_listing_stacks } from './own_listing_stacks.ts'
import { listing_name, useCategoryLabel } from './marketplace_model.tsx'

export const OwnListings = ({ text }: Readonly<{ text: CopyText }>) => {
  const market = useSiteStore(({ marketplace }) => marketplace)
  const localized_numbers = useNumbers()
  const [query, set_query] = useState('')
  const [group, set_group] = useState<MarketGroup | ''>('')
  const category_label = useCategoryLabel()
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
    <MarketOwnListings
      labels={{ title: text('your_listings'), search: text('search') }}
      Icons={{ title: Store, search: Search }}
      count={localized_numbers.number(market.own_listings.length)}
      query={{ value: query, change: set_query }}
      filter={{
        label: text('browse'),
        all: text('filter_all'),
        value: group,
        options: MARKET_GROUPS.map((value) => ({ value, label: text(`group_${value.toLowerCase()}`) })),
        change: (value) => set_group(value as MarketGroup | ''),
      }}
      empty={filtered.length === 0 ? text(market.own_listings.length ? 'filter_empty' : 'no_listings') : null}
      sections={sections.map(([category, listings]) => ({
        key: category ?? 'characters',
        title: group
          ? null
          : {
              glyph: <MarketCategoryIcon category={category ?? 'CHARACTERS'} />,
              label: category ? category_label(category) : text('characters'),
            },
        stacks: own_listing_stacks(listings).map((stack) => (
          <OwnListingStack key={stack.key} listings={stack.listings} text={text} />
        )),
      }))}
    />
  )
}
