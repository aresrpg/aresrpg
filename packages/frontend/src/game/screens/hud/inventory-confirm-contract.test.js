import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const inventory_source = readFileSync(new URL('./Inventory.jsx', import.meta.url), 'utf8')

test('Accept drives equip through the standard pending-to-success promise toast', () => {
  expect(inventory_source).toMatch(
    /use_toast\.getState\(\)\.promise\([\s\S]*?equip_items\([\s\S]*?pending: t\('inventory\.tx_equip_pending'\)[\s\S]*?success: t\('inventory\.tx_equip_success'\)/
  )
  expect(inventory_source).not.toContain("use_toast.getState().add(t('inventory.tx_equip_success'), 'info')")
})
