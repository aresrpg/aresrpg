// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The roster/bag spine's ONE-PIPELINE merge core (audit row #3, lane M5). Pure typed-input reducer for
// `action/sui_data`: every async source (a /v1 snapshot, the client's OWN signed-tx receipt, a chain-direct
// enrichment read) DISPATCHES a typed input here instead of read-modify-writing `state.sui` from outside.
// The merge law lives in ONE place, so a receipt and a stale snapshot that race can no longer clobber each
// other — they fold through this in dispatch order, against the LATEST state, deterministically.
//
// Inputs (`payload.kind`):
//   'snapshot'      — chain-truth roster/items/flags from /v1 (roster/load_roster). Never regresses a
//                     receipt-proven XP floor, nor a settled HP block to an OLDER `hp_updated_ms` anchor
//                     (#1485 — the post-loss full-restore blip); owned items pass through the consumable/bought pending
//                     ledgers. KEEP-on-omit for owned-item feeds: an indexer-lagging read that OMITS a
//                     just-bought/owned item must never vanish it (merge_pending_buys re-adds the pending
//                     row until the id appears) — ONLY an explicit receipt delta removes an item.
//   'receipt_patch' — a delta PROVEN by the client's own signed tx: a fight settlement (HP/XP → RAISES the
//                     per-character XP floor; ItemMinted rows → a bag floor), an equip/consume/buy bag delta,
//                     the create ghost row, or a settled Character mint → a roster floor.
//                     Authoritative — folds against the latest state, never a stale captured array.
//   'enrichment'    — a chain-direct cosmetics/stats read (colors, vitality) that must NEVER clobber a
//                     newer receipt-proven fact (XP / level / current HP); it carries the immutable base.
//   (no kind)       — legacy full merge (boot_roster, equip reconcile, create): spread as today PLUS the XP
//                     floor, so those paths also stop regressing a fresh fight's XP.

import { experience_to_level } from '@aresrpg/sdk/experience'

import { apply_fight_receipt_to_roster } from './fight_receipt_roster.js'
import { mask_pending_items } from './consumable_ledger.js'
import { merge_pending_buys } from './bought_items_ledger.js'

const is_ghost = (/** @type {any} */ c) => String(c?.id ?? '').startsWith('ghost:')

/**
 * Never let a snapshot regress a character's experience below the receipt-proven floor. A character with no
 * floor entry, or already at/above it, passes through by reference (referential stability for selectors).
 * @param {any[]} characters @param {Record<string, number>} [xp_floor]
 */
function floor_characters(characters, xp_floor) {
  if (!Array.isArray(characters) || !xp_floor) return characters
  let changed = false
  const next = characters.map((c) => {
    const floor = xp_floor[c?.id]
    if (floor == null || Number(c?.experience ?? 0) >= floor) return c
    changed = true
    return { ...c, experience: floor, level: experience_to_level(floor) }
  })
  return changed ? next : characters
}

/**
 * Never let a snapshot REGRESS the HP block to an OLDER anchor (#1485). `hp_updated_ms` is the chain's own
 * monotone settle stamp (progression_math::regen_hp only ever advances it), so a snapshot row carrying an
 * anchor older than the one we already hold is BY CONSTRUCTION an indexer projection that predates a
 * receipt-proven write-back — its `current_hp` is the pre-fight value and must not replace the settled one.
 * This is the HP twin of the XP floor above, and it needs no ledger: the anchor rides on the row itself.
 * An equal-or-newer anchor hands authority straight back to the snapshot (an out-of-band heal is chain
 * truth, not a regression), exactly like `floor_settled_items`' presence rule.
 *
 * A row we hold PREVISIONALLY (#1643 — a client prediction, marked by `hp_previsional_ms`) is the same law
 * with one term changed: the anchor it is compared on is the CHAIN anchor the row still carries (the client
 * never advanced it), so authority hands back only once the chain's stamp moves strictly PAST that base —
 * an equal anchor is exactly the lagging pre-fight projection the prediction was made against. Both sides of
 * every comparison here are therefore chain stamps; no wall clock can ever win, or freeze, a row.
 * @param {any[]} characters the incoming snapshot rows @param {any[]} held the rows already in the store
 */
