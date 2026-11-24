// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One item on the market page: its price, its chart, its cheapest offers and its sheet. One Buy takes the cheapest
// offer through the marketplace's one buy flow. Every region keeps its box while its data is on the way.
import { item_is_stackable, marketplace_lot_sizes, pet_max_feeds } from '@aresrpg/immutable'
import type { ListingRow, MarketQuote } from '@aresrpg/protocol'
import type { SeedItem } from '@aresrpg/sdk/seed'
import { Button, MarketAskList, MarketEmpty } from '@aresrpg/ui'
import { ArrowLeft, BookOpen, Store } from 'lucide-react'
import type { ReactNode } from 'react'

import { NewTabLink } from '../components/links.tsx'
import { docs_path } from '../docs/routes.ts'
import type { CopyText } from '../i18n/copy.ts'
import { useText } from '../i18n/useText.ts'
import { SITE_ADDRESSES } from '../site/routes.ts'
import { SiteLink } from '../site/SiteShell.tsx'
import { dispatch_app, useSiteStore } from '../store.ts'

import { displayed_listings } from './browse_cache.ts'
import { MarketCapitalization } from './MarketCapitalization.tsx'
import { cheapest_offers, unit_price_sui } from './market_browse.ts'
import { CheapestLotMarket, AskRow, MarketItemSheet, useOffers, type Offers } from './MarketOffers.tsx'
import { ItemArt, Pending, PriceChange, SuiPrice } from './MarketParts.tsx'
import { legal_lot, offer_purchase, useCategoryLabel } from './marketplace_model.tsx'
import { PriceHistoryChart } from './PriceHistoryChart.tsx'

/** How many offer rows the list keeps room for before the offers arrive. */
const OFFER_SLOTS = 3
const SECTION = 'flex min-w-0 flex-col gap-4 rounded-ui border border-line bg-surface-raised p-4'

const MarketBack = () => {
  const ui = useText()
  return (
    <SiteLink
      className="inline-flex min-h-11 items-center gap-1.5 self-start font-bold text-muted hover:text-text"
      href={SITE_ADDRESSES.market}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {ui('site.market')}
    </SiteLink>
  )
}

const Figure = ({ label, children }: Readonly<{ label: string; children: ReactNode }>) => (
  <span className="flex min-h-13 flex-col gap-1">
    <small className="font-mono text-[11px] leading-[normal] font-bold tracking-widest text-muted uppercase">
      {label}
    </small>
    {children}
  </span>
)

/** Unique copies list each cheapest offer with its own sheet on hover; stackable items show one row per lot size,
 *  a dash where none is offered. The list keeps the room of three rows; an item nobody offers says so inside it. */
const CheapestOffers = ({
  offers,
  stackable,
  asks,
}: Readonly<{ offers: Offers; stackable: boolean; asks: readonly ListingRow[] }>) => {
  if (stackable)
    return (
      <div aria-busy={!offers.ready}>
        <CheapestLotMarket {...offers} asks={asks} sizes={marketplace_lot_sizes} />
      </div>
    )
  const rows = () => {
    if (asks.length > 0)
      return asks.map((listing, index) => <AskRow {...offers} index={index} key={listing.id} listing={listing} />)
    if (offers.ready) return <MarketEmpty text={offers.text('no_results')} Icon={Store} />
    return Array.from({ length: OFFER_SLOTS }, (_, index) => (
      <span className="aui-skeleton aui-skeleton--block mb-1 min-h-13" key={index} />
    ))
  }
  return (
    <div className="min-h-42 [&_.market-ask]:mb-1 [&_.market-ask]:min-h-13">
      <MarketAskList ready={offers.ready}>{rows()}</MarketAskList>
    </div>
  )
}

/** The one Buy of the page: the cheapest offer, through the marketplace's one buy flow. */
const BuyCheapest = ({
  cheapest,
  offers,
  stackable,
}: Readonly<{ cheapest: ListingRow | null; offers: Offers; stackable: boolean }>) => {
  const purchase = offer_purchase(cheapest, offers.address, offers.balance, offers.pending)
  const lot = stackable && cheapest ? ` ×${cheapest.amount}` : ''
  return (
    <Button
      className="min-h-11 px-4"
      tone="primary"
      disabled={!offers.ready || !purchase.enabled}
      onClick={() => {
        if (cheapest) dispatch_app({ type: 'market/buy_requested', listing: cheapest })
      }}
    >
      {offers.text(purchase.label ?? 'buy')}
      {lot}
    </Button>
  )
}

