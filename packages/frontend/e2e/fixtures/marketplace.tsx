// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_stat_center } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { createRoot } from 'react-dom/client'

import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { BrowsePanel } from '../../src/marketplace/BrowsePanel.tsx'
import { market_observation } from '../../src/modules/marketplace.ts'
import { dispatch_app, useAppStore } from '../../src/store.ts'

import '../../src/tailwind.css'

const copy = await load_app_copy('en')
const stackable = new URLSearchParams(location.search).has('stackable')
const item = content_catalog.items.find(({ category }) => category === (stackable ? 'resource' : 'hat'))!
const group = stackable ? 'RESOURCES' : 'EQUIPMENT'
const listings: ListingRow[] = [1, 2, 3].map((index) => ({
  ...item,
  kind: 'item',
  id: `0xitem${index}`,
  version: '1',
  amount: 1,
  stats: !stackable && index < 3 ? { strength: item_stat_center + (index === 1 ? 11 : 27) } : undefined,
  damages: !stackable && index === 1 ? [{ element: 'fire', from: 3, to: 7, damage_type: 'damage' }] : undefined,
  price_mist: String(index * 1_000_000_000),
  kiosk: '0xkiosk',
  seller: '0xseller',
  at_ms: index,
}))

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
dispatch_app({ type: 'market/group_selected', group })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/market_slice',
    observation: market_observation(group),
    listings,
    kiosk_versions: { '0xkiosk': '1' },
  },
})
const Fixture = () => {
  const pending = useAppStore(({ marketplace }) => marketplace.pending)
  return (
    <main className="flex min-h-0 flex-1" data-pending-listing={pending ?? ''}>
      <BrowsePanel text={copy_text(copy.marketplace_page)} />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
