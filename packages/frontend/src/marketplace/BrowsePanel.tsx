// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  MarketAskItem,
  MarketAskList,
  MarketAskRow,
  MarketBrowse,
  MarketCharacterBrowse,
  MarketCount,
  MarketEmpty,
  MarketItemBrowse,
  MarketItemDetail,
  MarketItemSummary,
  MarketLotColumns,
  MarketLotTable,
  type MarketFilter,
} from '@aresrpg/ui'
import { class_names, item_is_stackable, marketplace_lot_sizes, type ItemCategory } from '@aresrpg/immutable'
import { has_market_page, type ListingRow, type MarketTypeCounts } from '@aresrpg/protocol'
import { Search, Store } from 'lucide-react'

import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { ItemSnapshotTooltip, useItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { market_categories, MARKET_GROUPS, type MarketGroup } from '../modules/marketplace.ts'
import { useAppStore } from '../store.ts'

import { useMarketCapabilities, useMarketDispatch, useMarketCraftSession } from './MarketSource.tsx'
import { useMarketBrowse } from './useMarketBrowse.ts'
import { MarketCapitalization } from './MarketCapitalization.tsx'
import {
  buyer_total,
  CategoryName,
  listing_art,
  listing_name,
  ListingIcon,
  offer_purchase,
  short_address,
} from './marketplace_model.tsx'
import { MarketCategoryIcon } from './MarketCategoryIcon.tsx'
import { PriceHistoryChart } from './PriceHistoryChart.tsx'

const group_key = (group: MarketGroup): string => `group_${group.toLowerCase()}`

const TypeCount = ({
  counts,
  categories,
}: Readonly<{ counts: MarketTypeCounts | null; categories: readonly ItemCategory[] }>) => {
  const numbers = useNumbers()
  const text = useText()
  if (!counts || !categories.length) return null
  return (
    <MarketCount
      title={text('marketplace_page.type_count_hint')}
      value={numbers.number(categories.reduce((total, category) => total + (counts[category] ?? 0), 0))}
    />
  )
}

type Offers = Readonly<{
  address: string | null
  balance: bigint | null
  pending: string | null
  ready: boolean
  text: CopyText
}>

const CharacterOffers = ({ listings, ...offers }: Offers & Readonly<{ listings: readonly ListingRow[] }>) =>
  listings.length === 0 ? (
    <MarketEmpty text={offers.text('no_results')} Icon={Store} />
  ) : (
    listings.map((listing, index) => <AskRow {...offers} index={index} key={listing.id} listing={listing} />)
  )

export const BrowsePanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const browse = useMarketBrowse()
  const {
    ui,
    market,
    address,
    balance,
    search,
    set_search,
    pet_food_only,
    set_pet_food_only,
    minimum_level,
    set_minimum_level,
    maximum_level,
    set_maximum_level,
    character_class,
    set_character_class,
    ready,
    character_listings,
    subcategories,
    active_subcategory,
    types,
    active_type,
    select_group,
  } = browse
  const offers = { address, balance, pending: market.pending, ready, text }
  const { characters } = useMarketCapabilities()
  const traded = MARKET_GROUPS.filter((group) => characters || group !== 'CHARACTERS')
  const groups: readonly MarketFilter[] = traded.map((group) => ({
    key: group,
    label: text(group_key(group)),
    glyph: <MarketCategoryIcon category={group} />,
    count: <TypeCount counts={market.type_counts} categories={market_categories(group)} />,
    pressed: market.group === group,
    select: () => select_group(group),
  }))
  const paged = has_market_page(market.observation) && (market.page_cursors.length > 0 || market.next_cursor)

  return (
    <ItemDetailContext.Provider value="summary">
      <MarketBrowse
        label={text('browse')}
        groups={groups}
        pager={
          paged
            ? {
                label: text('browse'),
                previous: {
                  label: text('previous_page'),
                  disabled: !market.page_cursors.length,
                  go: () => dispatch_app({ type: 'market/page_requested', direction: 'previous' }),
                },
                next: {
                  label: text('next_page'),
                  disabled: !market.next_cursor,
                  go: () => dispatch_app({ type: 'market/page_requested', direction: 'next' }),
                },
              }
            : null
        }
      >
        {market.group === 'CHARACTERS' ? (
          <MarketCharacterBrowse
            labels={{ level: text('level'), class: text('class') }}
            minimum={{
              placeholder: ui('encyclopedia_page.minimum'),
              value: minimum_level,
              change: (value) => set_minimum_level(value.replace(/\D/g, '')),
            }}
            maximum={{
              placeholder: ui('encyclopedia_page.maximum'),
              value: maximum_level,
              change: (value) => set_maximum_level(value.replace(/\D/g, '')),
            }}
            classes={class_names.map((classe) => ({
              key: classe,
              label: classe,
              pressed: character_class === classe,
              toggle: () => set_character_class((current) => (current === classe ? null : classe)),
            }))}
          >
            <CharacterOffers {...offers} listings={character_listings} />
          </MarketCharacterBrowse>
        ) : (
          <MarketItemBrowse
            subcategories={subcategories.map((category) => ({
              key: category,
              label: <CategoryName category={category} />,
              glyph: <MarketCategoryIcon category={category} />,
              count: <TypeCount counts={market.type_counts} categories={[category]} />,
              pressed: category === active_subcategory,
              select: () => {
                set_pet_food_only(false)
                dispatch_app({ type: 'market/group_selected', group: market.group, category })
              },
            }))}
            search={{ Icon: Search, placeholder: text('search'), value: search, change: set_search }}
            pet_food={{
              hidden: active_subcategory !== 'resource',
              label: ui('encyclopedia_page.group_pet_food_resources'),
              pressed: pet_food_only,
              toggle: () => {
                set_pet_food_only(!pet_food_only)
                dispatch_app({ type: 'market/group_selected', group: market.group, category: 'resource' })
              },
            }}
            templates={types.map(({ item_type, name }) => ({
              key: item_type,
              name,
              art: listing_art({ kind: 'item', item_type, classe: undefined }),
              pressed: item_type === active_type,
              select: () => {
                if (active_subcategory)
                  dispatch_app({
                    type: 'market/group_selected',
                    group: market.group,
                    category: active_subcategory,
                    item_type,
                  })
              },
            }))}
          >
            <SelectedItem {...offers} browse={browse} />
          </MarketItemBrowse>
        )}
      </MarketBrowse>
    </ItemDetailContext.Provider>
  )
}