function keep_settled_hp(characters, held) {
  if (!Array.isArray(characters) || !Array.isArray(held) || held.length === 0) return characters
  const by_id = new Map(held.map((c) => [c?.id, c]))
  let changed = false
  const next = characters.map((c) => {
    const prior = by_id.get(c?.id)
    if (prior?.current_hp == null) return c
    const previsional = Number(prior.hp_previsional_ms ?? NaN)
    const held_anchor = Number(prior.hp_updated_ms ?? NaN)
    if (!Number.isFinite(held_anchor) && !Number.isFinite(previsional)) return c
    const anchor = Number(c?.hp_updated_ms ?? NaN)
    const base = Number.isFinite(held_anchor) ? held_anchor : -Infinity
    const chain_wins =
      Number.isFinite(anchor) &&
      c?.current_hp != null &&
      (Number.isFinite(previsional) ? anchor > base : anchor >= base)
    if (chain_wins) return c
    changed = true
    // A previsional hold keeps the incoming row's chain anchor (it IS the chain's last word on this row) and
    // re-marks itself; a chain-settled hold restores its own anchor with its HP block.
    return Number.isFinite(previsional)
      ? { ...c, current_hp: prior.current_hp, hp_previsional_ms: previsional }
      : { ...c, current_hp: prior.current_hp, hp_updated_ms: held_anchor }
  })
  return changed ? next : characters
}

/**
 * Raise the XP floor for `character_id` to its post-receipt experience (monotone — only ever climbs). The
 * floor is what a later stale `/v1` snapshot can never dip below.
 * @param {Record<string, number>} xp_floor @param {any[]} characters @param {string} character_id
 */
function raise_floor(xp_floor, characters, character_id) {
  const character = characters.find((c) => c?.id === character_id)
  const experience = Number(character?.experience ?? NaN)
  if (!Number.isFinite(experience) || (xp_floor?.[character_id] ?? 0) >= experience) return xp_floor ?? {}
  return { ...(xp_floor ?? {}), [character_id]: experience }
}

/**
 * Never let a snapshot RESURRECT a receipt-proven character burn (BACKLOG 18 delete): drop tombstoned ids.
 * Referentially stable when nothing matches.
 * @param {any[]} characters @param {Record<string, true>} [deleted_ids]
 */
function drop_deleted(characters, deleted_ids) {
  if (!Array.isArray(characters) || !deleted_ids) return characters
  return characters.some((c) => deleted_ids[c?.id]) ? characters.filter((c) => !deleted_ids[c?.id]) : characters
}

/**
 * Hold receipt-proven settled loot until a snapshot contains the same object id. This floor is reducer state,
 * not a callback-owned side store: an omitted row proves only indexer lag, while presence hands authority back
 * to the snapshot and drains the floor entry.
 * @param {any[]} items @param {Record<string, any>} [settled_item_floor]
 */
function floor_settled_items(items, settled_item_floor) {
  const floor = settled_item_floor ?? {}
  const entries = Object.entries(floor)
  if (!entries.length) return { items, settled_item_floor: floor }
  const have = new Set((items ?? []).map((/** @type {any} */ item) => item?.id))
  const pending = entries.filter(([id]) => !have.has(id))
  return {
    items: pending.length ? [...(items ?? []), ...pending.map(([, row]) => row)] : items,
    settled_item_floor: Object.fromEntries(pending),
  }
}

/**
 * Hold receipt-proven Character rows until a roster snapshot contains the same object id. Presence drains the
 * floor and lets the authoritative row win; omission is only index lag and keeps the optimistic row visible.
 * Deleted ids are never reintroduced.
 * @param {any[]} characters
 * @param {Record<string, any>} [minted_character_floor]
 * @param {Record<string, true>} [deleted_ids]
 */
function floor_minted_characters(characters, minted_character_floor, deleted_ids) {
  const entries = Object.entries(minted_character_floor ?? {}).filter(
    ([id, row]) => id && row?.id && !deleted_ids?.[id]
  )
  if (!entries.length) return { characters, minted_character_floor: {} }
  const have = new Set((characters ?? []).map((/** @type {any} */ character) => character?.id))
  const pending = entries.filter(([id]) => !have.has(id))
  return {
    characters: pending.length ? [...(characters ?? []), ...pending.map(([, row]) => row)] : characters,
    minted_character_floor: Object.fromEntries(pending),
  }
}

/**
 * The ONE roster-adoption law every non-receipt feed passes through: drop receipt-proven burns, never regress
 * a receipt-proven XP floor or a settled HP anchor, then hold receipt-proven mints the feed has not projected
 * yet. Both snapshot doors below share it — the law lives here once, never once per door.
 * @param {any} sui @param {any[]} characters
 */
