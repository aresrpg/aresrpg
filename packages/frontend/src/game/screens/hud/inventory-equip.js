// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Inventory equip/slot logic — the canonical paper-doll slot set, slot-validity predicates, and the
// staged equip/unequip reducer. Extracted verbatim from Inventory.jsx (pure logic, no JSX). See the
// slot-set note in Inventory.jsx for the on-chain `verify_slot` rationale.

import { ITEM_CATEGORY, WEAPONS, MISC, to_chain_category } from '@aresrpg/sdk/items'
import { is_developer_item } from '@aresrpg/sdk/jobs'

import { projected_hp, character_max_hp } from '../../../chain/read_character.js'
import { display_rolled_stats } from '../../../chain/rolled_stats.js'
import { cosmetic_icon_of } from '../../cosmetic_icons.js'
import { chain_icon_slug, group_by_stack_identity, is_cosmetic_item, item_type_equip_slot } from '../../item_classification'
import { equip_slot_accepts, equip_slot_kind_of } from './inventory_context_actions'

// Combat head armour and cosmetic hats are distinct on-chain slots.
export const HELMET = 'helmet'

/** The canonical equipment slot set, in paper-doll order. Load-bearing: these are the on-chain
 *  `equip_item` slot Strings enforced by the Move `verify_slot` — head on top, ring on both sides. */
export const EQUIPMENT_SLOTS = /** @type {const} */ ([
  'relic_1',
  'relic_2',
  'relic_3',
  'relic_4',
  'relic_5',
  'relic_6',
  'helmet',
  'amulet',
  'chestplate',
  'gauntlets',
  'pants',
  'weapon',
  'left_ring',
  'right_ring',
  'belt',
  'boots',
  'pet',
  'title',
  'hat',
  'cloak',
])

export const RELIC_SLOTS = ['relic_1', 'relic_2', 'relic_3', 'relic_4', 'relic_5', 'relic_6']
export const RING_SLOTS = ['left_ring', 'right_ring']
/** The cosmetic slot/category vocabulary — the keys the /v1 `worn` projection uses AND the paper doll's
 *  cosmetic slots (they are 1:1). ONE home: the projector below, the worn-override merge, and the Accept
 *  path's worn receipt (Inventory.jsx) all read this list. */
export const WORN_CATEGORIES = /** @type {readonly string[]} */ (['title', 'hat', 'cloak'])

/** Resolve authored icon identity without ever falling back to an object id. `slug_by_name` is the generated
 * item-catalog join used by bag rows; cosmetic_icon_of consumes the authored cosmetic alias SSOT. */
export function inventory_item_icon(item, slug_by_name = {}) {
  if (!item) return null
  const template_slug = slug_by_name[item.name] ?? item.slug
  // `chain_icon_slug` before the generic `item_type` fallback: production ships an empty seed catalog, so
  // `slug_by_name` is `{}` and the on-chain `item_type` is only the family word ('chestplate' -> 404). Deriving
  // the pet item_type / slugified name recovers the real icon (the SAME home the encyclopedia paints with).
  return (
    cosmetic_icon_of({ ...item, slug: template_slug }) ??
    template_slug ??
    item.icon ??
    chain_icon_slug(item) ??
    item.item_type ??
    null
  )
}

const with_authored_icon = (item, slug_by_name = {}) => {
  const template_slug = slug_by_name[item?.name] ?? item?.slug
  const icon = cosmetic_icon_of({ ...item, slug: template_slug }) ?? template_slug ?? item?.icon ?? null
  return icon && item?.icon !== icon ? { ...item, icon } : item
}

/**
 * THE one display-level home ("the cosmetic cape is lvl 0 in my inventory, lvl 1
 * equipped" — kill the duplicated source of truth). An item's shown level is its event-sourced INSTANCE
 * level only when a scribe actually set one (>0 — /v1 coerces the unscribed null to 0, so 0 means
 * "no instance level"), else the template's authored level. Every level derivation (bag hover, paper
 * doll, equip staging, the scribe gear card) flows through here — never a second `?? level` chain.
 * @param {{ level?: number | null } | null | undefined} item
 * @param {{ level?: number | null } | null | undefined} template
 * @returns {number}
 */
