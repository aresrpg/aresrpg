// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OWNED-OBJECT reads for a player's loose bag Items. get_owned_items is /v1-FIRST (the indexer's
// owner→kiosk→items join) with the chain walk demoted to the sanctioned /v1-outage fallback.
//
// LEGACY FILENAME (S-86 read-abolition sweep): this was the T62 "staking" reader. The idle-exploration /
// staking / tiredness / character-away system is DELETED on-chain (SPEC §5 "replaces the deleted idle/
// exploration system"; §banned-list "idle exploration / tiredness / character-away systems"), so the whole
// `staking::Stake` / `staking::RestUntilKey` surface no longer exists in the merged package — `get_stakes`,
// `read_rest_until` and `REST_COOLDOWN_MS` were CORPSES (every read resolved empty forever) and were removed
// in the read-surface audit. What remains reads LIVE sources only:
//   • v1_character_to_party_row — adapts one exact `/v1/characters?id=` row for PartyFrame's HP display
//   • get_owned_items      — the player's loose bag Items, UNIONED across their personal kiosk(s) (`::item::Item`);
//                            /v1-first via `/v1/owner-items`, chain-union fallback (the SANCTIONED outage walk)

import { normalizeStructTag } from '@mysten/sui/utils'
import { is_stackable_category } from '@aresrpg/sdk/items'

import { get_owner_items } from '../rpc/client'
import { with_timeout } from '../utils/with_timeout'
import { game_log } from '../core/log.js'

import { item_type_id } from './item_lineage'

// Stackability is a CATEGORY property, never an Item field — derived from the SDK's `is_stackable_category`
// (the 1:1 mirror of item.move). Applied to BOTH the /v1 rows and the chain-direct fallback rows so the two
// paths yield an identical bag shape (`stackable` is not on the wire).
const with_stackable = (/** @type {any} */ row) => ({ ...row, stackable: is_stackable_category(row.item_category) })

/**
 * @typedef {{ id: string, name: string, classe: string, experience: number, vitality: number,
 *   gear_vitality: number, equipment_stats: Record<string, number> | null,
 *   current_hp: number, hp_updated_ms: number, hp_known: boolean }} PartyCharacter
 * The CharacterFields SUBSET the party plate's HP math reads (projected_hp / character_max_hp —
 * read_character.js) plus the `hp_known` honesty flag.
 */

/**
 * Map ONE `/v1/characters` row → the PartyCharacter shape PartyFrame consumes. The raw HP pair,
 * fight-authoritative `equipment_stats`, and `experience` ride the indexer's object-snapshot pipeline
 * and are NULL until it reaches this character (existing rows pre-re-index) — `hp_known` is true only when ALL
 * FOUR are present. A consumer must never feed an `hp_known: false` row to projected_hp/character_max_hp:
 * their defensive `?? 0` would fabricate a level-1 zero-HP character instead of an honest gap. `0` is VALID
 * DATA everywhere (a defeated character's current_hp is 0, a fresh character's experience is 0) — only
 * null/undefined mean unknown (the api serves `?? null`, never dropping a 0).
 * @param {any} row  one /v1 character row (rpc/client.ts get_characters)
 * @returns {PartyCharacter}
 */
export function v1_character_to_party_row(row) {
  const hp_known =
    row?.current_hp != null && row?.hp_updated_ms != null && row?.equipment_stats != null && row?.experience != null
  return {
    id: String(row?.id ?? ''),
    name: String(row?.name ?? ''),
    // §3 class slug — identity (never null on a real row), read by character_max_hp to resolve the per-class
    // base HP (hp_math.base_hp_for_class). NOT part of hp_known (that gates only the HP-block fields below).
    classe: String(row?.class ?? ''),
    experience: Number(row?.experience ?? 0),
    vitality: Number(row?.vitality ?? 0),
    // Compatibility-only positive half; character_max_hp prefers the signed aggregate below.
    gear_vitality: Math.max(0, Number(row?.gear_vitality ?? 0)),
    equipment_stats:
      row?.equipment_stats == null
        ? null
        : Object.fromEntries(Object.entries(row.equipment_stats).map(([key, value]) => [key, Number(value)])),
    current_hp: Number(row?.current_hp ?? 0),
    hp_updated_ms: Number(row?.hp_updated_ms ?? 0),
    hp_known,
  }
}

/**
 * A player's loose (bag) on-chain Items — the UNEQUIPPED items LOCKED across their personal kiosk(s), UNIONED.
 * /v1 FIRST (the indexer's owner→kiosk→items join — `/v1/owner-items`, one keyless read), then the CHAIN-DIRECT
 * kiosk walk as the sanctioned /v1-outage fallback. EVERY item is kiosk-locked (the constitution: `item::lock_in_
 * kiosk` is the ONLY placement path — shop buys, loot, forgemagie, pool swaps and unequips all lock; there is NO
 * address-owned Item), so a `listOwnedObjects(address)` scan finds NONE — the bag is the union of `::item::Item`
 * across ALL the wallet's personal kiosks. An item in ANY of your kiosks is yours; which kiosk holds a given item
 * only matters at tx-build time (resolved per-item there — the threaded `kiosk_id`/`kiosk_cap_id`). Equipped gear
 * is a CHILD of the Character (via the roster, not here). Item stats ride as a dynamic field (read on demand in
 * the detail view); the bag grid needs only these base fields. Listed rows are marketplace inventory, not usable
 * bag inventory, so the /v1 projection drops strict `listed: true` rows here. `stackable` is derived client-side
 * (both paths).
 * @param {{ kiosk_client: any, grpc_client: any }} sdk
 * @param {string} owner
 * @param {string} package_id  the live package id (the `::item::Item` type origin)
 * @param {(owner: string) => Promise<any[]>} [fetch_v1]  the /v1 owner-items fetcher (injected in tests)
 */
