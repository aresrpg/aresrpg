// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The market page: browse every listed type, open an item, buy its cheapest offer, signed out included. Selling
// lives on the portfolio. Its first render has the final shape: the rail, the volumes, the spotlight and one shelf
// per item group are there at once, and the listed types fill them.
import type { ItemCategory } from '@aresrpg/immutable'
import type { MarketType } from '@aresrpg/protocol'
import { Button, MarketAskList, MarketListingIcon } from '@aresrpg/ui'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { items_by_type } from '../content/items.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { market_categories, MARKET_GROUPS, type MarketGroup } from '../modules/marketplace.ts'
import { market_item_of } from '../site/routes.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { displayed_listings } from './browse_cache.ts'
import {
  card_tone,
  FEATURED,
  group_chips,
  group_types,
  holds_cards,
  is_unique,
  ITEM_GROUPS,
  listed_type_count,
  market_subject,
  rarest_type,
  shows_heroes,
  unit_price_sui,
  view_types,
  type MarketView,
} from './market_browse.ts'
import { MarketItem } from './MarketItem.tsx'
import { CharacterOffers, useOffers } from './MarketOffers.tsx'
import { Choice, ItemArt, ItemLink, Pending, PriceChange, SuiPrice } from './MarketParts.tsx'
import { CategoryName, legal_lot, listing_art, MarketVolumeBadge, useCategoryLabel } from './marketplace_model.tsx'
import './market.css'

/** A shelf shows this many cards, a token table this many rows; waiting, a shelf shows this many cards. */
const SHELF_SIZE = 14
const TABLE_SIZE = 6
const WAITING_CARDS = 6

const group_key = (group: MarketGroup): string => `group_${group.toLowerCase()}`

/** A card's box, waiting or loaded: art, category, a two-line name, one price and one trend. */
const CARD =
  'flex h-(--market-card-h) min-w-0 flex-col gap-1 overflow-hidden rounded-ui border border-line bg-linear-to-b/srgb from-high to-surface-raised p-3.5 text-text max-[760px]:p-2.5'
const CARD_ART =
  'mb-1.5 grid h-(--market-card-art) flex-none place-items-center *:max-h-full *:w-[70%] *:max-w-31 *:object-contain *:drop-shadow-[0_8px_10px_#0008]'
const CARD_CATEGORY = 'truncate font-mono text-[11px]/4 font-bold tracking-[0.06em] text-gold uppercase'
const CARD_NAME = 'line-clamp-2 h-[2lh] text-base leading-tight font-bold wrap-anywhere max-[760px]:text-sm'
const CARD_FOOT =
  'mt-auto flex items-center justify-between gap-2 pt-1.5 text-[15px] whitespace-nowrap max-[760px]:text-[13px]'
/** A row of a token table: the item, its unit price, its trend and how many are listed. */
const TOKEN_ROW =
  'market-token grid grid-cols-[minmax(0,1fr)_140px_76px_90px] items-center gap-4 border-t border-hair px-4.5 py-2 first:border-t-0 max-[760px]:grid-cols-[minmax(0,1fr)_auto_64px] max-[760px]:gap-3 max-[760px]:px-3'
const RIGHT = 'justify-self-end text-right'
const WIDE = 'justify-self-end text-right max-[760px]:hidden'
const GRID =
  'market-grid grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-4 max-[760px]:grid-cols-2 max-[760px]:gap-3'
const SPOT =
  'market-spot grid h-(--market-spot-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-6 overflow-hidden rounded-ui border border-line p-[clamp(20px,3vw,32px)] max-[760px]:grid-cols-1'
const SPOT_TITLE = 'mt-2 line-clamp-2 font-title text-[length:clamp(28px,4vw,44px)]/[1.05] font-bold wrap-anywhere'
const SPOT_LINE = 'mt-2.5 mb-4.5 text-soft'
const SPOT_FOOT = 'flex min-h-11 flex-wrap items-center gap-x-4 gap-y-3 text-2xl/normal'
const EYEBROW = 'font-mono text-[11px] leading-[normal] font-bold tracking-[0.12em] text-gold uppercase'
const ARROW =
  'grid size-11 cursor-pointer place-items-center rounded-ui border border-line bg-surface-high text-soft hover:border-line-strong hover:text-text'