export const item_display_level = (item, template) =>
  Number(item?.level) > 0 ? Number(item.level) : Number(template?.level ?? 0)

/** One action creator for click-equip and targeted drop-equip. Level rides the one display-level home;
 * the row keeps its identity unless the display level genuinely differs (reducer referential contract). */
export function equip_stage_action(item, slot, slug_by_name = {}, template_id_map) {
  const template = template_id_map?.get?.(item?.template_id ?? item?.template)
  const level = item_display_level(item, template)
  const with_level = !item || Number(item.level ?? 0) === level ? item : { ...item, level }
  return { type: 'equip', item: with_authored_icon(with_level, slug_by_name), ...(slot ? { slot } : {}) }
}

/**
 * Equip-lock reason as DATA: the "Updating equipment…" box must never render inside
 * the equipment panel — the toast already owns the pending tx via use_toast.promise. `inline` says
 * whether the panel shows the persistent EquipmentLockNotice; the transient pending state never does.
 * `retry_blocked` (digest-proven, gas may have spent) outranks `state_stale` (issue #15 — a zero-gas
 * local-read-staleness refusal, e.g. equipment::ETemplateMismatch) — reuses item_state_mismatch's existing,
 * gas-neutral copy so the SAME refresh action never lies about a burn that never happened.
 * @param {{ pending?: boolean, retry_blocked?: boolean, state_stale?: boolean, in_dungeon?: boolean, exploring?: boolean }} state
 * @returns {{ key: string, inline: boolean } | null}
 */
export function equip_lock_of({ pending, retry_blocked, state_stale, in_dungeon, exploring }) {
  if (pending) return { key: 'inventory.tx_equip_pending', inline: false }
  if (retry_blocked) return { key: 'errors.tx_retry_blocked', inline: true }
  if (state_stale) return { key: 'errors.item_state_mismatch', inline: true }
  if (in_dungeon) return { key: 'inventory.locked_in_dungeon', inline: true }
  if (exploring) return { key: 'inventory.locked_exploring', inline: true }
  return null
}

/**
 * Item ids equipped by the wallet's OTHER characters. Equip never extracts from
 * the kiosk (§11: locked forever), so /v1/owner-items unions those rows into every character's bag —
 * this is the pure exclusion set the bag display subtracts. The SELECTED character's own equipment stays
 * governed by the doll stage (excluded here), so unequip/re-stage flows keep seeing their rows.
 * @param {any[] | null | undefined} characters the /v1 characters projection
 * @param {string | null | undefined} exclude_character_id the selected character
 * @returns {Set<string>}
 */
export function wallet_equipped_ids(characters, exclude_character_id) {
  const ids = new Set()
  for (const character of Array.isArray(characters) ? characters : []) {
    if (!character || character.id === exclude_character_id) continue
    for (const row of Array.isArray(character.equipment) ? character.equipment : []) {
      const id = row?.item_id ?? row?.id
      if (id) ids.add(id)
    }
  }
  return ids
}

/** Short slot captions for the empty-slot art-free placeholders. */
export const SLOT_LABEL = {
  relic_1: 'relic',
  relic_2: 'relic',
  relic_3: 'relic',
  relic_4: 'relic',
  relic_5: 'relic',
  relic_6: 'relic',
  helmet: 'helmet',
  amulet: 'amulet',
  chestplate: 'chestplate',
  gauntlets: 'gauntlets',
  pants: 'pants',
  weapon: 'weapon',
  left_ring: 'ring',
  right_ring: 'ring',
  belt: 'belt',
  boots: 'boots',
  pet: 'pet',
  title: 'title',
  hat: 'hat',
  cloak: 'cloak',
}

