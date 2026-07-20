import { ITEM_CATEGORY, WEAPONS } from '@aresrpg/sdk/items'

import { is_lootbox } from '../world-shell/lootbox_util.js'

// FORGE ELIGIBILITY — the ONE home for "what the runeforge / crush can act on", shared by the forge page
// (scribe.tsx), the crush right-click menu (crush_menu.tsx) and the main inventory (Inventory.jsx). Pure
// data-only (imports the chain-lowercase category constants + the import-free lootbox leaf, no DOM) so it is
// unit-testable in the repo's DOM-less bun:test env — the same split the kolizeum gate uses.
//
// Gear that can carry a rune (scribe target) AND be crushed into runes: weapons + wearable armour/jewellery.
// Runes are the YIELD, never a crush input; pets/mounts/titles/cosmetics/consumables/resources are excluded
// (mirrors the frozen equipment set, in chain-lowercase — copied verbatim from the old scribe page).
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

/** A piece of gear the runeforge can scribe a rune onto (weapon or wearable armour/jewellery). */
export const is_forge_gear = (item: ItemLike): boolean => !!item && GEAR_CATEGORIES.has(item.item_category ?? '')

/** A rune stack — the scribe input and the crush output. */
export const is_rune = (item: ItemLike): boolean => !!item && item.item_category === ITEM_CATEGORY.RUNE

/**
 * Crushable = gear that yields runes, OR a loot box crushed for DISPOSAL (a stuck box with a
 * broken open path had no way off the bag — `forgemagie::crush` already no-ops the yield for any statless item,
 * `get_rolled_stats` returns null for a box by design, so this destroys it for zero runes; that's the point).
 * Every other consumable/resource/pet/cosmetic stays excluded — crush is not a general delete button.
 */
export const is_crushable = (item: ItemLike): boolean => is_forge_gear(item) || is_lootbox(item?.item_type)
