// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The equipment tab offers what its driver can do: the player's own wallet does everything, a session
// adapter wears gear and nothing more.
import { expect, spyOn, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import type { CharacterSession } from '../../src/characters/character_session.ts'
import EquipmentTab from '../../src/characters/EquipmentTab.tsx'
import { InventoryItemActions } from '../../src/characters/InventoryItemActions.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'

const character = {
  id: 'hero',
  name: 'Mira',
  classe: 'yogan',
  sex: 'male',
  level: 20,
  color_1: 1,
  color_2: 2,
  color_3: 3,
  kiosk: 'kiosk',
  custody: 'kiosk',
  equipment: [],
} as unknown as CharacterRow
const hat: ItemRow = {
  id: 'hat-1',
  version: '1',
  name: 'Plain Hat',
  item_type: 'hat',
  category: 'hat',
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
}
const base = initial_app_state({} as AppState['settings'])
const state: AppState = { ...base, session: { ...base.session, characters: [character], inventory: [hat] } }
const render = (node: ReactNode): string => {
  const read = ((_store: unknown, selector?: (state: AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const mocked = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return renderToStaticMarkup(node)
  } finally {
    mocked.mockRestore()
  }
}
const preview = () => <i data-preview="" />

test('a session adapter gets the doll and the bag, and none of the transfer or item-action controls', async () => {
  const copy = await load_app_copy('en')
  const session: CharacterSession = { inventory: [hat], commit: () => undefined, raise_stats: () => undefined }
  const html = render(<EquipmentTab character={character} copy={copy} session={session} preview={preview} />)
  // What an adapter can do stays: the doll with the caller's picture, and its bag.
  expect(html).toContain('<div class="inv__portrait"><i data-preview=""></i></div>')
  expect(html).toContain('aria-label="Plain Hat"')
  // Nothing moves between the player and their agent for a bag that is not the player's own.
  expect(html).toContain('class="chr-equip"')
  expect(html).not.toContain('agent-kiosk')
  expect(html).not.toContain('agent-equipment-toggle')
  expect(html).not.toContain(copy.ui.agent_kiosk)
  // No menu of the wallet's item actions: the grid offers no "Item actions" control.
  expect(html).not.toContain(`aria-label="${copy.ui.mobile_item_actions}"`)
  // A selection could go nowhere: no "Select" row above the bag.
  expect(html).not.toContain('inventory-selection-tools')
  expect(html).not.toContain('inventory-select-toggle')
})

test('the player’s own wallet keeps the agent panel and the item actions', async () => {
  const copy = await load_app_copy('en')
  const html = render(<EquipmentTab character={character} copy={copy} preview={preview} />)
  expect(html).toContain('class="chr-equip chr-equip--agent"')
  expect(html).toContain('class="agent-equipment-toggle"')
  expect(html).toContain(
    `<section class="agent-kiosk" data-inventory-owner="agent" aria-label="${copy.ui.agent_kiosk}">`
  )
  expect(html).toContain(`aria-label="${copy.ui.mobile_item_actions}"`)
  expect(html).toContain('class="inventory-selection-tools"')
  expect(html).toContain(`inventory-select-toggle">${copy.ui.inventory_select}</button>`)
  expect(html).toContain('aria-label="Plain Hat"')
})

test('the item detail draws neither Select nor Use for a driver that can do neither', async () => {
  const copy = await load_app_copy('en')
  const bread = { item_type: 'barley_bread', category: 'consumable' }
  const actions = (item: typeof bread, session: boolean) =>
    renderToStaticMarkup(
      <InventoryItemActions
        item={item}
        equipped={false}
        selected={false}
        disabled={false}
        can_use={!session}
        entries={[]}
        copy={copy}
        activate={() => undefined}
        toggle={session ? undefined : () => undefined}
        close={() => undefined}
      />
    )
  // A consumable in an adapter's bag: nothing to press.
  expect(actions(bread, true)).toBe('<div class="inventory-item-actions"></div>')
  // Gear in an adapter's bag: Equip, and no Select.
  const gear = actions(hat, true)
  expect(gear).toContain(`inventory-item-primary">${copy.ui.design_equip}</button>`)
  expect(gear).not.toContain(copy.ui.inventory_select)
  // The player's own wallet keeps both, enabled.
  const own = actions(bread, false)
  expect(own).toContain(copy.ui.inventory_select)
  expect(own).toContain(`inventory-item-primary">${copy.ui.inventory_use}</button>`)
  expect(own).not.toContain('disabled')
})