function adopt_roster(sui, characters) {
  return floor_minted_characters(
    keep_settled_hp(floor_characters(drop_deleted(characters, sui.deleted_ids), sui.xp_floor), sui.characters),
    sui.minted_character_floor,
    sui.deleted_ids
  )
}

/** Snapshot: floor characters/items, run items through the pending ledgers, spread flags. */
function merge_snapshot(sui, { kind, characters, items, ...flags }) {
  const next = { ...sui, ...flags }
  if (characters) {
    const roster = adopt_roster(sui, characters)
    next.characters = roster.characters
    next.minted_character_floor = roster.minted_character_floor
  }
  // KEEP-on-omit: mask consumed units, then re-add any pending-buy the feed hasn't projected yet.
  if (items) {
    const floored = floor_settled_items(merge_pending_buys(mask_pending_items(items)), sui.settled_item_floor)
    next.items = floored.items
    next.settled_item_floor = floored.settled_item_floor
  }
  return next
}

/** Legacy full merge (no kind): spread + floor characters (items already ledger-merged by the caller). */
function merge_default(sui, payload) {
  const next = { ...sui, ...payload }
  if (payload.characters) {
    const roster = adopt_roster(sui, payload.characters)
    next.characters = roster.characters
    next.minted_character_floor = roster.minted_character_floor
  }
  if (payload.items) {
    const floored = floor_settled_items(payload.items, sui.settled_item_floor)
    next.items = floored.items
    next.settled_item_floor = floored.settled_item_floor
  }
  return next
}

/**
 * The client's OWN signed equip tx (a digest exists) PROVES the cosmetic-slot transition — project it onto
 * the character row NOW so the world rig re-dresses THIS frame (client-independence §1), instead of waiting
 * on (or losing to) the /v1 reconcile, whose confirmed row adopts chain truth wholesale right after.
 * [Bug fix 2026-07-17: cape swap succeeded, the rig kept the old cape — the reconcile threw on indexer
 * lag and nothing else ever rewrote `worn`.] `set` rows are WornCosmetic-shaped
 * ({ item_id, template_id, category }); `clear` lists the categories the tx emptied.
 * @param {any} sui @param {{ character_id: string, set?: Record<string, any>, clear?: string[] }} payload
 */
function apply_equip_worn(sui, { character_id, set = {}, clear = [] }) {
  const index = sui.characters.findIndex((/** @type {any} */ c) => c?.id === character_id)
  if (index === -1) return sui
  const current = sui.characters[index]
  const worn = { ...(current.worn ?? {}) }
  /** rpc_to_card also spreads worn categories FLAT onto the row (back-compat readers) — mirror it. */
  const flat = /** @type {Record<string, any>} */ ({})
  let changed = false
  for (const category of clear) {
    if (worn[category] === undefined) continue
    delete worn[category]
    flat[category] = null
    changed = true
  }
  for (const [category, row] of Object.entries(set)) {
    if (worn[category]?.item_id != null && worn[category].item_id === row?.item_id) continue
    worn[category] = row
    flat[category] = row
    changed = true
  }
  if (!changed) return sui
  const characters = sui.characters.slice()
  characters[index] = { ...current, ...flat, worn }
  return { ...sui, characters }
}

/** Paint receipt-created loot and hold its exact ids until an authoritative snapshot contains them.
 * @param {any} sui @param {any[]} rows */
function apply_settled_loot(sui, rows) {
  const valid = (rows ?? []).filter((/** @type {any} */ row) => row?.id)
  if (!valid.length) return sui
  const have = new Set(sui.items.map((/** @type {any} */ item) => item?.id))
  const add = valid.filter((/** @type {any} */ row) => !have.has(row.id))
  const settled_item_floor = valid.reduce(
    (floor, /** @type {any} */ row) => ({ ...floor, [row.id]: row }),
    sui.settled_item_floor ?? {}
  )
  return { ...sui, items: add.length ? [...sui.items, ...add] : sui.items, settled_item_floor }
}

/** Paint a settled Character against the latest roster and floor it until an authoritative snapshot sees its id.
 * @param {any} sui @param {any} row */
function apply_minted_character(sui, row) {
  if (!row?.id) return sui
  const characters = [
    ...(sui.characters ?? []).filter(
      (/** @type {any} */ character) => !is_ghost(character) && character?.id !== row.id
    ),
    row,
  ]
  return {
    ...sui,
    characters,
    minted_character_floor: { ...(sui.minted_character_floor ?? {}), [row.id]: row },
    loaded: true,
    load_error: null,
    has_claimed_free_character: true,
  }
}

