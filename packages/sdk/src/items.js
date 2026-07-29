// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ITEM_CATEGORY is a 1:1 mirror of the Move contract's `item::verify_category` allow-list
// (packages/move/sources/item/item.move). The contract is the source of truth — never add a
// category here that verify_category doesn't accept, it will abort item::new with EWrongCategory.
export const ITEM_CATEGORY = {
  // equipment
  RELIC: 'relic',
  RUNE: 'rune',
  MOUNT: 'mount',
  HAT: 'hat',
  CLOAK: 'cloak',
  COSMETIC_HELMET: 'cosmetic_helmet',
  COSMETIC_CLOAK: 'cosmetic_cloak',
  AMULET: 'amulet',
  RING: 'ring',
  BELT: 'belt',
  BOOTS: 'boots',
  TITLE: 'title',
  PET: 'pet',

  // weapons
  BOW: 'bow',
  WAND: 'wand',
  STAFF: 'staff',
  DAGGER: 'dagger',
  SHOVEL: 'shovel',
  SWORD: 'sword',
  SCYTHE: 'scythe',
  AXE: 'axe',
  HAMMER: 'hammer',
  FISHING_ROD: 'fishingRod',
  PICKAXE: 'pickaxe',

  // misc
  MISC: 'misc',
  KEY: 'key',
  RESOURCE: 'resource',

  // consumables
  CONSUMABLE: 'consumable',

  // client-only sentinel for character NFTs (not minted via item::new, not in verify_category)
  CHARACTER: 'character',
}

// STACKABILITY is a CATEGORY property, never an Item field — the 1:1 mirror of the contract's
// `item::is_stackable_category` (packages/move/aresrpg/sources/item.move). ONE home for every client
// derivation: the bag projections, the duplicate sweep and the door-time folds all read it from here.
export const STACKABLE_CATEGORIES = Object.freeze([
  ITEM_CATEGORY.CONSUMABLE,
  ITEM_CATEGORY.RESOURCE,
  ITEM_CATEGORY.RUNE,
])

/**
 * Does this on-chain item category STACK? Case-normalized because the admin template editor stores
 * categories UPPERCASE while the chain and the read layer emit them lowercase.
 * @param {string | null | undefined} category
 * @returns {boolean}
 */
export function is_stackable_category(category) {
  return STACKABLE_CATEGORIES.includes(String(category ?? '').toLowerCase())
}

/**
 * The fewest of `stacks` whose amounts sum to at least `target`, or null when custody is short.
 * Biggest-first keeps PTBs small; the chain-facing consumer splits surplus off the final cover.
 * @param {{ id: string, amount: number }[]} stacks
 * @param {number} target
 * @returns {string[] | null}
 */
export function covering_stacks(stacks, target) {
  if (!(target > 0)) return null
  const chosen = []
  let remaining = target
  for (const stack of [...stacks].sort((a, b) => b.amount - a.amount)) {
    if (remaining <= 0) break
    chosen.push(stack.id)
    remaining -= stack.amount
  }
  return remaining <= 0 ? chosen : null
}

export const EQUIPMENTS = [
  ITEM_CATEGORY.RELIC,
  ITEM_CATEGORY.RUNE,
  ITEM_CATEGORY.MOUNT,
  ITEM_CATEGORY.HAT,
  ITEM_CATEGORY.CLOAK,
  ITEM_CATEGORY.COSMETIC_HELMET,
  ITEM_CATEGORY.COSMETIC_CLOAK,
  ITEM_CATEGORY.AMULET,
  ITEM_CATEGORY.RING,
  ITEM_CATEGORY.BELT,
  ITEM_CATEGORY.BOOTS,
  ITEM_CATEGORY.TITLE,
  ITEM_CATEGORY.PET,
]

export const WEAPONS = [
  ITEM_CATEGORY.BOW,
  ITEM_CATEGORY.WAND,
  ITEM_CATEGORY.STAFF,
  ITEM_CATEGORY.DAGGER,
  ITEM_CATEGORY.SHOVEL,
  ITEM_CATEGORY.SWORD,
  ITEM_CATEGORY.SCYTHE,
  ITEM_CATEGORY.AXE,
  ITEM_CATEGORY.HAMMER,
  ITEM_CATEGORY.FISHING_ROD,
  ITEM_CATEGORY.PICKAXE,
]

export const MISC = [
  ITEM_CATEGORY.CHARACTER,
  ITEM_CATEGORY.KEY,
  ITEM_CATEGORY.RESOURCE,
]