/** D203: full-HP potion use must be refused BEFORE any tx (the "you already know that" rule).
 *  Generic per D200: the live consumable vocabulary is heal-only, so the one pre-known abort is a
 *  full-health character; future effect kinds add their own predicates when they ship client-side.
 *  T76 STALE-HP FIX: the chain regens FIRST, THEN aborts ENoMissingHp at max_hp (consumable.move), so the
 *  gate must fold the SAME lazy regen — a character whose 1%/min regen would reach full passes a stored-HP
 *  check but still aborts the avoidable 102 on-chain. Reads the chain-exact single home (projected_hp over
 *  character_max_hp, read_character.js), matching every other HP surface (Stats / PartyFrame / SelfPlate) —
 *  the vestigial `health` + get_max_health scale was the straggler that let the projected-full case slip through.
 *  Fail-open on unknown shapes — never block on a guess, the chain stays the judge.
 *  @param {any} character @returns {boolean} true iff consuming can possibly succeed */
export const can_consume = (character) => {
  if (!character) return false
  if (!character._type) return true // untyped/partial shape → fail open, the chain stays the judge
  const max = character_max_hp(character)
  if (!Number.isFinite(max) || max <= 0) return true // broken/partial shape → fail open, chain judges
  return projected_hp(character, Date.now()) < max
}

/** @param {any} item @returns {boolean} */
export const is_weapon = (item) => equip_slot_kind_of(item) === 'weapon'
/** @param {any} item @returns {boolean} */
export const is_consumable = (item) => item?.item_category === ITEM_CATEGORY.CONSUMABLE
/** @param {any} item @returns {boolean} */
export const is_resource = (item) => MISC.includes(item?.item_category)
/** @param {any} item @returns {boolean} */
export const is_character = (item) => item?.is_aresrpg_character || item?.item_category === ITEM_CATEGORY.CHARACTER

/** `/v1/owner-items` sale lock: a listed kiosk item cannot be extracted for equip/use. */
export const is_item_listed = (item) => item?.listed === true

/** Group same-TEMPLATE usable stackable bag rows for display; equipment callers never pass through this helper.
 *  THE mechanism (stack identity, floor-to-1, first-wins spread) lives in group_by_stack_identity
 *  (item_classification.ts) — the marketplace SELL inventory grid consumes the exact same function (issue #10:
 *  the two homes used to be able to disagree). See that function's doc for the petbox-bug rationale behind
 *  keying on `template_id` first, never `item_type` alone.
 * @param {any[]} rows @returns {any[]} */
export function group_stackable(rows) {
  return group_by_stack_identity(rows, 'amount')
}

/** The bag grid's fixed cell count (empty cells pad to it). */
export const BAG_CAPACITY = 48

/**
 * Partition the `/v1/owner-items` feed into the four bag tabs + the active grid (pure — extracted
 * verbatim from Inventory.jsx). `excluded_ids` = wallet_equipped_ids (cross-character exclusion,
 * night-batch #4); `equipped_ids` = the SELECTED character's doll (staged) ids. Consumables/resources
 * GROUP by stack identity into one ×N cell (group_stackable); equipment never groups.
 * @param {any[] | null | undefined} items
 * @param {{ equipped_ids: Set<string>, excluded_ids?: Set<string>, category: string }} options
 * @returns {{ owned: any[], counts: Record<string, number>, total_count: number, grid_items: any[], empty_count: number }}
 */