/** Remove receipt-proven ids from both the rendered bag and the settled-loot floor.
 * @param {any} sui @param {string[]} ids */
function remove_receipt_items(sui, ids) {
  const drop = new Set(ids ?? [])
  if (!drop.size) return sui
  const items = sui.items.filter((/** @type {any} */ item) => !drop.has(item?.id))
  const settled_item_floor = Object.fromEntries(
    Object.entries(sui.settled_item_floor ?? {}).filter(([id]) => !drop.has(id))
  )
  const floor_changed = Object.keys(settled_item_floor).length !== Object.keys(sui.settled_item_floor ?? {}).length
  return items.length === sui.items.length && !floor_changed ? sui : { ...sui, items, settled_item_floor }
}

/** Decrement the latest bag row and mirror the same fact into its settled-loot floor entry, when present.
 * @param {any} sui @param {{ id: string, units?: number }} payload */
function decrement_receipt_item(sui, { id, units = 1 }) {
  const target = sui.items.find((/** @type {any} */ item) => item?.id === id)
  if (!target) return sui
  const amount = (Number(target.amount) || 1) - units
  const items =
    amount > 0
      ? sui.items.map((/** @type {any} */ item) => (item?.id === id ? { ...item, amount } : item))
      : sui.items.filter((/** @type {any} */ item) => item?.id !== id)
  const floor_row = sui.settled_item_floor?.[id]
  const settled_item_floor = floor_row
    ? Object.fromEntries(
        Object.entries(sui.settled_item_floor).flatMap(([floor_id, row]) => {
          if (floor_id !== id) return [[floor_id, row]]
          return amount > 0 ? [[floor_id, { ...row, amount }]] : []
        })
      )
    : sui.settled_item_floor
  return { ...sui, items, settled_item_floor }
}

/**
 * Fold a receipt-proven stack merge (#1495): every `from` was DELETED on chain by `item::merge`, and the
 * surviving `into` carries the run's final `total`. Both facts mirror into the settled-loot floor, so a
 * lagging snapshot can neither resurrect a merged source nor regress the survivor's amount.
 * @param {any} sui @param {{ into: string, from: string, total: number }[]} merges
 */
function apply_stack_merges(sui, merges) {
  const rows = (merges ?? []).filter((/** @type {any} */ row) => row?.into && row?.from)
  if (!rows.length) return sui
  const drop = new Set(rows.map((row) => row.from))
  // Last event per survivor wins — a 3-into-1 run emits total 2 then 3; the final one is the true amount.
  const totals = new Map(rows.map((row) => [row.into, Number(row.total)]))
  const retotal = (/** @type {any} */ item) => {
    const total = totals.get(item?.id)
    return total > 0 && total !== item?.amount ? { ...item, amount: total } : item
  }
  const items = sui.items.filter((/** @type {any} */ item) => !drop.has(item?.id)).map(retotal)
  const settled_item_floor = Object.fromEntries(
    Object.entries(sui.settled_item_floor ?? {})
      .filter(([id]) => !drop.has(id))
      .map(([id, row]) => [id, retotal(row)])
  )
  return { ...sui, items, settled_item_floor }
}

