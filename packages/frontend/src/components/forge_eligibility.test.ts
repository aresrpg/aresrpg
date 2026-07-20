// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// forge_eligibility.test.ts — the runeforge/crush item classification (the ONE home the forge page, the
// crush right-click menu and the inventory all read). Pure data logic, proven directly — the page itself
// can't be mounted in this DOM-less bun:test env (it imports ../auth → registerEnokiWallets at module load,
// which needs `window`), so the testable seam lives in this dependency-free module (the kolizeum-gate pattern).
import { describe, test, expect } from 'bun:test'
import { ITEM_CATEGORY, WEAPONS } from '@aresrpg/sdk/items'

import { is_forge_gear, is_rune, is_crushable, GEAR_CATEGORIES } from './forge_eligibility'

const item = (item_category: string) => ({ id: 'x', item_type: 't', name: 'n', level: 1, amount: 1, item_category })

describe('forge_eligibility — what the runeforge can scribe / crush', () => {
  test('every weapon type is forge gear AND crushable', () => {
    for (const w of WEAPONS) {
      expect(is_forge_gear(item(w))).toBe(true)
      expect(is_crushable(item(w))).toBe(true)
      expect(is_rune(item(w))).toBe(false)
    }
  })

  test('wearable armour/jewellery categories are forge gear', () => {
    for (const c of [
      ITEM_CATEGORY.RELIC,
      ITEM_CATEGORY.HAT,
      ITEM_CATEGORY.CLOAK,
      ITEM_CATEGORY.AMULET,
      ITEM_CATEGORY.RING,
      ITEM_CATEGORY.BELT,
      ITEM_CATEGORY.BOOTS,
    ]) {
      expect(is_forge_gear(item(c))).toBe(true)
      expect(GEAR_CATEGORIES.has(c)).toBe(true)
    }
  })

  test('a rune is a rune — never gear, never a crush input', () => {
    const rune = item(ITEM_CATEGORY.RUNE)
    expect(is_rune(rune)).toBe(true)
    expect(is_forge_gear(rune)).toBe(false)
    expect(is_crushable(rune)).toBe(false)
  })

  test('pets / consumables / resources are neither gear nor runes', () => {
    for (const c of [ITEM_CATEGORY.PET, ITEM_CATEGORY.CONSUMABLE, ITEM_CATEGORY.RESOURCE]) {
      expect(is_forge_gear(item(c))).toBe(false)
      expect(is_rune(item(c))).toBe(false)
    }
  })

  test('null / undefined / missing category never throws and is falsey', () => {
    expect(is_forge_gear(null)).toBe(false)
    expect(is_forge_gear(undefined)).toBe(false)
    expect(is_rune(null)).toBe(false)
    expect(is_forge_gear({})).toBe(false)
  })
})

// OWNER BUG (petbox lane, 07-20): a stuck ×2 petbox had "OPEN BOX" as the ONLY context-menu action — no CRUSH,
// so a box whose open path is broken had NO disposal path at all. `forgemagie::crush` was never Move-gated by
// category (it takes any Item + ItemTemplate; `get_rolled_stats` returns null for a statless item BY DESIGN —
// "removed_item… crush destroys gear → runes" comment in forge_eligibility already anticipated this) — the ONLY
// blocker was this frontend allowlist. is_forge_gear (the ORIGINAL crush gate, still gear-only by design) stays
// false for a box; is_crushable now widens to admit the disposal case without touching the gear/rune set.
describe('is_crushable — loot boxes admitted as a DISPOSAL crush (petbox lane)', () => {
  const box = { id: '0xbox', item_type: 'normal_pet_lootbox', item_category: ITEM_CATEGORY.CONSUMABLE }

  test('is_forge_gear (the original, unchanged gate) still excludes a box — gear-only by design', () => {
    expect(is_forge_gear(box)).toBe(false)
  })

  test('is_crushable now admits a box for disposal (the fix)', () => {
    expect(is_crushable(box)).toBe(true)
  })

  test('a non-lootbox consumable stays excluded — crush is not a general delete button', () => {
    const potion = { id: '0xpotion', item_type: 'small_potion', item_category: ITEM_CATEGORY.CONSUMABLE }
    expect(is_crushable(potion)).toBe(false)
  })

  test('null / missing item_type never throws', () => {
    expect(is_crushable(null)).toBe(false)
    expect(is_crushable({ item_category: ITEM_CATEGORY.CONSUMABLE })).toBe(false)
  })
})
