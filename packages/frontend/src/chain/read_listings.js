// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MARKETPLACE reads.
//
// BUY listings (S-86): the store reads the keyless `/v1/listings` indexer view (packages/rpc) in ONE call and
// maps each row through `build_listing_from_view` — the browser NEVER sweeps the chain for listings. The old
// chain-direct discovery (replay every `0x2::kiosk::ItemListed<Item>` event network-wide, then resolve CURRENT
// truth per kiosk via KioskClient.getKiosk) hammered graphql.testnet.sui.io from the browser (CORS-blocked +
// 429-throttled + the indexer-only law) and is retired. The indexer already projects kiosk list/delist/purchase
// events into the read model, so `/v1/listings` IS the authoritative live set; the client only joins each row's
// display fields from the shared item-template catalog by item_type slug (the SAME template join the old path did).
//
// SELL pickers (`get_listable_*`, S-87): the viewer's OWN unlisted items / characters. Formerly a chain-direct
// kiosk sweep (gRPC kiosk-id discovery + `kiosk_client.getKiosk` per kiosk, GraphQL-backed — CORS-dead in the
// browser, the same banned class BUY retired in S-86). The indexer now projects kiosk CONTENTS too (generic
// kiosk discovery, `packages/rpc/indexer/src/handlers/ares/snapshot.rs` `resolve_kiosk` — items reuse the SAME
// mechanism characters already used): `/v1/owner-items` serves a wallet's loose kiosk-locked items,
// `/v1/characters?owner=` its characters (both carry `kiosk_id`), and both now carry `listed` (joined against
// the existing `rpc:listing:{id}` doc) so the picker excludes rows already on the market — no SDK, no kiosk
// walk. Shared by the marketplace SELL tab + kolizeum (character picker only).
//
// TEMPLATE CATALOG (S-87 fix #2): the picker's category/level join used a chain-direct event replay — a SECOND
// kiosk-adjacent violation the zero-fetch e2e proof caught live. It now uses the same keyless
// `/v1/encyclopedia?kind=items` view as BUY (S-86, `marketplace_chain.ts` `load()`), which carries everything it needs
// (name/category/level by item_type slug — no pods/stats, which only the BUY item-detail renders).

import { is_stackable_category } from '@aresrpg/sdk/items'

import { get_owner_items, get_characters, get_encyclopedia } from '../rpc/client'

import { item_damages_from_v1 } from './read_findables'

// The on-chain `item::Item` category domain is lowercase and a DIFFERENT vocabulary from the frozen
// marketplace page's PascalCase filter groups (constants/item_categories.ts). Map the ones that have a clean UI
// equivalent so the ALL/EQUIPMENT/PETS/RUNES/CONSUMABLE/RESOURCES filters + the stackable detection keep
// working; anything unmapped is Capitalized and falls into the EQUIPMENT bucket (get_filter_group's default).
const CHAIN_CATEGORY_TO_UI = {
  consumable: 'Consumable',
  resource: 'Resource',
  pet: 'Pet',
  mount: 'Mount',
  rune: 'Rune',
  relic: 'Relic',
  ring: 'Ring',
  amulet: 'Amulet',
  belt: 'Belt',
  boots: 'Boots',
  helmet: 'Helmet',
  hat: 'Hat',
  chestplate: 'Chestplate',
  cloak: 'Cloak',
  gauntlets: 'Gauntlets',
  pants: 'Pants',
  sword: 'Sword',
  longsword: 'Longsword',
  dagger: 'Daggers',
  bow: 'Bow',
  staff: 'Staff',
  wand: 'Staff',
  spellbook: 'Spellbook',
  axe: 'Axe',
  scythe: 'Axe',
  battleaxe: 'Battleaxe',
  club: 'Club',
  mace: 'Mace',
  spear: 'Spear',
}

/** chain item_category (lowercase) → the frozen page's category vocabulary. */
export function ui_category(chain_category) {
  const key = String(chain_category ?? '').toLowerCase()
  return CHAIN_CATEGORY_TO_UI[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : 'Misc')
}

// The item_type SLUG is the LOSSLESS fine category. The on-chain `item::verify_category` allow-list is
// coarse (item.js to_chain_category), so distinct content categories COLLAPSE onto one accepted word at
// mint: chestplate + cloak → chain `cloak`, hat + helmet → chain `hat` (…). Reading a cosmetic cloak/hat
// back through `item_category` alone therefore mislabels it as "Chestplate"/"Helmet".
// The slug (a cosmetic's slot word, a body-armor's own content category) still distinguishes them, so it
// WINS whenever it names a known UI category; generic slugs (`iron_sword`, `mystery_brew`) aren't in the
// map and correctly fall through to the item's chain category. ONE home for both marketplace sides.
export function ui_category_of(item_type, chain_category) {
  return CHAIN_CATEGORY_TO_UI[String(item_type ?? '').toLowerCase()] ?? ui_category(chain_category)
}