export function partition_bag(items, { equipped_ids, excluded_ids, category }) {
  const excluded = excluded_ids ?? new Set()
  const owned = (Array.isArray(items) ? items : []).filter((item) => !is_developer_item(item) && !excluded.has(item.id))
  const is_key = (/** @type {any} */ item) => item?.item_category === ITEM_CATEGORY.KEY
  const equip_bag = owned.filter(
    (item) =>
      !is_cosmetic_item(item) &&
      !is_consumable(item) &&
      !is_resource(item) &&
      !is_character(item) &&
      !equipped_ids.has(item.id)
  )
  const cosmetic_bag = owned.filter((item) => is_cosmetic_item(item) && !equipped_ids.has(item.id))
  const consumable_bag = owned.filter((item) => is_consumable(item) || is_key(item))
  const resource_bag = owned.filter((item) => is_resource(item) && !is_character(item) && !is_key(item))
  const counts = /** @type {Record<string, number>} */ ({
    equipment: equip_bag.length,
    cosmetics: cosmetic_bag.length,
    consumables: consumable_bag.length,
    resources: resource_bag.length,
  })
  const grid_items =
    category === 'cosmetics'
      ? cosmetic_bag
      : category === 'consumables'
        ? group_stackable(consumable_bag)
        : category === 'resources'
          ? group_stackable(resource_bag)
          : equip_bag
  return {
    owned,
    counts,
    total_count: counts.equipment + counts.cosmetics + counts.consumables + counts.resources,
    grid_items,
    empty_count: Math.max(0, BAG_CAPACITY - grid_items.length),
  }
}

/**
 * Whether `item` may go into `slot` (ported from equipment-slot.vue's is_slot_valid).
 * @param {string} slot @param {any} item @returns {boolean}
 */
export function is_slot_valid(slot, item) {
  if (!item || is_item_listed(item)) return false
  // Old/collapsed cosmetic projections carry the lossless fine slot in item_type. Preserve that display seam;
  // normal current rows fall through to the exact Item.category mirror below.
  const cosmetic_slot = item_type_equip_slot(item)
  return cosmetic_slot ? slot === cosmetic_slot : equip_slot_accepts(slot, item)
}

/** Normalize one `/v1/characters` equipment/worn row into the owned-item identity the paper doll uses.
 * `doc` is the wallet's `/v1/owner-items` row for the same item id (equip keeps items kiosk-locked, §11,
 * so the doc exists) — the identity fallback that keeps name/icon painting while the chain template map
 * is still cold/failed (the generic-glyph cosmetic still renders). */
function projected_item(row, template_map, template_id_map, doc) {
  if (!row) return null
  const template_id = row.template_id ?? row.template ?? null
  const template =
    template_id_map?.get?.(template_id) ??
    template_map?.get?.(template_id) ??
    [...(template_map?.values?.() ?? [])].find((candidate) => candidate.id === template_id)
  const raw_category = String(
    row.item_category ?? row.category ?? doc?.item_category ?? template?.category ?? ''
  ).toLowerCase()
  const chain_category = to_chain_category(raw_category === 'fishingrod' ? 'fishing_rod' : raw_category)
  // The RPC keeps the current fine Move vocabulary (`longsword`, `battleaxe`, ...), while the older frontend
  // weapon predicate uses coarse SDK families. Normalize only weapons: applying the SDK's legacy conversion to
  // armor would collapse distinct current slots (chestplate→cloak, gauntlets→belt, pants→boots).
  const category = WEAPONS.includes(chain_category) ? chain_category : raw_category
  return {
    ...template,
    ...doc,
    ...row,
    id: row.id ?? row.item_id,
    template_id,
    // the template's authored slug stays the icon key; the doc's generic type only fills a cold-map gap
    item_type: row.item_type ?? template?.item_type ?? doc?.item_type,
    item_category: category,
    name: row.name ?? doc?.name ?? template?.display?.name ?? template?.name ?? '',
    level: item_display_level({ level: row.level ?? doc?.level }, template),
  }
}

