// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('inventory SEND menu wiring', () => {
  test('bag pet, box, and generic menus open the shared SEND dialog', () => {
    const overlays = source('./InventoryOverlays.jsx')

    expect(overlays).toContain("project_inventory_context_actions(['feed', 'explorer'])")
    expect(overlays).toContain("project_inventory_context_actions(['open', 'crush', 'explorer'])")
    expect(overlays).toContain('on_send={open_send}')
    expect(overlays).toContain('<ItemSendModal items={send_items}')
  })

  test('blocked primary actions do not suppress a bag cell right-click', () => {
    const bag = source('./InventoryBag.jsx')

    expect(bag).not.toMatch(/\n\s+disabled=\{action_disabled\}/)
    expect(bag).toContain('aria-disabled={action_disabled}')
    expect(bag).toContain('onContextMenu={(event) =>')
  })

  // #2060 — the fast-slot half of this contract died with FastSlots.jsx (mounted nowhere; deleted). The
  // runeforge half is the surviving surface, so the SEND wiring stays pinned where it still ships.
  test('runeforge rows expose SEND', () => {
    const scribe = source('../../../pages/scribe.tsx')

    expect(scribe).toContain('onContextMenu={(e) =>')
    expect(scribe).toContain('on_send={(item) => set_send_item(project_inventory_send_item(item, items))}')
  })
})
