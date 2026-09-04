// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { InventoryMenu } from '../../src/characters/InventoryOverlays.tsx'
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

test('the inventory menu links its exact item object ID', async () => {
  Object.defineProperties(globalThis, {
    innerHeight: { configurable: true, value: 800 },
    innerWidth: { configurable: true, value: 1200 },
  })
  const copy = await load_app_copy('en')
  const markup = renderToStaticMarkup(
    <InventoryMenu close_menu={() => undefined} copy={copy} entries={[]} menu={{ x: 10, y: 20, item }} />
  )

  expect(markup).toContain('href="https://testnet.suivision.xyz/object/0xitem"')
  expect(markup).toContain('href="/encyclopedia/items/0x2%3A%3Aitem%3A%3ARelic"')
  expect(markup).toContain('View recipes')
  expect(markup).toContain('See on explorer')
  expect(markup).toContain('Link in chat')
  expect(markup).not.toContain('Destroy')
})