/** An item nobody offers has no price: the figure says so instead of waiting for one. */
const ItemPrice = ({
  quote,
  none,
  text,
}: Readonly<{ quote: MarketQuote | undefined; none: boolean; text: CopyText }>) => {
  if (none) return <span className="text-xs/normal text-muted">{text('no_results')}</span>
  return quote ? <SuiPrice sui={unit_price_sui(quote)} size="text-[26px]/8" /> : <Pending size="h-8 w-30" />
}

const ItemPage = ({ item, text }: Readonly<{ item: SeedItem; text: CopyText }>) => {
  const ui = useText()
  const category = useCategoryLabel()
  const offers = useOffers(text)
  const market = useSiteStore(({ marketplace }) => marketplace)
  const asks = cheapest_offers(
    displayed_listings(market).filter((listing) => listing.item_type === item.item_type && legal_lot(listing))
  )
  const stackable = item_is_stackable(item.category)
  const quote = market.types?.find((row) => row.item_type === item.item_type)?.quote
  // Nobody offers this item right now: no price, and the offers list says why.
  const none = offers.ready && asks.length === 0
  const note = item.category === 'pet' ? ui('encyclopedia_page.pet_full_fed_note', { count: pet_max_feeds }) : undefined
  return (
    <article className="flex min-w-0 flex-col gap-5">
      <MarketBack />
      <header className="market-item-head flex flex-wrap items-center gap-x-7 gap-y-4 rounded-ui border border-line px-5 py-4.5">
        <ItemArt
          className="grid size-21 flex-none place-items-center *:max-h-full *:max-w-full *:drop-shadow-[0_8px_10px_#0008]"
          item_type={item.item_type}
        />
        <div className="min-w-0 flex-[1_1_220px]">
          <span className="truncate font-mono text-[11px]/4 font-bold tracking-[0.06em] text-gold uppercase">
            {category(item.category)} · {ui('encyclopedia_page.level_short', { level: item.level })}
          </span>
          <h1 className="mt-1 font-title text-[length:clamp(24px,3.4vw,36px)]/[1.1] font-bold wrap-anywhere">
            {item.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <Figure label={text('price')}>
            <ItemPrice quote={quote} none={none} text={text} />
          </Figure>
          <Figure label={text('change_24h')}>
            <PriceChange change_bps={quote?.change_bps} size="text-lg/8" />
          </Figure>
        </div>
        <div className="flex flex-wrap gap-2">
          <NewTabLink
            className="aui-button min-h-11 px-4"
            href={docs_path('items', item.item_type)}
            new_tab={ui('site.new_tab')}
          >
            <BookOpen size={16} aria-hidden="true" />
            {ui('encyclopedia')}
          </NewTabLink>
          <BuyCheapest cheapest={asks[0] ?? null} offers={offers} stackable={stackable} />
        </div>
      </header>
      <PriceHistoryChart item_type={item.item_type} key={item.item_type} text={text} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-6">
        <section className={SECTION}>
          <h2 className="font-mono text-[11px] leading-[normal] font-bold tracking-[0.12em] text-gold uppercase">
            {text('cheapest_offers')}
          </h2>
          <CheapestOffers asks={asks} offers={offers} stackable={stackable} />
        </section>
        <section className={SECTION}>
          <MarketItemSheet item={item} note={note} text={text} />
          <MarketCapitalization item_type={item.item_type} text={text} />
        </section>
      </div>
    </article>
  )
}

/** An item's page; an address that names no item says there is nothing to show. */
export const MarketItem = ({ item, text }: Readonly<{ item: SeedItem | undefined; text: CopyText }>) =>
  item ? (
    <ItemPage item={item} text={text} />
  ) : (
    <div className="flex min-w-0 flex-col gap-5">
      <MarketBack />
      <MarketEmpty text={text('no_results')} Icon={Store} />
    </div>
  )
