// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure §9 dungeon-key candidate selection from the ALREADY-LOADED bag (`s.sui.items`) — the fast path that
// killed the ~10s entry stall (a live regression: "Entering the dungeon… ~10s, this is a violation").
//
// WHY THIS EXISTS: the entry key used to be found by an O(kiosks×items) SEQUENTIAL chain scan
// (run_reads.find_key_item) run INSIDE the entry toast. But the bag DungeonsModal already renders
// (get_owned_items → `s.sui.items`) threads every item's SOURCE kiosk + cap ALONGSIDE its id — the exact
// {id, kiosk_id, kiosk_cap_id} triple the burn PTB needs, captured TOGETHER on one row (no cross-source
// divergence — the P0 `0x2::kiosk::list` EItemNotFound class find_key_item hardened). So the client already
// HOLDS the key's provenance; only the template needs a one-read chain check (run_reads.resolve_entry_key).
// Splitting this pure filter out keeps run_reads.js's chain code testable without a bag fixture.

import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

/**
 * The bag's §9 key rows that carry FULL burn-PTB provenance, in bag order. A row qualifies only when it is a
 * key AND carries the whole {id, kiosk_id, kiosk_cap_id} triple — a /v1 row can have a null `kiosk_cap_id`
 * (unusable for the burn leg), so it is DROPPED, never guessed; resolve_entry_key then re-derives it live.
 * @param {any[]} items the loaded bag (`s.sui.items`)
 * @returns {{ id: string, kiosk_id: string, kiosk_cap_id: string }[]}
 */
export function key_candidates(items) {
  return (Array.isArray(items) ? items : [])
    .filter((i) => i?.item_category === ITEM_CATEGORY.KEY && i?.id && i?.kiosk_id && i?.kiosk_cap_id)
    .map((i) => ({ id: i.id, kiosk_id: i.kiosk_id, kiosk_cap_id: i.kiosk_cap_id }))
}
