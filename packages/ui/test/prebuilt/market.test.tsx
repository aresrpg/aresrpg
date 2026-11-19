// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  MarketAskItem,
  MarketAskRow,
  MarketBrowse,
  MarketHistory,
  MarketItemBrowse,
  MarketLotTable,
  MarketOwnListings,
  MarketOwnListingStack,
  MarketPage,
  MarketSaleForm,
  MarketSell,
  MarketVolume,
  type MarketGlyph,
  type MarketOwnListing,
} from '../../src/index.ts'

const glyph =
  (name: string): MarketGlyph =>
  ({ className }) => <svg className={className} data-glyph={name} />
const noop = () => undefined
const art = { icon: null, fallback: '◇' }

test('the page frame keeps its toolbar, volumes and panel', () => {
  const html = renderToStaticMarkup(
    <MarketPage
      tabs={{ label: 'Market', value: 'BUY', on_change: noop, options: [{ value: 'BUY', label: 'Buy' }] }}
      volumes={<MarketVolume window="24h" title="Last day" partial label="Volume" value="≥ 1.00" />}
    >
      <p>panel</p>
    </MarketPage>
  )
  expect(html).toContain('<section class="market-page aui-market-page">')
  expect(html).toContain('<header class="market-toolbar"><div class="aui-segments" role="group" aria-label="Market">')
  expect(html).toContain('data-marketplace-volume="24h" title="Last day" data-volume-partial="true"')
  expect(html).toContain('≥ 1.00 <span class="aui-market-currency"><svg aria-hidden="true" data-sui-logo="true"')
  expect(html).toContain('<div class="aui-market-panel"><p>panel</p></div>')
})

test('browse keeps the hooks the end-to-end suite selects', () => {
  const filter = { key: 'hat', label: 'Hats', glyph: null, count: null, pressed: true, select: noop }
  const html = renderToStaticMarkup(
    <MarketBrowse
      label="Browse"
      groups={[filter]}
      pager={{
        label: 'Browse',
        previous: { label: 'Prev', disabled: true, go: noop },
        next: { label: 'Next', disabled: false, go: noop },
      }}
    >
      <MarketItemBrowse
        subcategories={[filter, { ...filter, key: 'cloak', pressed: false }]}
        search={{ Icon: glyph('search'), placeholder: 'Search', value: '', change: noop }}
        pet_food={{ hidden: true, label: 'Pet food', pressed: false, toggle: noop }}
        templates={[{ key: 'hat', name: 'Hat', art, pressed: true, select: noop }]}
      >
        <MarketLotTable
          labels={{ lot_size: 'Lot', price: 'Price', buy: 'Buy' }}
          lots={[
            { key: 'a', size: 1, total: '1.25', action: 'Buy', disabled: false, buy: noop },
            { key: 'b', size: 10, total: null, action: '—', disabled: true, buy: noop },
          ]}
        />
      </MarketItemBrowse>
    </MarketBrowse>
  )
  expect(html).toContain('class="market-browse aui-market-browse"')
  expect(html).toContain('data-marketplace-general-categories="true"')
  expect(html).toContain('data-marketplace-item-types="true"')
  expect(html).toContain('data-marketplace-item-type-column="true"')
  expect(html).toContain('data-marketplace-template-options="true"')
  expect(html).toContain('<div hidden="">')
  expect(html).toContain('data-marketplace-lot-market="true"')
  expect(html).toContain('data-marketplace-cheapest-lot="1" data-marketplace-listing-row="true"')
  expect(html).toContain('class="market-lot-row aui-market-lot aui-market-stripe" data-marketplace-cheapest-lot="10"')
  expect(html).toContain('aui-market-lot-price aui-market-faint">—</span>')
  expect(html).toContain('<nav class="aui-market-pager" aria-label="Browse">')
})

test('an offer row stops propagation and keeps its price column', () => {
  const html = renderToStaticMarkup(
    <MarketAskRow
      index={1}
      icon={<MarketAskItem id="l1" label="Hat" art={art} open={noop} close={noop} tooltip={null} />}
      seller={{ label: 'Seller', name: 'Ada', level: 'Lv. 3', classe: 'senshi', address: '0x12…ab' }}
      price={{ label: 'Price', value: '2.00' }}
      action={{ label: 'Buy', disabled: false, buy: noop }}
    />
  )
  expect(html).toContain('class="market-ask aui-market-ask aui-market-stripe" data-marketplace-listing-row="true"')
  expect(html).toContain('aria-label="Hat" class="aui-market-ask-item" data-marketplace-item="l1"')
  expect(html).toContain('Lv. 3 · senshi · 0x12…ab')
  expect(html).toContain('<div class="aui-market-ask-price">')
})

