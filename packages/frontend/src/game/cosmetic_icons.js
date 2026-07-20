// COSMETIC → ICON SLUG (encyclopedia/wiki fix). Owner bug: "cosmetics don't even show in the wiki."
//
// ROOT CAUSE (traced, not guessed): a shop cosmetic's on-chain `item_type` is the EQUIP SLOT word
// ("hat" / "cloak" — item.move mints it from the seed's generic `itemType`, shared by every hat/cloak
// row), never a unique slug. ItemImage/item_icon_url build the CDN url as `items/{item_type}.png` —
// every hat-slot cosmetic therefore resolves to the SAME non-existent `items/hat.png` (confirmed: the
// REAL uploaded file is `items/{icon}.png`, e.g. `cape_lorito-agility.png` — verified 200 on the live
// CDN; `items/cape_lorito_agility.png` / `items/hat.png` 404). The unique `icon` slug (seed/mainnet/
// shop.json) is authored ONLY in that seed file — never minted on-chain (item::ItemTemplate has no icon
// field) and never bundled client-side (packages/sdk/src/items.json does not carry shop cosmetics at
// all: 0 of its 1222 rows overlap these shop slugs). This map is the CLIENT-SIDE bridge, generated from
// that seed SSOT, exactly mirroring the cosmetic_aura.js precedent (same file family, same "keep in
// lockstep with the generator + coverage test" contract, same reason it can't be derived on the fly:
// the package is in a size crisis, shop.json isn't bundled).
//
// Keyed by BOTH the seed `slug` (the semantically-correct unique id — wins if a future caller ever
// carries it, e.g. admin tools reading local seed JSON) AND the on-chain Display `name` (the only
// visual-adjacent fact the /v1 encyclopedia projection carries for an item — see items_tab.tsx, which
// has no `icon`/`slug` field, only `template_id`/`item_type`/`name`). `item_type` is NEVER a candidate
// field or a map key — it is the generic slot word ("hat"/"cloak"), shared by ~20 rows each, and would
// silently collapse every hat cosmetic onto one wrong icon (the exact bug this file fixes).
//
// cosmetic_icons.test.js asserts full seed coverage + drift (SSOT: seed/mainnet/shop.json).