/**
 * Build the MarketplaceListing the frozen BUY page consumes from ONE `/v1/listings` ROW. The view row
 * carries item_id / kiosk_id / price_mist / seller plus canonical `template_id`, `item_category`, and `amount`
 * joined from the existing indexed Item snapshot. `category` remains the item_type slug used for catalog display.
 * Older API rows retain the slug/template fallbacks, but an older stackable row with no indexed amount fails
 * closed as quantity 0 so the marketplace view-model filter can never display an unverified lot.
 * @param {{ item_id:string, kiosk_id:string, category:string|null, template_id?:string|null, item_category?:string|null, amount?:number|null, level:number|null, price_mist:string, seller:string }} row
 * @param {Map<string, any>} tmpl_by_slug  item_type slug → normalize_item_template row (name/category/level/stats…)
 */
export function build_listing_from_view(row, tmpl_by_slug) {
  const slug = String(row.category ?? '') // /v1: an item listing's `category` IS its item_type slug
  const tmpl = tmpl_by_slug.get(slug) ?? null
  const seller = String(row.seller ?? '')
  // Slug wins when it names a fine UI category (fixes the collapsed cloak→"Chestplate" mislabel); else the
  // item's chain category, then the template's, then empty → "Misc" (the frozen page's EQUIPMENT default).
  const category = ui_category_of(slug, row.item_category ?? tmpl?.category ?? '')
  const stackable = is_stackable_category(category)
  const indexed_amount = Number(row.amount)
  const quantity = Number.isSafeInteger(indexed_amount) && indexed_amount > 0 ? indexed_amount : stackable ? 0 : 1
  const template_id = String(row.template_id ?? (stackable ? row.item_id : slug))
  return {
    id: row.item_id,
    kiosk_id: row.kiosk_id, // the seller kiosk — buy_item / delist target it exactly (load-bearing)
    seller_uuid: '', // no game uuid on-chain; ownership is by address (see seller_sui_address)
    seller_sui_address: seller,
    seller_name: seller ? `${seller.slice(0, 6)}…${seller.slice(-4)}` : '',
    price: 0, // kares is a removed backend currency — SUI only on-chain
    price_mist: String(row.price_mist),
    item: {
      id: row.item_id,
      // Legacy stack rows fall back to their object id, never the generic item_type: distinct templates cannot
      // collapse into one false ladder while an older API is rolling forward.
      template_id,
      // #1227 — the icon-resolvable slug, carried forward instead of discarded after the category join above.
      // template_id is a grouping/tx identity, frequently NOT a valid item_icon_url key (a hash or an id only
      // the private seed catalog knows); the RAW item_type slug is the one key item_icon_url actually accepts.
      slug,
      quantity,
      // This is an OWNED listed instance. Its hover resolves the roll by item id; a template range here would
      // be a dishonest fallback while that instance read is pending or unavailable.
      stats_json: '{}',
      slot: '',
      name: String(tmpl?.name ?? slug),
      description: '',
      rarity: 'common', // rarity/quality has no on-chain field → neutral default
      // A generic item_type can map to many live templates, so the BUY loader deliberately withholds an
      // arbitrary template candidate. The item_type itself still carries enough category truth for the rail
      // (`resource`, `pet`, `hat`, ...); use it as the honest fallback instead of misclassifying the row as Misc.
      category,
      level: Number(row.level ?? tmpl?.level ?? 0),
      // #619 — unlike the instance's stat ROLL, damage lines are AUTHORED on the template and identical for
      // every instance of it, so a resolved template lights the lot's damage block honestly (the unresolved
      // multi-candidate slug keeps `[]`, same stance as name/level above).
      damages_json: JSON.stringify(item_damages_from_v1(tmpl?.damages)),
      consumable_json: 'null',
      particle_trail_json: 'null',
      appearance: '', // no on-chain appearance; ItemImage falls back to items/{slug}.png
      weapon_class: '',
      pet_power: 0,
      pet_stats_json: '{}',
    },
  }
}

/**
 * PURE mapper (offline-testable): `/v1/owner-items` rows + the item-template catalog → the SELL picker's
 * ListableItem shape. Excludes already-listed rows (`r.listed`) — those live in MY LISTINGS (delist there).
 * The on-chain `item::Item` snapshots only name/item_type/category/amount (no stackable flag), so
 * category/stackable resolve from the item's authoritative `item_category`, with its TEMPLATE by `item_type`
 * only as a legacy/display fallback. `level` is the item's OWN
 * event-sourced scribe level when set (mirrors `build_listing_from_view`'s BUY-side precedent — a scribed
 * item's level is real state the template can't know), falling back to the template's base level for the
 * unscribed majority (the /v1/owner-items feed serves `level: 0` for those, never null). `kiosk_id` rides along so
 * `list_item` can `kiosk::list` the exact kiosk that already holds the (locked) item.
 * @param {Array<import('../rpc/views').RpcOwnedItem>} rows  `/v1/owner-items` rows (get_owner_items)
 * @param {Map<string, { name:string, category:string|null, level:number|null }>} tmpl_by_type  item_type
 *   slug → `/v1/encyclopedia` items row (get_encyclopedia_tmpl_by_slug)
 * @returns {Array<{ id:string, kiosk_id:string, template_id:string|null, slug:string, name:string, category:string, level:number, quantity:number, stackable:boolean }>}
 */
