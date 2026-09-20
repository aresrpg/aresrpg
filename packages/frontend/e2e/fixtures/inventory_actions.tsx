// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { item_stat_center } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { TradeDialog } from '../../src/components/TradeDialog.tsx'
import '../../src/components/trade_inbox.css'
import EquipmentTab from '../../src/characters/EquipmentTab.tsx'
import { CrushResultModal } from '../../src/characters/CrushResultModal.tsx'
import { SellPanel } from '../../src/marketplace/SellPanel.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, read_app_state } from '../../src/store.ts'
import '../../src/tailwind.css'
import '../../src/characters/characters.css'
import '../../src/marketplace/marketplace.css'

const copy = await load_app_copy('en')
const seed = content_catalog.items.find(({ category }) => category === 'hat')!
const items: ItemRow[] = [1, 2, 3].map((index) => ({
  id: `gear-${index}`,
  name: `Test Hat ${index}`,
  item_type: seed.item_type,
  category: 'hat',
  level: 5,
  amount: 1,
  kiosk: 'kiosk',
  stats: { strength: item_stat_center + index * 11, wisdom: item_stat_center - 4 },
  damages: [{ element: 'fire', from: index * 3, to: index * 7, damage_type: 'damage' }],
}))
const character: CharacterRow = {
  id: 'character',
  name: 'Fixture',
  classe: 'senshi',
  sex: 'male',
  level: 30,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  available_spell_points: 0,
  spells: {},
  jobs: {},
  kiosk: 'kiosk',
  custody: 'kiosk',
  equipment: [],
  world: 'incarnam',
  checkpoint_world: 'incarnam',
  x: 0,
  z: 0,
  at_ms: 0,
  hp: '100',
  hp_ms: 0,
}
// Synthetic SDK boundary only: no signer, observer, or chain transaction is created.
const recorded: string[][] = []
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: 'owner',
    read_item: async (id: string) => {
      document.body.dataset.itemReads = id
      return { ...items[0]!, id, stats: { strength: item_stat_center + 77 } }
    },
    character: {
      crush_gear: async ({ gear_ids }: { gear_ids: readonly string[] }) => {
        recorded.push([...gear_ids])
        document.body.dataset.crushCalls = JSON.stringify(recorded)
        return { digest: 'fixture', claim_id: 'claim' }
      },
    },
  } as never,
})
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
dispatch_app({ type: 'character/select', character_id: character.id })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items } })
window.addEventListener('fixture-item-departs', () =>
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/inventory', items: read_app_state().session.inventory.filter(({ id }) => id !== 'gear-2') },
  })
)
window.addEventListener('fixture-item-stats', () =>
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory',
      items: read_app_state().session.inventory.map((item) =>
        item.id === 'gear-1' ? { ...item, stats: { ...item.stats, strength: item_stat_center + 55 } } : item
      ),
    },
  })
)
const sell = new URLSearchParams(location.search).has('sell')
const trade = {
  id: 'trade',
  a: 'owner',
  b: 'other',
  phase: 'negotiating' as const,
  offer_revision: 1,
  accept_a: false,
  accept_b: false,
  sui_a: '0',
  sui_b: '0',
  kares_a: '0',
  kares_b: '0',
  caps_a: [{ ...items[0]!, object: items[0]!.id }],
  caps_b: [{ ...items[0]!, object: 'other-item' }],
}
if (new URLSearchParams(location.search).has('trade'))
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/trades', trades: [trade] } })
if (new URLSearchParams(location.search).has('listed'))
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/listings',
      listings: [{ ...items[0]!, kind: 'item', version: '1', seller: 'owner', price_mist: '1000000000', at_ms: 0 }],
      kiosk_versions: { kiosk: '1' },
    },
  })
createRoot(document.getElementById('root')!).render(
  <main
    className="gw-tab market-page flex min-h-0 min-w-0 flex-1"
    style={{ containerType: 'inline-size', containerName: 'app-content' }}
  >
    {new URLSearchParams(location.search).has('trade') ? (
      <TradeDialog copy={copy} active={trade} address="owner" />
    ) : sell ? (
      <SellPanel text={copy_text(copy.marketplace_page)} />
    ) : (
      <>
        <EquipmentTab character={character} copy={copy} />
        <CrushResultModal copy={copy} />
      </>
    )}
  </main>
)