export const CONSUMABLES = [ITEM_CATEGORY.CONSUMABLE]

// The on-chain Move `item::verify_category` accepts only a COARSE category set (equip-slot taxonomy);
// the seeded items.json carries FINER content categories (e.g. longsword/daggers/battleaxe/helmet).
// This maps each fine category to its on-chain equivalent so the craft/mint PTB serializes (an
// unmapped fine category aborts item::new with EWrongCategory, 104). SSOT for the chain category.
// Faithful to the weapon/equip taxonomy + the JobDef.covers groupings (jobs.js).
const CATEGORY_TO_CHAIN = /** @type {Record<string, string>} */ ({
  // weapons
  longsword: ITEM_CATEGORY.SWORD,
  sword: ITEM_CATEGORY.SWORD,
  daggers: ITEM_CATEGORY.DAGGER,
  dagger: ITEM_CATEGORY.DAGGER,
  axe: ITEM_CATEGORY.AXE,
  battleaxe: ITEM_CATEGORY.AXE,
  mace: ITEM_CATEGORY.HAMMER,
  club: ITEM_CATEGORY.HAMMER,
  hammer: ITEM_CATEGORY.HAMMER,
  staff: ITEM_CATEGORY.STAFF,
  spellbook: ITEM_CATEGORY.WAND,
  wand: ITEM_CATEGORY.WAND,
  bow: ITEM_CATEGORY.BOW,
  spear: ITEM_CATEGORY.BOW,
  scythe: ITEM_CATEGORY.SCYTHE,
  shovel: ITEM_CATEGORY.SHOVEL,
  pickaxe: ITEM_CATEGORY.PICKAXE,
  fishing_rod: ITEM_CATEGORY.FISHING_ROD,
  // equipment
  helmet: ITEM_CATEGORY.HAT,
  hat: ITEM_CATEGORY.HAT,
  // body armor: the contract's verify_category has NO chestplate/gauntlets/pants categories (checked
  // item.move directly) — these are reference-corpus armor content categories with no on-chain home, so they
  // collapse onto the nearest accepted equip-slot category (gauntlets/belt and pants/boots share a
  // chain category by design; chestplate->cloak only works today because there are 0 real cloak
  // items). Revisit if/when the contract ever adds distinct body-armor categories.
  chestplate: ITEM_CATEGORY.CLOAK,
  cloak: ITEM_CATEGORY.CLOAK,
  pants: ITEM_CATEGORY.BOOTS,
  boots: ITEM_CATEGORY.BOOTS,
  belt: ITEM_CATEGORY.BELT,
  gauntlets: ITEM_CATEGORY.BELT,
  amulet: ITEM_CATEGORY.AMULET,
  ring: ITEM_CATEGORY.RING,
  relic: ITEM_CATEGORY.RELIC,
  rune: ITEM_CATEGORY.RUNE,
  mount: ITEM_CATEGORY.MOUNT,
  title: ITEM_CATEGORY.TITLE,
  pet: ITEM_CATEGORY.PET,
  // tools -> the gathering pickaxe slot (handyman crafts tools)
  tool_herbalist: ITEM_CATEGORY.PICKAXE,
  tool_miner: ITEM_CATEGORY.PICKAXE,
  tool_paysan: ITEM_CATEGORY.PICKAXE,
  // misc / consumable / resource pass through unchanged
  key: ITEM_CATEGORY.KEY,
  resource: ITEM_CATEGORY.RESOURCE,
  consumable: ITEM_CATEGORY.CONSUMABLE,
})

/**
 * Map a (possibly fine) items.json category to the on-chain `item::verify_category` category. Falls
 * back to 'misc' (an accepted on-chain category) for any unknown so a mint never aborts on category.
 * @param {string} category @returns {string}
 */
export function to_chain_category(category) {
  // CASE-NORMALIZE: the admin template editor stores category UPPERCASE (UPPERCASE_FIELDS) e.g. 'RING' /
  // 'LONGSWORD' / 'PICKAXE' / 'FISHING_ROD', but this map is lowercase-keyed — without the .toLowerCase()
  // EVERY admin mint fell through to 'misc' (the dropdown was cosmetic). Lowercasing maps all dropdown values
  // (incl the re-added gather tools) to their on-chain verify_category category.
  return CATEGORY_TO_CHAIN[String(category ?? '').toLowerCase()] ?? 'misc'
}