/** An item that exists as unique copies: art, category and level, its name, one price and one trend. */
const TypeCard = ({ row }: Readonly<{ row: MarketType }>) => {
  const category = useCategoryLabel()
  const ui = useText()
  return (
    <ItemLink
      className={`${CARD} market-card market-card--${card_tone(row.category) ?? 'plain'} transition-[translate,border-color] duration-180 ease-ui hover:-translate-y-[3px] hover:border-line-strong focus-visible:-translate-y-[3px] focus-visible:border-line-strong motion-reduce:transition-none`}
      item_type={row.item_type}
    >
      <ItemArt className={CARD_ART} item_type={row.item_type} />
      <span className={CARD_CATEGORY}>
        {category(row.category)} · {ui('encyclopedia_page.level_short', { level: row.level })}
      </span>
      <span className={CARD_NAME}>{row.name}</span>
      <span className={CARD_FOOT}>
        <SuiPrice sui={unit_price_sui(row.quote)} />
        <PriceChange change_bps={row.quote.change_bps} />
      </span>
    </ItemLink>
  )
}

/** The same card while the list is on its way: a skeleton line in each place. */
const WaitingCard = () => (
  <span className={CARD} aria-hidden="true">
    <ItemArt className={CARD_ART} item_type={null} />
    <span className={CARD_CATEGORY}>
      <Pending />
    </span>
    <span className={CARD_NAME}>
      <Pending />
    </span>
    <span className={CARD_FOOT}>
      <Pending />
    </span>
  </span>
)
const waiting_cards = () => Array.from({ length: WAITING_CARDS }, (_, index) => <WaitingCard key={index} />)

const TokenRow = ({ row }: Readonly<{ row: MarketType }>) => {
  const numbers = useNumbers()
  return (
    <ItemLink
      className={`${TOKEN_ROW} h-(--market-row-h) text-text hover:bg-hair focus-visible:bg-hair`}
      item_type={row.item_type}
    >
      <span className="flex min-w-0 items-center gap-3 font-bold">
        <MarketListingIcon art={listing_art({ kind: 'item', item_type: row.item_type, classe: undefined })} size={36} />
        <span className="truncate">{row.name}</span>
      </span>
      <span className={RIGHT}>
        <SuiPrice sui={unit_price_sui(row.quote)} />
      </span>
      <span className={RIGHT}>
        <PriceChange change_bps={row.quote.change_bps} />
      </span>
      <span className={WIDE}>{numbers.number(row.quote.units)}</span>
    </ItemLink>
  )
}

/** Stackable items trade like tokens: one row each, the price of one unit. Waiting, skeleton rows hold the room. */
const TokenTable = ({
  rows,
  waiting_rows,
  box = '',
  text,
}: Readonly<{ rows: readonly MarketType[] | null; waiting_rows: number; box?: string; text: CopyText }>) => (
  <div
    className={`overflow-hidden rounded-ui border border-line bg-linear-to-b/srgb from-high to-surface-raised ${box}`}
  >
    <div
      className={`${TOKEN_ROW} h-(--market-head-h) font-mono text-[11px] leading-[normal] font-bold tracking-widest text-muted uppercase`}
      aria-hidden="true"
    >
      <span>{text('item')}</span>
      <span className={RIGHT}>{text('price')}</span>
      <span className={RIGHT}>{text('change_24h')}</span>
      <span className={WIDE}>{text('listed')}</span>
    </div>
    {rows
      ? rows.map((row) => <TokenRow row={row} key={row.item_type} />)
      : Array.from({ length: waiting_rows }, (_, index) => (
          <span className={`${TOKEN_ROW} h-(--market-row-h)`} aria-hidden="true" key={index}>
            <Pending />
          </span>
        ))}
  </div>
)

/** Unique copies are cards and stackable items a token table; one list can hold both. */
const Results = ({ rows, text, empty }: Readonly<{ rows: readonly MarketType[]; text: CopyText; empty: string }>) => {
  if (rows.length === 0) return <p className="py-10 text-center text-muted">{empty}</p>
  const tokens = rows.filter((row) => !is_unique(row))
  return (
    <>
      {rows.some(is_unique) && (
        <div className={GRID}>
          {rows.filter(is_unique).map((row) => (
            <TypeCard row={row} key={row.item_type} />
          ))}
        </div>
      )}
      {tokens.length > 0 && <TokenTable rows={tokens} waiting_rows={0} text={text} />}
    </>
  )
}

