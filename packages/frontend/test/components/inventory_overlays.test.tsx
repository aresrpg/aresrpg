// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { load_app_copy } from '../../src/i18n/copy.ts'

const item = Object.freeze({
  id: '0xitem',
  name: 'Chain Relic',
  item_type: '0x2::item::Relic',
  category: 'resource',
  level: 1,
  amount: 1,
  kiosk: '0xkiosk',
}) satisfies ItemRow

mock.module('../../src/store.ts', () => ({
  dispatch_app: () => undefined,
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      session: { inventory: [item], wallet: null },
      marketplace: { own_listings: [{ id: item.id }] },
    }),
}))
mock.module('../../src/content/assets.ts', () => ({ item_icon: () => null }))

const { InventoryActionOverlays } = await import('../../src/characters/InventoryOverlays.tsx')

test('every inventory NFT links its object ID, including chain-locked listings', async () => {
  Object.defineProperties(globalThis, {
    innerHeight: { configurable: true, value: 800 },
    innerWidth: { configurable: true, value: 1200 },
  })
  const copy = await load_app_copy('en')
  const markup = renderToStaticMarkup(
    <InventoryActionOverlays
      close_menu={() => undefined}
      copy={copy}
      menu={{ x: 10, y: 20, item }}
      reveal_box={null}
      set_reveal_box={() => undefined}
    />
  )

  expect(markup).toContain('href="https://testnet.suivision.xyz/object/0xitem"')
  expect(markup).toContain('See on explorer')
  expect(markup).not.toContain('Destroy')
})
