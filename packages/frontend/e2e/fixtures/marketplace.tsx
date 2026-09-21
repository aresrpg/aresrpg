// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_stat_center } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { BrowsePanel } from '../../src/marketplace/BrowsePanel.tsx'
import { dispatch_app, read_app_state, useAppStore } from '../../src/store.ts'

import '../../src/tailwind.css'
import '../../src/marketplace/marketplace.css'

const copy = await load_app_copy('en')
const stackable = new URLSearchParams(location.search).has('stackable')
const item = content_catalog.items.find(({ category }) => category === (stackable ? 'resource' : 'hat'))!
const older_item = content_catalog.items.find(
  (candidate) => candidate.category === item.category && candidate.item_type !== item.item_type
)!
const group = stackable ? 'RESOURCES' : 'EQUIPMENT'
const listings: ListingRow[] = [1, 2, 3].map((index) => ({
  ...item,
  kind: 'item',
  id: `0xitem${index}`,
  version: '1',
  group_key: stackable ? 'lot:1' : index < 3 ? `roll:${index}` : `object:0xitem${index}`,
  amount: 1,
  stats: !stackable && index < 3 ? { strength: item_stat_center + (index === 1 ? 11 : 27) } : undefined,
  damages: !stackable && index === 1 ? [{ element: 'fire', from: 3, to: 7, damage_type: 'damage' }] : undefined,
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

// Synthetic session: no observers, wallet connection, network reads, or transaction execution.
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
  } as never,
})
dispatch_app({ type: 'market/group_selected', group, category: item.category, item_type: item.item_type })
dispatch_app({
  type: 'server/packet',
  packet: { type: 'packet/market_types', observation: read_app_state().marketplace.observation!, items: [item] },
})
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
if (new URLSearchParams(location.search).has('all-types')) {
  document.body.dataset.olderItem = older_item.name
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/market_types',
      observation: read_app_state().marketplace.observation!,
      items: [item, older_item],
    },
  })
}
// A certified projection refresh, injected only by this browser fixture.
window.addEventListener('market-price-fixture-update', () => {
  const { observation, history } = read_app_state().marketplace.prices
  if (!observation || !history) return
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/market_prices',
      observation,
      history: {
        ...history,
        sampled_at_ms: history.sampled_at_ms + 1,
        buckets: history.buckets.map((bucket, index) =>
          index === history.buckets.length - 1
            ? { ...bucket, total_mist: String(BigInt(bucket.total_mist) + 1n), checkpoint: bucket.checkpoint + 1 }
            : bucket
        ),
      },
    },
  })
})

const Fixture = () => {
  const pending = useAppStore(({ marketplace }) => marketplace.pending)
  const observation = useAppStore(({ marketplace }) => marketplace.prices.observation)
  const market_observed = useAppStore(({ marketplace }) => marketplace.observation)
  useEffect(() => {
    if (market_observed)
      dispatch_app({
        type: 'server/packet',
        packet: {
          type: 'packet/market_counts',
          observation: market_observed,
          counts: { hat: 2, cloak: 1, resource: 4 },
        },
      })
  }, [market_observed])
  useEffect(() => {
    if (!market_observed || market_observed.kind === 'characters' || market_observed.kind === 'overview') return
    if (market_observed.kind === 'types') {
      const candidates = new URLSearchParams(location.search).has('all-types') ? [item, older_item] : [item]
      dispatch_app({
        type: 'server/packet',
        packet: {
          type: 'packet/market_types',
          observation: market_observed,
          items: candidates.filter((entry) => entry.category === market_observed.category),
        },
      })
      return
    }
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        observation: market_observed,
        listings:
          market_observed.item_type === older_item.item_type
            ? [{ ...listings[0]!, ...older_item, stats: undefined, damages: undefined, id: '0xolder' }]
            : listings.filter(({ seller }) => seller !== '0xbuyer'),
        kiosk_versions: { '0xkiosk': '2' },
      },
    })
  }, [market_observed])

  useEffect(() => {
    if (!observation) return
    const query = new URLSearchParams(location.search)
    const end = Date.UTC(2026, 8, 14)
    const buckets = query.has('empty')
      ? []
      : Array.from({ length: 30 }, (_, index) => ({
          at_ms: end - (29 - index) * 86_400_000,
          total_mist: query.has('tiny') ? '1' : String(8_000_000 + index * 100_000),
          units: '1000',
          sales: '1',
          checkpoint: index + 1,
        })).filter((_, index) => (query.has('sparse') ? [10, 20].includes(index) : index !== 10 && index !== 11))
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/market_prices',
        observation,
        history: {
          total_units: query.has('supply-unavailable') ? null : '1000000',
          first_timestamp_ms: end - 29 * 86_400_000,
          sampled_at_ms: end,
          buckets,
        },
      },
    })
  }, [observation])
  return (
    <main
      className="market-page flex min-h-0 min-w-0 flex-1"
      style={{ containerType: 'inline-size', containerName: 'app-content' }}
      data-pending-listing={pending ?? ''}
    >
      <BrowsePanel text={copy_text(copy.marketplace_page)} />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
