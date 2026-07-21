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

  test('a rune is a rune — never gear (scribe input), but IS crushable under the universal law (#270)', () => {
    const rune = item(ITEM_CATEGORY.RUNE)
    expect(is_rune(rune)).toBe(true)
    expect(is_forge_gear(rune)).toBe(false)
    expect(is_crushable(rune)).toBe(true)
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

  test('is_crushable admits a box for disposal (subsumed by the universal law below)', () => {
    expect(is_crushable(box)).toBe(true)
  })
})

// UNIVERSAL CRUSH (issue #270 "restated ruling"): crushing is universal — ANY owned item can be crushed; a
// zero-rune item just destroys (forgemagie::crush already no-ops the yield and destroys unconditionally
// on-chain — extract::burn was never category-gated, see extract.move:264). The OLD category allowlist here
// was ALSO a live false negative BEYOND zero-rune items: it compared the on-chain FINE content category (e.g.
// "battleaxe") against the SDK's COARSE `ITEM_CATEGORY` vocabulary `GEAR_CATEGORIES` checks against — ground
// truth off testnet: "Trainee Battle axe" (item 0x251c3f9a…deef7e, template category "battleaxe") read as
// non-crushable while "Koa Slime Rod" (template 0x536927977…6b1d63, category "staff" — a coincidental
// fine==coarse match) read as crushable. Neither the axe nor the rod is special; the vocabulary mismatch was
// the whole bug. is_forge_gear (scribe eligibility) is untouched — this is crush-only.
describe('is_crushable — universal (issue #270)', () => {
  test('a non-lootbox consumable is now crushable (destroys for zero runes)', () => {
    const potion = { id: '0xpotion', item_type: 'small_potion', item_category: ITEM_CATEGORY.CONSUMABLE }
    expect(is_crushable(potion)).toBe(true)
  })

  test('a fine content category outside the coarse vocabulary is crushable (the axe/rod bug, ground-truthed)', () => {
    // GEAR_CATEGORIES only ever held the COARSE 'axe', never the fine 'battleaxe' — confirms the old gate's
    // blind spot is real (is_forge_gear/scribe still keys off it, unaffected by this crush-only fix).
    expect(GEAR_CATEGORIES.has('battleaxe')).toBe(false)
    expect(is_crushable({ id: '0xaxe', item_type: 'ikari', item_category: 'battleaxe' })).toBe(true)
  })

  test('any category — pets, titles, runes, resources, keys — is crushable', () => {
    for (const c of [
      ITEM_CATEGORY.PET,
      ITEM_CATEGORY.TITLE,
      ITEM_CATEGORY.RUNE,
      ITEM_CATEGORY.RESOURCE,
      ITEM_CATEGORY.KEY,
    ]) {
      expect(is_crushable(item(c))).toBe(true)
    }
  })

  test('null / undefined never throws and is not crushable', () => {
    expect(is_crushable(null)).toBe(false)
    expect(is_crushable(undefined)).toBe(false)
  })
})
