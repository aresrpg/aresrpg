// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ORPHANED-ITEM detection — the ONE home for "this owned item's ItemTemplate was deleted on-chain"
// (templates won't be deleted in prod, but if it ever happens, the app should
// properly handle it and say 'this item was removed from the game, please crush it for runes').
//
// An Item snapshots its own name / item_type / category / rolled-stats at mint (item.move), so a deleted
// template dangles no LIVE data — but the shared display/crush/equip surfaces JOIN the item's `item_type`
// slug to the template map (read_findables.get_template_by_item_type_map) for level/stat-ranges/display and,
// crucially, the template OBJECT id the crush & equip PTBs need. When that join misses, the template is gone.
//
// SAFETY (the load-vs-delete distinction — the one way this could go catastrophically wrong): the template
// map is MEMOIZED and resolves to an EMPTY map on any read failure, so "slug absent" is ambiguous — it means
// either "burned" or "the read hasn't landed / failed". We treat an item as removed ONLY when the map has
// REAL entries (`size > 0`) yet lacks this slug: a populated projection genuinely omits burned templates,
// while a still-loading / errored-empty map flags
// NOTHING — a live item is never mislabelled "removed" during an outage. Pure + DOM-less (bun:test-able,
// same split as forge_eligibility.ts).

type ItemLike = { item_type?: string } | null | undefined

/**
 * True when `item`'s template has been deleted on-chain — i.e. the loaded template map holds real templates
 * but not this item's slug. Returns false while the map is empty (still loading / read failed) so a live item
 * is never falsely flagged during an outage.
 * @param item        an owned bag/equipped item (carries the `item_type` slug)
 * @param template_map get_template_by_item_type_map()'s slug→template Map (empty until the fetch lands)
 */
export function is_template_removed(item: ItemLike, template_map: Map<string, any> | null | undefined): boolean {
  return !!item?.item_type && template_map instanceof Map && template_map.size > 0 && !template_map.has(item.item_type)
}