const listing = (id: string): MarketOwnListing => ({
  id,
  name: `Hat ${id}`,
  category: 'Hat',
  level: 'Lv. 1',
  amount: null,
  price: '1',
  icon: null,
})

test('own listings fold stacks and only withdrawable cards carry their listing hook', () => {
  const withdraw = { label: 'Withdraw', Icon: glyph('x') }
  const single = renderToStaticMarkup(
    <MarketOwnListingStack
      listings={[listing('a')]}
      stack="hat"
      count_title="1"
      pending
      withdraw={withdraw}
      delist={noop}
    />
  )
  expect(single).toContain('data-marketplace-own-listing="a"')
  expect(single).toContain('aria-label="Withdraw" title="Withdraw" disabled=""')
  const stacked = renderToStaticMarkup(
    <MarketOwnListingStack
      listings={[listing('a'), listing('b')]}
      stack="hat"
      count_title="2 listings"
      pending={false}
      withdraw={withdraw}
      delist={noop}
    />
  )
  expect(stacked).toContain('<details class="market-listing-stack" data-marketplace-stack="hat">')
  expect(stacked).toContain('<div class="market-own-listing"><div class="aui-market-own-identity">')
  expect(stacked).toContain('<span class="market-stack-count" title="2 listings">2</span>')
  const panel = renderToStaticMarkup(
    <MarketOwnListings
      labels={{ title: 'Your listings', search: 'Search' }}
      Icons={{ title: glyph('store'), search: glyph('search') }}
      count="0"
      query={{ value: '', change: noop }}
      filter={{ label: 'Browse', all: 'All', value: '', options: [], change: noop }}
      empty="Nothing listed"
      sections={[]}
    />
  )
  expect(panel).toContain('aria-label="Your listings"')
  expect(panel).toContain('class="market-own-listings-scroll aui-market-scroll"><p class="aui-market-own-empty">')
})

test('the sell layout and sale form keep their regions and scroll hook', () => {
  const sell = renderToStaticMarkup(
    <MarketSell
      listings={null}
      labels={{ inventory: 'Inventory', select_to_list: 'Pick', characters: 'Characters' }}
      Icon={glyph('package')}
      count="1"
      filters={null}
      cells={null}
      empty={null}
      characters={[{ key: 'c', name: 'Ada', classe: 'senshi', level: 'Lv. 9', choose: noop }]}
    />
  )
  expect(sell).toContain('<section class="market-inventory aui-market-inventory" aria-label="Inventory">')
  expect(sell).toContain('data-marketplace-inventory="true"')
  expect(sell).toContain('senshi · Lv. 9')
  const form = renderToStaticMarkup(
    <MarketSaleForm
      labels={{ lot_price: 'Price', lot_size: 'Lot', paid_automatically: 'Paid', list: 'List', cancel: 'Cancel' }}
      summary={null}
      floor={null}
      price={{ value: '1', change: noop }}
      lots={{ sizes: [1, 10], value: 10, select: noop }}
      can_list={false}
      list={noop}
      close={noop}
    />
  )
  expect(form).toContain('class="aui-market-port market-sale-form aui-market-sale-scroll" data-sale-scroll="true"')
  expect(form).toContain('id="market-sale-price"')
  expect(form).toContain(
    'aria-pressed="true" type="button" class="aui-button aui-button--neutral aui-market-lot-choice"'
  )
  expect(form).toContain('class="aui-market-sale-submit" disabled=""')
})

test('history rows keep their mobile labels and paging', () => {
  const labels = Object.fromEntries(
    [
      'revenue_30d',
      'sales_count',
      'unclaimed',
      'collect',
      'no_history',
      'item',
      'date',
      'price',
      'buyer',
      'load_more',
    ].map((key) => [key, key.toUpperCase()])
  ) as Parameters<typeof MarketHistory>[0]['labels']
  const html = renderToStaticMarkup(
    <MarketHistory
      labels={labels}
      Icons={{ profits: glyph('coins'), empty: glyph('store') }}
      revenue="5.00"
      profits={{ value: '1.00', pending: true, collect: noop }}
      sales={[{ key: 's', icon: null, name: 'Hat', suffix: ' ×10', date: '2 hr. ago', price: '1.00', buyer: '0x1…2' }]}
      load_more={noop}
    />
  )
  expect(html).toContain('<div class="market-history aui-market-history">')
  expect(html).toContain('<div class="market-history-heading aui-market-history-heading">')
  expect(html).toContain('<span class="market-history-label">DATE · </span>2 hr. ago')
  expect(html).toContain('Hat ×10')
  expect(html).toContain('class="aui-market-collect" disabled=""')
  expect(html).toContain('>LOAD_MORE</button>')
})
