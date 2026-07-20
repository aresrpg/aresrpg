export const EQUIPMENT_CATEGORIES = new Set([
  'Helmet',
  'Chestplate',
  'Belt',
  'Gauntlets',
  'Pants',
  'Boots',
  'Longsword',
  'Daggers',
  'Bow',
  'Staff',
  'Axe',
  'Spellbook',
  'Battleaxe',
  'Sword',
  'Club',
  'Mace',
  'Spear',
  'Amulet',
  'Ring',
  'Relic',
])

export const PET_CATEGORIES = new Set(['Pet', 'Mount'])
export const RUNE_CATEGORIES = new Set(['Rune'])
// Mirrors the chain's authoritative `item::is_stackable_category` (CONSUMABLE + RESOURCE + RUNE, D755):
// runes are stackable forgemagie resources and lot-trade like any resource.
export const STACKABLE_CATEGORIES = new Set(['Consumable', 'Resource', 'Rune'])
