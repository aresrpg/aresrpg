// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { EQUIPPABLE_SLOTS, items_for_slot } from './simulator-equip.js'
import { ITEMS_CATALOG_AVAILABLE } from '../../../test_helpers/items_fixture.js'

// MISSING-ARTIFACT (#117): items_for_slot resolves through the empty items.json placeholder — see
// test_helpers/items_fixture.js.
describe('simulator equipment uses the real Move body slots', () => {
  test.skipIf(!ITEMS_CATALOG_AVAILABLE).each(['helmet', 'chestplate', 'gauntlets', 'pants'])(
    '%s retains its seeded templates',
    slot => {
      expect(items_for_slot(slot).length).toBeGreaterThan(0)
      expect(items_for_slot(slot).every(item => item.category.toLowerCase() === slot)).toBe(true)
      expect(EQUIPPABLE_SLOTS).toContain(slot)
    },
  )
})