const ShelfHead = ({
  title,
  more,
  scroll,
  text,
}: Readonly<{ title: string; more: () => void; scroll: ((direction: number) => void) | null; text: CopyText }>) => (
  <header className="flex items-center gap-4 max-[760px]:justify-between">
    <h2 className="font-title text-[22px]/[1.15] font-bold">{title}</h2>
    <button className="min-h-11 cursor-pointer px-1 font-bold text-muted hover:text-text" onClick={more} type="button">
      {text('see_all')}
    </button>
    {scroll && (
      <span className="ml-auto flex gap-1.5 max-[760px]:hidden">
        <button
          aria-label={`${title}: ${text('previous_page')}`}
          className={ARROW}
          onClick={() => scroll(-1)}
          type="button"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button aria-label={`${title}: ${text('next_page')}`} className={ARROW} onClick={() => scroll(1)} type="button">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </span>
    )}
  </header>
)

/** A shelf's body: its cards or the top rows of its token table, skeletons while the list is on its way, or a line
 *  saying nothing is listed, in the same box. */
const ShelfBody = ({
  group,
  rows,
  row_ref,
  text,
}: Readonly<{
  group: MarketGroup
  rows: readonly MarketType[] | null
  row_ref: RefObject<HTMLDivElement | null>
  text: CopyText
}>) => {
  const cards = holds_cards(group)
  if (rows?.length === 0)
    return (
      <p
        className={`grid place-items-center rounded-ui border border-hair text-muted ${cards ? 'h-[calc(4px+var(--market-card-h))]' : 'h-(--market-tokens-h)'}`}
      >
        {text('group_empty')}
      </p>
    )
  if (!cards)
    return (
      <TokenTable
        rows={rows && rows.slice(0, TABLE_SIZE)}
        waiting_rows={TABLE_SIZE}
        box="min-h-(--market-tokens-h)"
        text={text}
      />
    )
  return (
    <div
      className="flex snap-x snap-proximity gap-4 overflow-x-auto pt-1 pr-(--site-bleed-right) scrollbar-none *:flex-[0_0_188px] *:snap-start max-[760px]:gap-3 max-[760px]:*:basis-[calc(50%-6px)]"
      ref={row_ref}
      aria-busy={rows === null}
    >
      {rows ? rows.slice(0, SHELF_SIZE).map((row) => <TypeCard row={row} key={row.item_type} />) : waiting_cards()}
    </div>
  )
}