/** @type {Record<string, string>} slug|name → the real uploaded icon slug (`items/{icon}[_hd].png`). */
export const COSMETIC_ICON = /** @type {const} */ ({
  // ── slug keys (seed/mainnet/shop.json `slug` → `icon`) ──────────────────────────────────────────
  coiffe_pepe_royal: 'coiffe_pepe_royal',
  berserk: 'berserk',
  cape_kamui: 'cape_kamui',
  casque_hayate: 'casque_hayate',
  corbac_head: 'corbac_head',
  drakar: 'drakar',
  momaku: 'momaku',
  solomonk: 'solomonk',
  cape_fuwa_black: 'cape_fuwa-black',
  cape_fuwa_white: 'cape_fuwa-white',
  coiffe_fuwa_black: 'coiffe_fuwa-black',
  coiffe_fuwa_white: 'coiffe_fuwa-white',
  ekusoni: 'ekusoni',
  enka_muru: 'enka_muru',
  mokan: 'mokan',
  parrot_hat: 'parrot_hat',
  zukin_muru: 'zukin_muru',
  coiffe_pepe: 'coiffe_pepe',
  lorito_helmet: 'lorito_helmet',
  capuche_mo: 'capuche_mo',
  cape_lorito_agility: 'cape_lorito-agility',
  cape_lorito_chance: 'cape_lorito-chance',
  cape_lorito_intelligence: 'cape_lorito-intelligence',
  cape_lorito_strength: 'cape_lorito-strength',
  cape_lorito_vitality: 'cape_lorito-vitality',
  cape_lorito_wisdom: 'cape_lorito-wisdom',
  // ── annex: delisted-but-owned (LIVING manifest rows removed from shop.json, still worn on-chain — the
  //    coverage test asserts seed ⊆ map, so rows beyond the seed are safe; CDN art verified 200) ────────
  cape_lorito_air: 'cape_lorito-air',
  cape_lorito_earth: 'cape_lorito-earth',
  cape_lorito_fire: 'cape_lorito-fire',
  cape_lorito_water: 'cape_lorito-water',
  capuche_bara: 'capuche_bara',
  capuche_bara_air: 'capuche_bara-air',
  capuche_bara_earth: 'capuche_bara-earth',
  capuche_bara_fire: 'capuche_bara-fire',
  capuche_bara_vitality: 'capuche_bara-vitality',
  capuche_bara_water: 'capuche_bara-water',
  capuche_bara_wisdom: 'capuche_bara-wisdom',
  title_veteran: 'veteran_scroll',
  // ── name keys (on-chain Display `name` — what the /v1 encyclopedia item row actually carries) ─────
  'Pepe Royal Crown': 'coiffe_pepe_royal',
  'Berserker Helm': 'berserk',
  'Kamui Cloak': 'cape_kamui',
  'Hayate Helm': 'casque_hayate',
  'Corbac Headdress': 'corbac_head',
  'Drakar Helm': 'drakar',
  'Momaku Mask': 'momaku', // legacy live Display name until the admin-gated template migration
  'Momaku Cloak': 'momaku',
  'Solomonk Cowl': 'solomonk',
  'Fuwa Cloak (Black)': 'cape_fuwa-black',
  'Fuwa Cloak (White)': 'cape_fuwa-white',
  'Fuwa Hood (Black)': 'coiffe_fuwa-black',
  'Fuwa Hood (White)': 'coiffe_fuwa-white',
  'Ekusoni Mask': 'ekusoni',
  'Enka Muru Hood': 'enka_muru', // legacy live Display name until the admin-gated template migration
  'Enka Muru Cloak': 'enka_muru',
  'Mokan Hat': 'mokan',
  'Parrot Hat': 'parrot_hat',
  'Zukin Muru Cowl': 'zukin_muru',
  'Pepe Hat': 'coiffe_pepe',
  'Lorito Helmet': 'lorito_helmet',
  'Mo Hood': 'capuche_mo',
  'Lorito Cloak (Agility)': 'cape_lorito-agility',
  'Lorito Cloak (Emerald)': 'cape_lorito-agility',
  'Lorito Cloak (Chance)': 'cape_lorito-chance',
  'Lorito Cloak (Sapphire)': 'cape_lorito-chance',
  'Lorito Cloak (Intelligence)': 'cape_lorito-intelligence',
  'Lorito Cloak (Ruby)': 'cape_lorito-intelligence',
  'Lorito Cloak (Strength)': 'cape_lorito-strength',
  'Lorito Cloak (Amber)': 'cape_lorito-strength',
  'Lorito Cloak (Vitality)': 'cape_lorito-vitality',
  'Lorito Cloak (Rose Quartz)': 'cape_lorito-vitality',
  'Lorito Cloak (Wisdom)': 'cape_lorito-wisdom',
  'Lorito Cloak (Amethyst)': 'cape_lorito-wisdom',
  // annex: delisted-but-owned elemental Lorito Display names (see the slug annex above)
  'Lorito Cloak (Opal)': 'cape_lorito-air',
  'Lorito Cloak (Jade)': 'cape_lorito-earth',
  'Lorito Cloak (Garnet)': 'cape_lorito-fire',
  'Lorito Cloak (Aquamarine)': 'cape_lorito-water',
  'Bara Hood': 'capuche_bara',
  'Bara Hood (Emerald)': 'capuche_bara-air',
  'Bara Hood (Amber)': 'capuche_bara-earth',
  'Bara Hood (Ruby)': 'capuche_bara-fire',
  'Bara Hood (Vitality)': 'capuche_bara-vitality',
  'Bara Hood (Sapphire)': 'capuche_bara-water',
  'Bara Hood (Wisdom)': 'capuche_bara-wisdom',
  'Mark of the Unbroken': 'veteran_scroll',
})

/** Identity fields tried in order — NEVER `item_type`/`category` (the generic slot word "hat"/"cloak",
 *  shared by ~20 rows; including it would silently collapse every hat onto one wrong icon — the bug this
 *  file exists to fix). @type {readonly string[]} */
const ID_FIELDS = /** @type {const} */ (['slug', 'id', 'name'])

/**
 * The real icon slug for a cosmetic item (any shape carrying slug/id/name), or null when it isn't one
 * of the mapped shop cosmetics — the caller keeps its existing item_type/id fallback in that case.
 * @param {{ slug?: string, id?: string, name?: string } | null | undefined} item
 * @returns {string | null}
 */
export function cosmetic_icon_of(item) {
  if (!item) return null
  for (const f of ID_FIELDS) {
    const v = item[f]
    if (typeof v === 'string' && v in COSMETIC_ICON) return COSMETIC_ICON[v]
  }
  return null
}
