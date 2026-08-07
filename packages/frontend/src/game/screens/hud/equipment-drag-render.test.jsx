// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'bun:test'
import { configure_assets, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { EquipmentSlot } from './EquipmentSlot.jsx'
import { equip_stage_action, real_equipment_of, stage_reducer } from './inventory-equip.js'

const owner_cloak = {
  id: '0xitem',
  kiosk_id: '0xkiosk',
  kiosk_cap_id: '0xcap',
  template_id: '0x2521c902ae440a18c3cfd7ca5906b17d6ad6c3d754054c37d861c6b86938d80d',
  name: 'Lorito Cloak (Sapphire)',
  item_category: 'cloak',
  item_type: 'cloak',
  level: 0,
  amount: 1,
  listed: false,
}

const dropped_cloak = () =>
  stage_reducer(
    { equipment: real_equipment_of(null), dirty: false },
    { type: 'set_slot', slot: 'cloak', item: owner_cloak }
  ).equipment.cloak

// The resolver seeds are module-global and configure_assets only ever MERGES, so a file that publishes a
// class leaks it to every file loading later in the shared process. Reset after each test: this file
// neither leaks its own publication forward nor leans on one arriving from behind.
afterEach(() => {
  reset_assets_for_test()
})

describe('drag-to-equip render', () => {
  test('the full owner row is staged with its authored, icon-resolvable key', () => {
    expect(dropped_cloak()).toMatchObject({
      id: owner_cloak.id,
      template_id: owner_cloak.template_id,
      icon: 'cape_lorito-chance',
    })
  })

  test('the exact template level wins over the owned item row scribe-level zero', () => {
    const templates = new Map([[owner_cloak.template_id, { id: owner_cloak.template_id, level: 1 }]])
    const staged = stage_reducer(
      { equipment: real_equipment_of(null), dirty: false },
      equip_stage_action(owner_cloak, 'cloak', {}, templates)
    )

    expect(staged.equipment.cloak.level).toBe(1)
  })

  test('the dropped cloak paints authored art, never the generic cloak placeholder candidate', () => {
    // ItemIcon resolves through item_icon_url's default `item` class, so `item` is the publication this
    // render actually reads — naming any other class here would only pass on a leaked one.
    configure_assets({
      classes: { item: { published: true } },
      files: { items: ['cape_lorito-chance.png'] },
    })
    const html = renderToStaticMarkup(
      <EquipmentSlot
        slot="cloak"
        item={dropped_cloak()}
        selected
        valid={false}
        on_select={() => {}}
        on_unequip={() => {}}
        on_drag_start={() => {}}
        on_drag_end={() => {}}
        on_drop={() => {}}
      />
    )

    expect(html).toContain('cape_lorito-chance.png')
    expect(html).not.toContain('/cloak.png')
    expect(html).not.toContain('item-icon__glyph')
  })
})

// SOURCE-CONTRACT (right-click on an equipped item used to fall through to the native browser
// menu). renderToStaticMarkup drops event-handler props from its HTML output (no DOM attribute exists for
// "onContextMenu"), so — exactly like dungeon_board_self_click.test.js's on_cell_click contract — this reads
// the source text and locks that the FILLED slot art wires onContextMenu. The popover it opens (EquipMenu)
// is proven separately in EquipMenu.test.jsx.
describe('right-click on a filled slot', () => {
  test('the slot art wires onContextMenu (red at HEAD before EquipMenu shipped)', async () => {
    const src = await Bun.file(new URL('./EquipmentSlot.jsx', import.meta.url)).text()
    const art_start = src.indexOf('className="inv__slot-art"')
    const art_end = src.indexOf('</span>', art_start)
    expect(art_start).toBeGreaterThan(-1)
    expect(art_end).toBeGreaterThan(art_start)
    const art_block = src.slice(art_start, art_end)
    expect(art_block).toContain('onContextMenu={on_context_menu}')
  })
})