const SelectedItem = ({ browse, ...offers }: Offers & Readonly<{ browse: ReturnType<typeof useMarketBrowse> }>) => {
  const { text } = offers
  const craft_session = useMarketCraftSession()
  const { localized_numbers, ui, characteristics_notes, selected, asks, item, active_type } = browse
  if (!selected) return <MarketEmpty text={text('select_item')} Icon={Store} />
  return (
    <MarketItemDetail
      selection={{
        art: listing_art({ kind: 'item', item_type: active_type, classe: undefined }),
        name: selected.name,
        level: selected.level > 0 ? ui('encyclopedia_page.level_short', { level: selected.level }) : null,
        price: asks[0] ? localized_numbers.sui(buyer_total(BigInt(asks[0].price_mist)), 2) : null,
      }}
    >
      {item && (
        <MarketItemSummary
          sheet={
            <ItemDetailView
              craft_session={craft_session}
              category={item.category}
              damages={item.damages ?? []}
              item_type={item.item_type}
              labels={{
                characteristics: text('characteristics'),
                characteristics_note: characteristics_notes[item.category],
                damages: text('damages'),
                level_short: ui('encyclopedia_page.level_short', { level: item.level }),
                range_to: text('range_to'),
              }}
              level={item.level}
              name={item.name}
              stats={item.stats}
            >
              <ConsumableEffectSection
                consumable={item.consumable}
                text={(key, values) => ui(`encyclopedia_page.${key}`, values)}
              />
            </ItemDetailView>
          }
          aside={<MarketCapitalization item_type={item.item_type} text={text} />}
        />
      )}
      {item_is_stackable(selected.category ?? '') ? (
        <MarketLotColumns
          ready={offers.ready}
          lots={<CheapestLotMarket {...offers} asks={asks} sizes={marketplace_lot_sizes} />}
          chart={<PriceHistoryChart item_type={active_type!} key={active_type} text={text} />}
        />
      ) : (
        <MarketAskList ready={offers.ready}>
          {asks.map((listing, index) => (
            <AskRow {...offers} index={index} key={listing.id} listing={listing} />
          ))}
        </MarketAskList>
      )}
    </MarketItemDetail>
  )
}

const CheapestLotMarket = ({
  address,
  asks,
  balance,
  pending,
  ready,
  sizes,
  text,
}: Offers & Readonly<{ asks: readonly ListingRow[]; sizes: readonly number[] }>) => {
  const dispatch_app = useMarketDispatch()
  const localized_numbers = useNumbers()
  return (
    <MarketLotTable
      labels={{ lot_size: text('lot_size'), price: text('price'), buy: text('buy') }}
      lots={sizes
        .map((size) => ({ size, ask: asks.find(({ amount }) => amount === size) ?? null }))
        .map(({ size, ask }) => {
          const purchase = offer_purchase(ask, address, balance, pending)
          return {
            key: ask?.id ?? `empty_${size}`,
            size,
            total: purchase.total === null ? null : localized_numbers.sui(purchase.total, 2),
            action: purchase.label === null ? '—' : text(purchase.label),
            disabled: !ready || !purchase.enabled,
            buy: () => {
              if (ready && ask) dispatch_app({ type: 'market/buy_requested', listing: ask })
            },
          }
        })}
    />
  )
}

const AskRow = ({
  address,
  balance,
  index,
  listing,
  pending,
  ready,
  text,
}: Offers & Readonly<{ index: number; listing: ListingRow }>) => {
  const dispatch_app = useMarketDispatch()
  const localized_numbers = useNumbers()
  const ui = useText()
  const purchase = offer_purchase(listing, address, balance, pending)
  return (
    <MarketAskRow
      index={index}
      icon={listing.kind === 'item' ? <ItemAskIcon listing={listing} /> : <ListingIcon listing={listing} size={34} />}
      seller={
        listing.kind === 'character'
          ? {
              label: text('seller'),
              name: listing.name,
              level: ui('encyclopedia_page.level_short', { level: listing.level }),
              classe: listing.classe ?? '—',
              address: short_address(listing.seller),
            }
          : null
      }
      price={{ label: text('price'), value: localized_numbers.sui(purchase.total!, 2) }}
      action={{
        label: text(purchase.label!),
        disabled: !ready || !purchase.enabled,
        buy: () => {
          if (ready && purchase.enabled) dispatch_app({ type: 'market/buy_requested', listing })
        },
      }}
    />
  )
}

const ItemAskIcon = ({ listing }: Readonly<{ listing: ListingRow }>) => {
  const copy = useAppStore((state) => state.copy)
  const item_hover = useItemDetailHover({
    ...listing,
    item_type: listing.item_type ?? '',
    category: listing.category ?? '',
  })
  return (
    <MarketAskItem
      id={listing.id}
      label={listing_name(listing)}
      art={listing_art(listing)}
      open={item_hover.open}
      close={item_hover.close}
      tooltip={copy && <ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />}
    />
  )
}