/** A receipt-proven delta from the client's OWN tx — folds against the latest state, raises the XP floor. */
function apply_receipt_patch(sui, payload) {
  switch (payload.op) {
    case 'fight_receipt': {
      // HP/XP write-back mirror (results::write_back_hp + the XP delta). apply_fight_receipt_to_roster ADDS
      // the xp_share once and paints final_hp — the ONE door every post-fight roster write goes through
      // (#1643), so the XP floor is raised in the same step (a stale snapshot can never regress it after).
      const characters = apply_fight_receipt_to_roster(sui.characters, {
        character_id: payload.character_id,
        xp_share: payload.xp_share,
        final_hp: payload.final_hp,
        // The prediction's local base instant is an INPUT (effects at the edges — store_patch supplies it),
        // never read off a wall clock in here. It projects regen and NOTHING else; the chain's own anchor
        // stays untouched, which is what makes clock skew unable to freeze the row.
        previsional_ms: payload.previsional_ms,
      })
      const xp_floor = raise_floor(sui.xp_floor, characters, payload.character_id)
      if (characters === sui.characters && xp_floor === sui.xp_floor) return sui
      return { ...sui, characters, xp_floor }
    }
    case 'add_items': {
      // De-dupe by id (unequip / just-bought paint). A racing snapshot's own pending ledger keeps these.
      const rows = payload.rows ?? []
      if (!rows.length) return sui
      const have = new Set(sui.items.map((/** @type {any} */ i) => i?.id))
      const add = rows.filter((/** @type {any} */ i) => i?.id && !have.has(i.id))
      return add.length ? { ...sui, items: [...sui.items, ...add] } : sui
    }
    case 'settled_loot': {
      // The mint receipt proves these exact object ids exist in this bag. Paint against the LATEST items slice
      // and record a pure reducer-owned floor so an indexer-lagged full snapshot cannot erase them afterward.
      return apply_settled_loot(sui, payload.rows)
    }
    case 'mint_character':
      return apply_minted_character(sui, payload.row)
    case 'remove_items': {
      // Equip / consume-to-zero: drop the ids from the LATEST bag (never a stale captured array — that WAS
      // the lost-update race). KEEP-on-omit does not apply here: a receipt is explicit proof the item left.
      return remove_receipt_items(sui, payload.ids)
    }
    case 'decrement_item': {
      return decrement_receipt_item(sui, payload)
    }
    case 'merge_stacks': {
      // The boot sweep's ItemMerged events: sources gone, the survivor at its summed total.
      return apply_stack_merges(sui, payload.merges)
    }
    case 'equip_worn':
      return apply_equip_worn(sui, payload)
    case 'remove_character': {
      // Character DELETE receipt (BACKLOG 18): the client's own signed burn tx proves the character is
      // GONE — drop it from the LATEST roster NOW and TOMBSTONE the id so an indexer-lagging /v1 snapshot
      // can never resurrect it (the never-regress-a-receipt-proven-fact law, same class as the XP floor).
      const { id } = payload
      if (!id) return sui
      const deleted_ids = { ...(sui.deleted_ids ?? {}), [id]: /** @type {true} */ (true) }
      const characters = sui.characters.filter((/** @type {any} */ c) => c?.id !== id)
      const minted_character_floor = Object.fromEntries(
        Object.entries(sui.minted_character_floor ?? {}).filter(([character_id]) => character_id !== id)
      )
      return { ...sui, characters, deleted_ids, minted_character_floor }
    }
    case 'set_ghost':
      // D9 click-instant create prediction — one ghost row, replacing any prior ghost.
      return { ...sui, characters: [...sui.characters.filter((c) => !is_ghost(c)), payload.ghost] }
    case 'clear_ghosts':
      return { ...sui, characters: sui.characters.filter((c) => !is_ghost(c)) }
    default:
      return sui
  }
}

/** Chain-direct cosmetics that must not clobber projected allocation/equipment or receipt-proven XP/HP. */
function apply_enrichment(sui, { character_id, enrichment }) {
  if (!character_id || !enrichment) return sui
  const index = sui.characters.findIndex((c) => c?.id === character_id)
  if (index === -1) return sui
  const current = sui.characters[index]
  const characters = sui.characters.slice()
  const merged = {
    ...current,
    ...enrichment,
    // receipt-proven fields WIN over the immutable base the enrichment read carries (RED#3): XP/level are
    // read-model-owned; current HP survives if a settlement receipt already stamped it.
    experience: current.experience,
    level: current.level,
    current_hp: current.current_hp ?? enrichment.current_hp,
    hp_updated_ms: current.hp_updated_ms ?? enrichment.hp_updated_ms,
    available_points: current.available_points ?? enrichment.available_points,
    gear_vitality: current.gear_vitality ?? enrichment.gear_vitality,
  }
  for (const key of [
    'vitality',
    'wisdom',
    'strength',
    'intelligence',
    'chance',
    'agility',
    'equipment_stats',
    'equipment',
    'jobs',
  ])
    if (current[key] != null) merged[key] = current[key]
  characters[index] = merged
  return { ...sui, characters }
}

/**
 * The ONE `action/sui_data` merge. `state.sui` in → next `state.sui` out (pure). Dispatchers send a TYPED
 * input; the merge law (XP floor, pending ledgers, receipt-over-snapshot) lives only here.
 * @param {any} sui @param {any} payload
 */
export function reduce_sui_data(sui, payload) {
  switch (payload?.kind) {
    case 'snapshot':
      return merge_snapshot(sui, payload)
    case 'receipt_patch':
      return apply_receipt_patch(sui, payload)
    case 'enrichment':
      return apply_enrichment(sui, payload)
    default:
      return merge_default(sui, payload)
  }
}
