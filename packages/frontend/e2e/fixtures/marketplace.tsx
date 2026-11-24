// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_stat_center } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { MarketItem } from '../../src/marketplace/MarketItem.tsx'
import { dispatch_app, read_app_state, useAppStore, start_app } from '../../src/store.ts'
import { all_modules } from '../support/app.ts'

import '../../src/tailwind.css'

// The marketplace's own observer runs: a buy or a listing reaches the fixture's wallet hand below.
start_app(all_modules({ observe: ['marketplace'] }), { seat: true })

const copy = await load_app_copy('en')
const item = content_catalog.items.find((row) => row.category === 'hat')!
const listings: ListingRow[] = [1, 2, 3].map((index) => ({
  ...item,
  kind: 'item',
  id: `0xitem${index}`,
  version: '1',
  group_key: index < 3 ? `roll:${index}` : `object:0xitem${index}`,
  amount: 1,
  stats: index < 3 ? { strength: item_stat_center + (index === 1 ? 11 : 27) } : undefined,
  damages: index === 1 ? [{ element: 'fire', from: 3, to: 7, damage_type: 'damage' }] : undefined,
  price_mist: String(index * 1_000_000_000),
  kiosk: '0xkiosk',
  seller: '0xseller',
  at_ms: index,
}))

if (new URLSearchParams(location.search).has('duplicates')) {
  listings.push(
    { ...listings[0]!, id: '0xduplicate', price_mist: '500000000' },
    { ...listings[0]!, id: '0xown', seller: '0xbuyer', price_mist: '100000000' }
  )
}
window.addEventListener('market-fixture-remove-cheapest', () => {
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      next_cursor: null,
      observation: read_app_state().marketplace.observation!,
      listings: listings.filter(({ id }) => id !== '0xduplicate'),
      kiosk_versions: { '0xkiosk': '2' },
    },
  })
})

// Synthetic session: no link, network read or chain execution. A purchase never answers.
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: '0xbuyer',
    read_item: async (id: string) => {
      document.body.dataset.readItem = id
      throw new Error('Marketplace hover must use its indexed listing')
    },
    on_transaction: () => () => undefined,
    marketplace: {
      buy: () => new Promise(() => {}),
    },
  } as never,
})
dispatch_app({ type: 'market/observed', query: { kind: 'offers', category: item.category, item_type: item.item_type } })
// The fixture item as the market lists it: its quote carries no paid standard lot.
const listed = {
  item_type: item.item_type,
  category: item.category,
  name: item.name,
  level: item.level,
  quote: { lots: {}, units: listings.length, change_bps: null },
}
dispatch_app({ type: 'server/packet', packet: { type: 'packet/market_types', items: [listed] } })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/market_slice',
    next_cursor: null,
    observation: read_app_state().marketplace.observation!,
    listings,
    kiosk_versions: { '0xkiosk': '1' },
  },
})
// The site's item page of the fixture item: its offers, its sheet, its chart.
const ItemView = () => (
  <div className="min-w-0 flex-1 overflow-y-auto">
    <MarketItem item={item} text={copy_text(copy.marketplace_page)} />
  </div>
)

const Fixture = () => {
  const pending = useAppStore(({ marketplace }) => marketplace.pending)
  const market_observed = useAppStore(({ marketplace }) => marketplace.observation)
  useEffect(() => {
    if (!market_observed || market_observed.kind === 'characters') return
    if (market_observed.kind === 'types') {
      dispatch_app({ type: 'server/packet', packet: { type: 'packet/market_types', items: [listed] } })
      return
    }
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        observation: market_observed,
        listings: listings.filter(({ seller }) => seller !== '0xbuyer'),
        kiosk_versions: { '0xkiosk': '2' },
      },
    })
  }, [market_observed])

  return (
    <main
      className="market-page flex min-h-0 min-w-0 flex-1"
      style={{ containerType: 'inline-size', containerName: 'app-content' }}
      data-pending-listing={pending ?? ''}
    >
      <ItemView />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