/**
 * Read equipped slots from the character projection. `/v1/characters` owns equipment truth; `/v1/owner-items`
 * intentionally contains only loose kiosk items and must never be used to reconstruct the paper doll —
 * `item_docs` (that same feed) is joined by ITEM ID purely as display identity (name/type/level) for rows
 * the equipment projection strips down to { item_id, template, category }.
 * @param {any} character
 * @param {Map<string, any>} [template_map]
 * @param {Map<string, any>} [template_id_map]
 * @param {any[]} [item_docs] the wallet's `/v1/owner-items` rows (equipped items stay kiosk-locked, so present)
 * @returns {Record<string, any>} the equipped item per slot (null if empty)
 */
export function real_equipment_of(character, template_map, template_id_map, item_docs) {
  /** @type {Record<string, any>} */
  const out = {}
  const projected_rows = Array.isArray(character?.equipment) ? character.equipment : []
  const has_projection = Array.isArray(character?.equipment) || !!character?.worn
  for (const slot of EQUIPMENT_SLOTS) out[slot] = has_projection ? null : (character?.[slot] ?? null)
  const docs_by_id = new Map(
    (Array.isArray(item_docs) ? item_docs : []).map((doc) => [doc?.id, doc]).filter(([id]) => id)
  )
  const doc_of = (/** @type {any} */ row) => docs_by_id.get(row?.item_id ?? row?.id)

  // Equipment events do not carry a slot string; the template category is the slot discriminator. Reuse the
  // same reducer as drag/drop so ring/relic allocation and the combat/cosmetic vocabulary cannot drift.
  let projected = { equipment: out, dirty: false }
  for (const row of projected_rows) {
    const item = projected_item(row, template_map, template_id_map, doc_of(row))
    if (!item?.id) continue
    const next = stage_reducer(projected, { type: 'equip', item })
    if (next !== projected) projected = next
    else if (WORN_CATEGORIES.includes(item.item_category)) {
      projected = {
        equipment: { ...projected.equipment, [item.item_category]: item },
        dirty: true,
      }
    } else if (String(item.item_category).startsWith('tool_')) {
      projected = { equipment: { ...projected.equipment, weapon: item }, dirty: true }
    }
  }

  // `worn` is the authoritative cosmetic category map. Merge its identity onto the matching equipment row
  // when present; this also paints hat/cloak while an older/null-category equipment row cannot be slotted.
  const worn_overrides = Object.entries(character?.worn ?? {})
    .filter(([slot]) => WORN_CATEGORIES.includes(slot))
    .map(([slot, row]) => {
      const matching = projected_rows.find((item) => item.item_id === row?.item_id)
      return [slot, projected_item({ ...matching, ...row, category: slot }, template_map, template_id_map, doc_of(row))]
    })
  return { ...projected.equipment, ...Object.fromEntries(worn_overrides) }
}

/**
 * Return the first newly-equipped row whose fresh owner-items projection is listed or gone. Missing means it was
 * listed/sold/moved after staging; either result must refuse before Accept builds or optimistically patches.
 * @param {Record<string, any>} equipment
 * @param {Record<string, any>} real_equipment
 * @param {any[]} current_items
 * @returns {{ item:any, reason:'listed'|'missing' } | null}
 */
export function invalid_equip_change(equipment, real_equipment, current_items) {
  const current_by_id = new Map((current_items ?? []).map((item) => [item.id, item]))
  const equipped_ids = new Set(EQUIPMENT_SLOTS.map((slot) => real_equipment[slot]?.id).filter(Boolean))
  for (const slot of EQUIPMENT_SLOTS) {
    const next = equipment[slot]
    if (!next || next.id === real_equipment[slot]?.id) continue
    const freshest = current_by_id.get(next.id)
    if (!freshest && !equipped_ids.has(next.id)) return { item: next, reason: 'missing' }
    if (is_item_listed(freshest)) return { item: freshest, reason: 'listed' }
  }
  return null
}

/** Primary stats summed for the equipped-totals strip: [decoded rolled-stat key, display caption].
 *  `action` is the AP field (mirrors the item-detail DESC_STATS field set). */
