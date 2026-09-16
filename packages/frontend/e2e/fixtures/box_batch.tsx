// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ItemRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { UseBoxModal } from '../../src/characters/UseBoxModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { rolled_item_types } from '../../src/modules/claims.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

const params = new URLSearchParams(location.search)
const count = Number(params.get('count') ?? 14)
const locale = LOCALES.find(({ code }) => code === params.get('locale'))?.code ?? 'en'
const copy = await load_app_copy(locale)
const box: ItemRow = {
  id: 'bag',
  item_type: 'bag_barley',
  name: 'Bag of Barley',
  category: 'consumable',
  level: 8,
  amount: count,
  kiosk: 'kiosk',
}
let openings = 0
const wallet = {
  address: 'owner',
  character: {
    open_loot_boxes: async ({ count: amount }: { count: number }) => {
      openings += 1
      document.body.dataset.openings = String(openings)
      document.body.dataset.amount = String(amount)
      if (params.has('fail')) throw new Error('Network unavailable')
      const [template] = [...rolled_item_types()].find(([, type]) => type === 'wheat_barley')!
      return {
        rolls: Array.from({ length: amount }, (_, index) => ({
          claim_id: `claim-${index}`,
          rolled_template: template,
          amount: 50,
        })),
        inventory_changes: [{ id: box.id, amount: count - amount, version: '2' }],
      }
    },
  },
} as unknown as AuthSession

dispatch_app({ type: 'locale/changed', locale })
dispatch_app({ type: 'locale/loaded', locale, copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: wallet })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items: [box] } })
const App = () => {
  const [open, set_open] = useState(true)
  return <main>{open ? <UseBoxModal box={box} copy={copy} close={() => set_open(false)} /> : <p>Closed</p>}</main>
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