export function build_listable_items(rows, tmpl_by_type) {
  return rows
    .filter((r) => !r.listed)
    .map((r) => {
      const tmpl = tmpl_by_type.get(r.item_type) ?? null
      // The item_type slug is the lossless fine category (its chain item_category collapses cloak/chestplate
      // and hat/helmet — ui_category_of); template category is a legacy fallback. stackable is DERIVED from
      // the resolved category (§10 house rule: only the two fungible categories stack), never a stored
      // per-item flag the slim Item struct doesn't carry.
      const category = ui_category_of(r.item_type, r.item_category ?? tmpl?.category)
      return {
        id: r.id,
        kiosk_id: r.kiosk_id,
        // Canonical template identity must come from the indexed item, never from generic item_type.
        template_id: r.template_id ?? null,
        slug: r.item_type,
        name: r.name || tmpl?.name || r.item_type,
        category,
        level: Number(r.level) || Number(tmpl?.level) || 0,
        quantity: Number(r.amount) || 1,
        stackable: is_stackable_category(category),
      }
    })
}

/**
 * The caller's LISTABLE items — every UNLISTED `item::Item` locked in their personal kiosks, WITH the kiosk
 * that holds it (S-63 lock-native: the kiosk-lock constitution means EVERY item — loot, craft, shop/pool buy,
 * gather yield, and marketplace re-buy — is personal-kiosk-locked from birth, never address-owned, so a loose
 * scan would miss a bought item entirely). Already-listed items live in MY LISTINGS (delist there), so they're
 * excluded here. Shaped for the list-item picker. `/v1/owner-items` (S-87) IS the kiosk sweep now — no SDK,
 * no gRPC, no GraphQL; the marketplace still loads this LAZILY (SELL tab only) + caches it per session.
 * @param {string} address
 * @returns {Promise<Array<{ id:string, kiosk_id:string, template_id:string|null, slug:string, name:string, category:string, level:number, quantity:number, stackable:boolean }>>}
 */
export async function get_listable_items(address) {
  const [rows, tmpl_by_type] = await Promise.all([get_owner_items(address), get_encyclopedia_tmpl_by_slug()])
  return build_listable_items(rows, tmpl_by_type)
}

/**
 * The item-template catalog keyed by item_type SLUG, off the keyless `/v1/encyclopedia?kind=items` view —
 * name/category/level only (no pods/stats; this picker never renders those). Mirrors `marketplace_chain.ts`'s
 * BUY-path `load()` join byte-for-byte (S-86) so both sides of the marketplace resolve templates the SAME way.
 * @returns {Promise<Map<string, { name:string, category:string|null, level:number|null }>>}
 */
async function get_encyclopedia_tmpl_by_slug() {
  const ency = await get_encyclopedia('items').catch(() => ({ items: [] }))
  const tmpl_by_slug = new Map()
  for (const t of ency.items ?? [])
    if (t.item_type) tmpl_by_slug.set(t.item_type, { name: t.name, category: t.category, level: t.level })
  return tmpl_by_slug
}

/**
 * PURE mapper: `/v1/characters?owner=` rows → the SELL/kolizeum picker's ListableCharacter shape. Excludes
 * escrowed characters (no `kiosk_id` — can't be listed anyway) and already-listed ones (`c.listed`).
 * @param {Array<import('../rpc/views').RpcCharacter>} characters
 * @returns {Array<{ id:string, kiosk_id:string, name:string, classe:string, experience:number }>}
 */
export function build_listable_characters(characters) {
  return characters
    .filter((c) => c.kiosk_id && !c.listed)
    .map((c) => ({
      id: c.id,
      kiosk_id: c.kiosk_id,
      name: c.name ?? '',
      classe: c.class ?? '',
      experience: c.experience ?? 0,
    }))
}

/**
 * The caller's LISTABLE characters (S-18 sell-side sub-category, §17.30): every UNLISTED Character locked in
 * the caller's personal kiosks, WITH the kiosk that holds it (kiosk::list must target that exact kiosk).
 * Escrowed/deployed characters aren't in a kiosk → correctly excluded (they can't be listed anyway). Level
 * derives from `experience` UI-side (get_level). Shared by the marketplace SELL tab + kolizeum (its
 * create/join character picker). `/v1/characters?owner=` (S-87) replaces the chain-direct kiosk sweep.
 * @param {string} address
 * @returns {Promise<Array<{ id:string, kiosk_id:string, name:string, classe:string, experience:number }>>}
 */
export async function get_listable_characters(address) {
  const characters = await get_characters({ owner: address })
  return build_listable_characters(characters)
}