export const TOTALS_STATS = /** @type {const} */ ([
  ['vitality', 'vitality'],
  ['wisdom', 'wisdom'],
  ['strength', 'strength'],
  ['intelligence', 'intelligence'],
  ['chance', 'chance'],
  ['agility', 'agility'],
  ['action', 'AP'],
])

/**
 * Sum the rolled primary stats across every equipped item (the "equipped totals" strip). Pure: every raw
 * centered-u16 block flows through the shared owned-item display decoder; template/flat item fields are ignored.
 * @param {Record<string, any>} equipment
 * @param {Record<string, Record<string, number>|null|undefined>} rolled_stats_by_id
 * @returns {{ key: string, label: string, value: number }[]}
 */
export function equipped_totals(equipment, rolled_stats_by_id = {}) {
  /** @type {Record<string, number>} */
  const sum = {}
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot]
    if (!item) continue
    const rolled_stats = display_rolled_stats(rolled_stats_by_id[item.id])
    for (const [key] of TOTALS_STATS) sum[key] = (sum[key] ?? 0) + Number(rolled_stats[key]?.[0] ?? 0)
  }
  return TOTALS_STATS.map(([key, label]) => ({
    key,
    label,
    value: sum[key] ?? 0,
  })).filter(({ value }) => value)
}

/**
 * @typedef {{ equipment: Record<string, any>, dirty: boolean, committed?: boolean }} StageState
 * @typedef {(
 *   | { type: 'reset', equipment: Record<string, any> }
 *   | { type: 'commit' }
 *   | { type: 'equip', item: any, slot?: string }
 *   | { type: 'unequip', slot: string }
 *   | { type: 'set_slot', slot: string, item: any }
 * )} StageAction
 */

/** First free slot among `slots` in `equipment`, else null. */
const first_free = (/** @type {string[]} */ slots, /** @type {Record<string, any>} */ eq) =>
  slots.find((slot) => !eq[slot]) ?? null

/**
 * Stage reducer — mirrors item-inventory.vue's equip_item + equipment-slot.vue's drop/unequip,
 * but as a pure transform over a plain { [slot]: item } map (no engine mutation).
 * @param {StageState} state @param {StageAction} action @returns {StageState}
 */
export function stage_reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { equipment: { ...action.equipment }, dirty: false, committed: false }

    case 'commit':
      return { ...state, dirty: false, committed: true }

    case 'unequip': {
      if (!state.equipment[action.slot]) return state
      return {
        equipment: { ...state.equipment, [action.slot]: null },
        dirty: true,
      }
    }

    case 'set_slot': {
      // Back-compatible reducer input; runtime click + drop both use equip_stage_action and the single branch below.
      return stage_reducer(state, equip_stage_action(action.item, action.slot))
    }

    case 'equip': {
      const item = with_authored_icon(action.item)
      if (is_item_listed(item)) return state
      const equipment = { ...state.equipment }
      const cosmetic_slot = item_type_equip_slot(item)
      const slot_kind = equip_slot_kind_of(item)

      // pull the item out of any slot it already sits in (re-stage from doll)
      for (const slot of EQUIPMENT_SLOTS) if (equipment[slot]?.id === item.id) equipment[slot] = null

      // Targeted placement is drag/drop's only variation; it still rides this same state writer.
      if (action.slot) {
        if (!is_slot_valid(action.slot, item)) return state
        equipment[action.slot] = item
        return { equipment, dirty: true, committed: false }
      }

      const place = (/** @type {string[]} */ slots) => {
        const free = first_free(slots, equipment)
        equipment[free ?? slots[slots.length - 1]] = item
      }

      if (cosmetic_slot) equipment[cosmetic_slot] = item
      else if (slot_kind === 'relic') place(RELIC_SLOTS)
      else if (slot_kind === 'ring') place(RING_SLOTS)
      else if (slot_kind) equipment[slot_kind] = item
      else return state // not equippable

      return { equipment, dirty: true, committed: false }
    }

    default:
      return state
  }
}
