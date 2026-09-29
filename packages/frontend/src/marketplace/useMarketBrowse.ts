// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { max_level as character_max_level, pet_max_feeds } from '@aresrpg/immutable'
import { market_category } from '@aresrpg/protocol'
import { useEffect, useMemo, useState } from 'react'

import { content_catalog } from '../content/catalog.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { market_categories, type MarketGroup } from '../modules/marketplace.ts'

import { useMarketState, useMarketAccount, useMarketDispatch } from './MarketSource.tsx'
import { displayed_listings, market_page_ready } from './browse_cache.ts'
import { browse_types, cheapest_offers } from './browse_types.ts'
import { legal_lot } from './marketplace_model.tsx'

export const useMarketBrowse = () => {
  const localized_numbers = useNumbers()
  const ui = useText()
  const characteristics_notes: Readonly<Partial<Record<string, string>>> = {
    pet: ui('encyclopedia_page.pet_full_fed_note', { count: pet_max_feeds }),
  }
  const market = useMarketState()
  const dispatch_app = useMarketDispatch()
  const account = useMarketAccount()
  const address = account.wallet?.address ?? null
  const balance = account.sui_balance_mist
  const [search, set_search] = useState('')
  const [minimum_level, set_minimum_level] = useState('')
  const [maximum_level, set_maximum_level] = useState('')
  const [character_class, set_character_class] = useState<string | null>(null)
  const listings = displayed_listings(market).filter(legal_lot)
  const ready = market_page_ready(market)
  const character_listings = useMemo(() => {
    const minimum = Number(minimum_level) || 0
    const maximum = Number(maximum_level) || Number.POSITIVE_INFINITY
    return listings.filter(
      (listing) =>
        listing.kind === 'character' &&
        listing.level >= minimum &&
        listing.level <= maximum &&
        (!character_class || listing.classe === character_class)
    )
  }, [character_class, listings, maximum_level, minimum_level])
  const subcategories = market_categories(market.group).filter((category) =>
    content_catalog.items.some((item) => item.category === category)
  )
  const active_subcategory = market_category(market.observation)
  const types = useMemo(
    () => browse_types(market.types, listings, active_subcategory, search),
    [market.types, listings, active_subcategory, search]
  )
  const active_type = market.observation?.kind === 'offers' ? market.observation.item_type : null
  const selected = types.find(({ item_type }) => item_type === active_type) ?? null
  const asks = selected ? cheapest_offers(selected.rows) : []
  useEffect(() => {
    if (market.group !== 'CHARACTERS') return
    dispatch_app({
      type: 'market/characters_filtered',
      classe: character_class ?? undefined,
      min_level: minimum_level ? Math.min(character_max_level, Math.max(1, Number(minimum_level))) : undefined,
      max_level: maximum_level ? Math.min(character_max_level, Math.max(1, Number(maximum_level))) : undefined,
    })
  }, [market.group, character_class, minimum_level, maximum_level, dispatch_app])
  const item = active_type ? (content_catalog.item(active_type)?.item ?? null) : null

  const select_group = (group: MarketGroup): void => {
    set_search('')
    dispatch_app({ type: 'market/group_selected', group })
  }

  return {
    localized_numbers,
    ui,
    characteristics_notes,
    market,
    address,
    balance,
    search,
    set_search,
    minimum_level,
    set_minimum_level,
    maximum_level,
    set_maximum_level,
    character_class,
    set_character_class,
    listings,
    ready,
    character_listings,
    subcategories,
    active_subcategory,
    types,
    active_type,
    selected,
    asks,
    item,
    select_group,
  }
}