export async function get_owned_items(sdk, owner, package_id, fetch_v1 = get_owner_items) {
  // /v1 FIRST — the architectural home: ONE keyless read replaces the N-kiosk chain walk (the indexer maintains
  // the wallet→kiosk→items join, threading each row's SOURCE kiosk + cap). 5s ceiling; ANY /v1 failure (outage,
  // timeout, unexpected shape) DEMOTES to the walk below — a demotion, never a blank bag.
  try {
    const rows = await with_timeout(fetch_v1(owner), 5000, 'owner-items /v1')
    if (Array.isArray(rows)) return rows.filter((row) => row?.listed !== true).map(with_stackable)
  } catch (error) {
    game_log('get_owned_items', '/v1 owner-items unavailable — falling back to chain-direct kiosk walk', error)
  }

  // FALLBACK (the sanctioned /v1-outage path — the reason this walk STAYS, not dead code). Below the frozen
  // read-count baseline: it adds ZERO new chain reads over what this file already had.
  // item_type_id (issue #524's item_lineage — one home for the `${pkg}::item::Item` struct tag, shared with
  // is_aresrpg_item) — same short-circuit as before: an empty/malformed package_id yields no chain walk at all.
  let want
  try {
    want = item_type_id(package_id)
  } catch {
    return []
  }
  if (!want) return []
  const matches = (/** @type {string} */ type) => {
    try {
      return normalizeStructTag(type) === want
    } catch {
      return false
    }
  }
  const { kioskOwnerCaps } = await sdk.kiosk_client.getOwnedKiosks({ address: owner, pagination: { limit: 50 } })
  const personal = (kioskOwnerCaps ?? []).filter((/** @type {any} */ c) => c.isPersonal)
  // Independent round trips (no data dependency between kiosks/items) — fan out with Promise.all (S-56 #3:
  // the serial for-await compounded N×M RPC hops); order is preserved positionally (personal[idx] ↔ kiosks[idx]).
  const kiosks = await Promise.all(
    personal.map((/** @type {any} */ cap) =>
      sdk.kiosk_client.getKiosk({ id: cap.kioskId, options: { withObjects: true } })
    )
  )
  // THREAD each item's SOURCE kiosk (+ that kiosk's cap — free, already in memory from getOwnedKiosks above,
  // zero extra RPC) onto its row. A "visible but not usable" class of bug otherwise recurs forever: a burn/
  // extract PTB (e.g. dungeon_actions.js activate_run's key leg) that assumes an item shares the ACTING
  // character's kiosk aborts EItemNotFound the moment a multi-kiosk wallet's item lives in a sibling kiosk.
  // Carrying the true source kiosk on every row lets a caller target the RIGHT kiosk, permanently — no
  // per-item migration, ever.
  const item_refs = kiosks.flatMap((kiosk, idx) =>
    (kiosk.items ?? [])
      .filter((/** @type {any} */ i) => matches(i.type))
      .map((/** @type {any} */ i) => ({ ...i, kiosk_id: personal[idx].kioskId, kiosk_cap_id: personal[idx].objectId }))
  )
  // ONE batched read per 50 items (read_findables.js:151 idiom) — the per-item getObject fan blew the 10s
  // roster timeout on multi-kiosk wallets (regression, live 2026-07-11): N parallel singles trip the public
  // endpoint's rate limit; a chunked core.getObjects is ceil(N/50) round-trips and immune to it.
  const json_by_id = new Map()
  for (let i = 0; i < item_refs.length; i += 50) {
    const chunk = item_refs.slice(i, i + 50).map((/** @type {any} */ r) => r.objectId)
    // #23 gRPC: `core.getObjects` → { objects: [Object|Error] } where each element is the FLAT object
    // (o.objectId / o.json), NOT nested under `.object`. Only the SINGULAR `core.getObject` returns { object }.
    // Reading `o.object.objectId` here silently matched NOTHING → json_by_id stayed empty → every row dropped to
    // null → a permanently-empty bag whenever /v1 is down (B8: bought keys invisible, dungeon un-enterable).
    // Mirrors the proven batched-read idiom in read_findables.js:152 (flat access + the [Object|Error] guard).
    const { objects } = await sdk.grpc_client.core.getObjects({ objectIds: chunk, include: { json: true } })
    for (const o of objects ?? []) if (!(o instanceof Error) && o?.objectId) json_by_id.set(o.objectId, o.json)
  }
  const items = item_refs.map((/** @type {any} */ ref) => {
    const f = json_by_id.get(ref.objectId)
    if (!f) return null
    return {
      id: ref.objectId,
      // The canonical ItemTemplate id (`Item.template` on chain, `template_id` on the /v1 row) — the ONLY
      // proof two stackables are the same template, so the duplicate-stack sweep (#1495) can plan on this
      // path too. Without it the fallback bag was shape-DIVERGENT from /v1 despite the claim below.
      template_id: f.template ?? null,
      name: f.name ?? '',
      // On-chain the field is `category` (item.move: Item.category); the whole client bag keys off
      // `item_category` (Inventory / DungeonsModal / inventory-equip) — this is the SINGLE rename home.
      item_category: f.category ?? '',
      item_set: f.item_set ?? '',
      item_type: f.item_type ?? '',
      level: Number(f.level ?? 0),
      amount: Number(f.amount ?? 1),
      // The kiosk that HOLDS this item right now (+ its cap) — see the threading note above.
      kiosk_id: ref.kiosk_id,
      kiosk_cap_id: ref.kiosk_cap_id,
    }
  })
  // `stackable` derived here too (single home) so the fallback bag is shape-identical to the /v1 bag.
  return items.filter(Boolean).map(with_stackable)
}
