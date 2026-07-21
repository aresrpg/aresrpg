// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_CATEGORY, WEAPONS } from '@aresrpg/sdk/items'

// FORGE ELIGIBILITY — the ONE home for "what the runeforge / crush can act on", shared by the forge page
// (scribe.tsx), the crush right-click menu (crush_menu.tsx) and the main inventory (Inventory.jsx). Pure
// data-only (imports only the chain-lowercase category constants, no DOM) so it is unit-testable in the
// repo's DOM-less bun:test env — the same split the kolizeum gate uses.
//
// Gear that can carry a rune (the SCRIBE target — scribe.tsx filters its gear list with this): weapons +
// wearable armour/jewellery. Runes are the YIELD, never a scribe input; pets/mounts/titles/cosmetics/
// consumables/resources are excluded (mirrors the frozen equipment set, in chain-lowercase — copied verbatim
// from the old scribe page). CRUSH no longer reads this set (issue #270 — crushing is universal); see
// `is_crushable` below.
export const GEAR_CATEGORIES: ReadonlySet<string> = new Set<string>([
  ...WEAPONS,
  ITEM_CATEGORY.RELIC,
  ITEM_CATEGORY.HAT,
  ITEM_CATEGORY.CLOAK,
  ITEM_CATEGORY.AMULET,
  ITEM_CATEGORY.RING,
  ITEM_CATEGORY.BELT,
  ITEM_CATEGORY.BOOTS,
])

type ItemLike = { item_category?: string; item_type?: string } | null | undefined

/** A piece of gear the runeforge can scribe a rune onto (weapon or wearable armour/jewellery). SCRIBE-ONLY —
 * crush eligibility is `is_crushable` below, which no longer reads this set. */
export const is_forge_gear = (item: ItemLike): boolean => !!item && GEAR_CATEGORIES.has(item.item_category ?? '')

/** A rune stack — the scribe input and the crush output. */
export const is_rune = (item: ItemLike): boolean => !!item && item.item_category === ITEM_CATEGORY.RUNE

/**
 * Crushable = ANY owned item (issue #270 "restated ruling": crushing is universal). The Move door was never
 * gated by category — `extract::burn` (extract.move) takes any `Item` and asserts only the burn-pledge match;
 * `forgemagie::crush` already no-ops the yield for a statless item and destroys it unconditionally (see
 * `crush_orphan_tests.move`'s statless-husk case). The OLD category allowlist here was ALSO a live false
 * negative beyond zero-rune items: it compared the on-chain FINE content category (e.g. "battleaxe") against
 * the SDK's COARSE `ITEM_CATEGORY` vocabulary (`GEAR_CATEGORIES`), so real runeable gear whose fine category
 * diverges from its coarse mapping silently failed too. The confirm dialog (crush_menu.tsx) reframes honestly
 * off the deterministic yield preview when an item yields nothing — that is the only per-item distinction
 * crush still makes.
 */
export const is_crushable = (item: ItemLike): boolean => !!item
