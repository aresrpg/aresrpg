// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { useEquipment } from '../../src/characters/useEquipment.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { toast } from '../../src/toast.ts'

test('double-click ignores inactive items and never falls through from a consumable to equip', async () => {
  const copy = await load_app_copy('en')
  const character = {
    id: 'hero',
    kiosk: 'kiosk',
    custody: 'kiosk',
    level: 200,
    equipment: [],
  } as unknown as CharacterRow
  const rows = [
    ['green_mushroom', 'resource'],
    ['rune_agility_ba', 'rune'],
    ['unknown_consumable', 'consumable'],
    ['barley_bread', 'consumable'],
    ['recall_potion', 'consumable'],
    ['bag_green_mushroom', 'consumable'],
    ['hat', 'hat'],
  ].map(([item_type, category], index) => ({
    id: String(index),
    item_type: item_type!,
    category: category!,
    name: item_type!,
    level: 1,
    amount: 1,
    kiosk: 'kiosk',
    version: '1',
  })) satisfies ItemRow[]
  const equipped: unknown[] = []
  const notifications: unknown[] = []
  let activate: (item: Readonly<ItemRow>) => void = () => {
    throw new Error('Hook did not render')
  }
  const Harness = () => {
    const equipment = useEquipment({
      character,
      copy,
      session: { inventory: rows, commit: (next) => void equipped.push(next), raise_stats: () => {} },
    })
    ;({ activate } = equipment)
    return null
  }
  const stop = toast.subscribe((event) => void notifications.push(event))
  try {
    renderToStaticMarkup(<Harness />)
    for (const item of rows.slice(0, -1)) activate(item)
    expect(equipped).toEqual([])
    expect(notifications).toEqual([])
    activate(rows.at(-1)!)
    expect(equipped).toHaveLength(1)
    expect(equipped[0]).toMatchObject({ hat: { id: '6' } })
  } finally {
    stop()
  }
})