/** A group on the first view, always in its place: a row of cards that scrolls sideways, or its token table. */
const GroupShelf = ({
  group,
  types,
  more,
  text,
}: Readonly<{ group: MarketGroup; types: readonly MarketType[] | null; more: () => void; text: CopyText }>) => {
  const row_ref = useRef<HTMLDivElement>(null)
  const scroll = (direction: number): void =>
    row_ref.current?.scrollBy({ left: direction * row_ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="market-shelf flex min-w-0 flex-col gap-3" data-holds={holds_cards(group) ? 'cards' : 'tokens'}>
      <ShelfHead title={text(group_key(group))} more={more} scroll={holds_cards(group) ? scroll : null} text={text} />
      <ShelfBody group={group} rows={types && group_types(types, group)} row_ref={row_ref} text={text} />
    </section>
  )
}

/** The rarest item leads the first view, its price and a link to its offers. */
const SpotOffer = ({ row, text }: Readonly<{ row: MarketType; text: CopyText }>) => {
  const numbers = useNumbers()
  return (
    <section className={SPOT}>
      <div>
        <span className={EYEBROW}>{text('rarest')}</span>
        <h2 className={SPOT_TITLE}>{row.name}</h2>
        <p className={SPOT_LINE}>{text('rarest_on_sale', { count: numbers.number(row.quote.units) })}</p>
        <div className={SPOT_FOOT}>
          <SuiPrice sui={unit_price_sui(row.quote)} />
          <PriceChange change_bps={row.quote.change_bps} />
          <ItemLink className="aui-button aui-button--primary min-h-11" item_type={row.item_type}>
            {text('view_offers')}
          </ItemLink>
        </div>
      </div>
      <ItemArt
        className="grid w-[clamp(110px,18vw,200px)] place-items-center *:w-full *:drop-shadow-[0_14px_16px_#000a] max-[760px]:hidden"
        item_type={row.item_type}
      />
    </section>
  )
}

/** The spotlight's box is there before the list, with skeleton lines, and stays when no item qualifies. */
const Spotlight = ({ types, text }: Readonly<{ types: readonly MarketType[] | null; text: CopyText }>) => {
  const row = types && rarest_type(types)
  if (row) return <SpotOffer row={row} text={text} />
  return (
    <section className={SPOT} aria-busy={types === null}>
      {types ? (
        <p className="col-span-full text-center text-muted">{text('no_results')}</p>
      ) : (
        <div>
          <span className={EYEBROW}>{text('rarest')}</span>
          <h2 className={SPOT_TITLE}>
            <Pending />
          </h2>
          <p className={SPOT_LINE}>
            <Pending />
          </p>
          <div className={SPOT_FOOT}>
            <Pending />
          </div>
        </div>
      )}
    </section>
  )
}

const Featured = ({
  types,
  pick,
  text,
}: Readonly<{ types: readonly MarketType[] | null; pick: (group: MarketGroup) => void; text: CopyText }>) => (
  <>
    <Spotlight types={types} text={text} />
    {ITEM_GROUPS.map((group) => (
      <GroupShelf key={group} group={group} types={types} more={() => pick(group)} text={text} />
    ))}
  </>
)

/** Listed heroes, one page at a time. */
const Heroes = ({ text }: Readonly<{ text: CopyText }>) => {
  const market = useSiteStore(({ marketplace }) => marketplace)
  const offers = useOffers(text)
  const listings = displayed_listings(market).filter((listing) => listing.kind === 'character' && legal_lot(listing))
  const pager = market.page_cursors.length > 0 || market.next_cursor !== null
  return (
    <>
      <MarketAskList ready={offers.ready}>
        {!offers.ready && listings.length === 0 ? (
          Array.from({ length: 4 }, (_, index) => <span className="aui-skeleton aui-skeleton--block" key={index} />)
        ) : (
          <CharacterOffers {...offers} listings={listings} />
        )}
      </MarketAskList>
      {pager && (
        <nav className="flex justify-end gap-2" aria-label={text('browse')}>
          <Button
            className="min-h-11"
            disabled={market.page_cursors.length === 0}
            onClick={() => dispatch_app({ type: 'market/page_requested', direction: 'previous' })}
          >
            {text('previous_page')}
          </Button>
          <Button
            className="min-h-11"
            disabled={market.next_cursor === null}
            onClick={() => dispatch_app({ type: 'market/page_requested', direction: 'next' })}
          >
            {text('next_page')}
          </Button>
        </nav>
      )}
    </>
  )
}

/** The categories of a group that hold a listed type; a group of one category has nothing to narrow. */
const Chips = ({
  view,
  set_view,
  types,
  text,
}: Readonly<{
  view: MarketView
  set_view: (view: MarketView) => void
  types: readonly MarketType[]
  text: CopyText
}>) => {
  const chips: readonly (ItemCategory | null)[] =
    view.group && !view.query ? [null, ...group_chips(types, view.group)] : []
  if (chips.length < 3) return null
  return (
    <nav className="flex flex-wrap gap-x-5" aria-label={text('filter_all')}>
      {chips.map((category) => (
        <Choice
          key={category ?? 'all'}
          chosen={view.category === category}
          pick={() => set_view({ ...view, category })}
        >
          {category ? <CategoryName category={category} /> : text('filter_all')}
        </Choice>
      ))}
    </nav>
  )
}

const GroupView = ({
  view,
  set_view,
  types,
  text,
}: Readonly<{
  view: MarketView
  set_view: (view: MarketView) => void
  types: readonly MarketType[] | null
  text: CopyText
}>) => {
  const body = () => {
    if (shows_heroes(view)) return <Heroes text={text} />
    if (!types)
      return (
        <div className={GRID} aria-busy="true">
          {waiting_cards()}
        </div>
      )
    return (
      <Results rows={view_types(types, view)} text={text} empty={text(view.query ? 'filter_empty' : 'no_results')} />
    )
  }
  return (
    <>
      <h2 className="font-title text-[length:clamp(26px,3.4vw,36px)]/[1.15] font-bold">
        {view.query ? text('results_for', { query: view.query.trim() }) : text(group_key(view.group ?? 'EQUIPMENT'))}
      </h2>
      {types && <Chips view={view} set_view={set_view} types={types} text={text} />}
      {body()}
    </>
  )
}

const NO_VOLUME = Object.freeze({ day_mist: null, month_mist: null, history_days: 0 })

/** The rail: the search field, then the groups as plain text rows with their listed type counts, then the volumes. */
const Rail = ({
  view,
  set_view,
  types,
  text,
}: Readonly<{
  view: MarketView
  set_view: (view: MarketView) => void
  types: readonly MarketType[] | null
  text: CopyText
}>) => {
  const numbers = useNumbers()
  const volume = useSiteStore(({ marketplace }) => marketplace.volume) ?? NO_VOLUME
  const pick = (group: MarketGroup | null) => () => set_view({ group, category: null, query: '' })
  const count = (group: MarketGroup) =>
    types && market_categories(group).length > 0
      ? numbers.number(listed_type_count(types, market_categories(group)))
      : ''
  return (
    <aside className="flex min-w-0 flex-col gap-4 min-[1001px]:sticky min-[1001px]:top-18">
      <label className="flex min-h-11 items-center gap-2.5 rounded-ui border border-line bg-surface-low px-3 text-muted focus-within:border-line-strong">
        <Search size={16} aria-hidden="true" />
        <input
          className="min-w-0 flex-1 text-text outline-0"
          aria-label={text('search')}
          onChange={(event) => set_view({ ...view, query: event.target.value })}
          placeholder={text('search')}
          type="search"
          value={view.query}
        />
      </label>
      <nav
        className="flex flex-col max-[760px]:flex-row max-[760px]:gap-5 max-[760px]:overflow-x-auto max-[760px]:scrollbar-none max-[760px]:*:flex-none"
        aria-label={text('browse')}
      >
        <Choice chosen={!view.query && view.group === null} pick={pick(null)}>
          {text('featured')}
        </Choice>
        {MARKET_GROUPS.map((group) => (
          <Choice key={group} chosen={!view.query && view.group === group} pick={pick(group)}>
            {text(group_key(group))}
            <span
              className="ml-auto font-mono text-xs leading-[normal] font-normal text-faint tabular-nums max-[760px]:ml-0"
              title={text('type_count_hint')}
            >
              {count(group)}
            </span>
          </Choice>
        ))}
      </nav>
      <div className="grid gap-2 border-t border-hair pt-4 max-[760px]:hidden">
        <MarketVolumeBadge window="24h" partial={volume.history_days < 1} mist={volume.day_mist} text={text} />
        <MarketVolumeBadge window="30d" partial={volume.history_days < 30} mist={volume.month_mist} text={text} />
      </div>
    </aside>
  )
}

/** The page observes what it shows while it is on screen: the item's offers, the heroes, or the listed types. */
const useMarketObservation = (item: Readonly<{ item_type: string; category: string }> | undefined, heroes: boolean) => {
  const subject = useMemo(() => market_subject(item, heroes), [item, heroes])
  useEffect(() => dispatch_app({ type: 'market/observed', query: subject }), [subject])
  useEffect(() => () => dispatch_app({ type: 'market/observed', query: null }), [])
}

const MarketPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.marketplace_page)
  const item_type = useSiteStore(({ location }) => market_item_of(location.search))
  const types = useSiteStore(({ marketplace }) => marketplace.types)
  const [view, set_view] = useState<MarketView>(FEATURED)
  const item = item_type ? items_by_type[item_type] : undefined
  useMarketObservation(item, !item_type && shows_heroes(view))
  return (
    <>
      <h1 className="aui-sr">{text('title')}</h1>
      {item_type ? (
        <MarketItem item={item} text={text} />
      ) : (
        <div className="market grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8 max-[760px]:grid-cols-1 max-[760px]:gap-4">
          <Rail view={view} set_view={set_view} types={types} text={text} />
          <div className="flex min-w-0 flex-col gap-8">
            {view.group === null && !view.query ? (
              <Featured types={types} pick={(group) => set_view({ group, category: null, query: '' })} text={text} />
            ) : (
              <GroupView view={view} set_view={set_view} types={types} text={text} />
            )}
          </div>
        </div>
      )}
    </>
  )
}
export default MarketPage
