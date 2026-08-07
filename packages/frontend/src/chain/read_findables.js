// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Findable-item resolution for the EXPLORATION world cards — maps a World's on-chain `drop_table`
// (`[{ item_template, percent }]`) to the two labelled clusters the card shows: GEAR (non-stackable
// equippables) and RESOURCES (stackable). The gear/resource split comes from each template's
// `item_category` (item.move's verify_category domain), read from the /v1 template projection.
// Memoized module-side (templates change rarely; every card reuses one fetch) — HONEST: on error it
// resolves to an empty map, so a card degrades to "no findables" rather than fabricating drops. That empty
// map is NEVER memoized (#1488, never-cache-absence): only a successful read earns the session-long cache.

import { get_encyclopedia } from '../rpc/client'

import { get_sdk } from './sdk'
import { normalize_item_template, decode_item_stat_ranges, decode_item_damages } from './read_templates.js'

// normalize_item_template UPPERCASEs item_category, so RESOURCE/CONSUMABLE/RUNE are the stackable categories
// (mirrors item.move `is_stackable_category` — rune joined 2026-07-11 with the single-tx crush mint; all gear
// is non-stackable).
const STACKABLE = new Set(['RESOURCE', 'CONSUMABLE', 'RUNE'])

let _templates_promise =
  /** @type {Promise<Map<string, { id: string, name: string, category: string, item_type: string,
   *   level: number, statsJson: string, damages: Array<{ from: number, to: number, damage_type: string, element: string }>,
   *   display: { name: string, image_url: string, description: string } | null }>> | null} */ (null)

/**
 * The `/v1/encyclopedia` item projection serves the authored StatsMin/MaxKey ranges as BIASED
 * `{ chain_field: [min, max] }` (issue #219; a chain-neutral half is null, both present in practice).
 * Split the pairs back into the min/max half-blocks `decode_item_stat_ranges` consumes — the ONE stat
 * decode home (un-bias + snake→camel rename + neutral-drop), shared with the SDK read path. `{}` (a
 * template with no ranges, or one the snapshot has not reached pre-backfill) decodes to `{}` → the card
 * renders honest-empty, never fabricated zeros.
 */
export function item_stats_from_v1(v1_stats) {
  const min = {}
  const max = {}
  for (const [field, pair] of Object.entries(v1_stats ?? {})) {
    const [lo, hi] = Array.isArray(pair) ? pair : [pair, pair]
    if (lo != null) min[field] = lo
    if (hi != null) max[field] = hi
  }
  return decode_item_stat_ranges(min, max)
}

const stats_json_from_v1 = (v1_stats) => JSON.stringify(item_stats_from_v1(v1_stats))

/**
 * The `/v1/encyclopedia` item projection serves a weapon template's authored `item_damages::DamagesKey` lines
 * verbatim — the EXACT shape the SDK's own template read produces (issue #619) — so they go through the SAME
 * decode home the SDK path uses. Twin of `item_stats_from_v1` above: one decoder, both read paths.
 * @param {Array<{ from?: number, to?: number, damage_type?: string, element?: string }> | null | undefined} v1_damages
 * @returns {Array<{ from: number, to: number, damage_type: string, element: string }>}
 */
export function item_damages_from_v1(v1_damages) {
  return decode_item_damages(v1_damages)
}

/**
 * id → the legacy template-row shape, adapted from the `/v1/encyclopedia` item projection. The projection
 * carries exact identity/name/category/level plus the authored stat ranges (issue #219, decoded below);
 * fields it still does not index (Display image data) keep explicit empty defaults. Memoized on SUCCESS only;
 * a failed read degrades that one caller to an empty map and leaves the memo cold for the next.
 */
async function read_template_map() {
  const { items } = await get_encyclopedia('items')
  const map = new Map()
  for (const t of items ?? []) {
    const id = String(t.template_id ?? '')
    if (!id) continue
    map.set(id, {
      id,
      item_type: String(t.item_type ?? ''),
      name: String(t.name ?? ''),
      category: String(t.category ?? '').toUpperCase(),
      level: Number(t.level ?? 0),
      // Authored [min,max] characteristics from the /v1 stat projection (issue #219), decoded through
      // the single stat_bias home. The indexer projection still has no Display image data.
      statsJson: stats_json_from_v1(t.stats),
      // Authored weapon damage lines from the same projection (issue #619) — every owned/template item
      // surface resolves its template through this map, so dropping them here blanked the damage block
      // on all of them at once.
      damages: item_damages_from_v1(t.damages),
      display: null,
    })
  }
  return map
}

export function get_template_map() {
  if (!_templates_promise) {
    // NEVER CACHE ABSENCE (#1488): a failed read is not an answer. The rejection still degrades THIS caller to
    // an empty map (honest — the card shows "no findables"), but it DROPS the memo, so the next caller re-reads.
    // The `.catch` handler is always a microtask, so `attempt` is bound by the time it runs; the identity check
    // means a retry already in flight is never cleared out from under its own callers.
    const attempt = read_template_map().catch(() => {
      if (_templates_promise === attempt) _templates_promise = null
      return new Map()
    })
    _templates_promise = attempt
  }
  return _templates_promise
}

/**
 * D121 — the SINGLE item-template accessor as an ARRAY (get_template_map's rows). RETIRED as the shared catalog
 * fetch for shop + marketplace enrichment — both have SINCE migrated to /v1 encyclopedia reads (S-61/S-86); no
 * external callers remain today. Root-cause fix (at the time) for the triple
 * template read the N+1 audit found. Empty array on error (map degrades to empty).
 * @returns {Promise<Array<any>>}
 */
/** Test-only: drop the memoized catalog (the bun test process is long-lived and this module holds session state). */
export function reset_template_cache_for_test() {
  _templates_promise = null
}

export async function get_item_templates_cached() {
  const map = await get_template_map()
  return [...map.values()]
}

/**
 * Split a World's drop_table into gear vs resource findables + a density-ratio readout. Each row carries
 * the projected template fields plus the adapter's honest display/stat defaults, so consumers share one
 * shape without issuing another read per hover.
 * @param {Array<{ item_template: string, percent: number }>} drop_table
 * @param {Map<string, any>} template_map
 * @returns {{ gear: Array<any>, resources: Array<any> }}
 */
export function split_findables(drop_table, template_map) {
  const gear = []
  const resources = []
  for (const entry of drop_table ?? []) {
    const id = String(entry?.item_template ?? '')
    if (!id) continue
    const tmpl = template_map?.get(id)
    const row = {
      id,
      name: tmpl?.name ?? '',
      category: tmpl?.category ?? '',
      item_type: tmpl?.item_type ?? '', // asset slug for ItemImage (NOT the object id → that 404s)
      percent: Number(entry?.percent ?? 0),
      level: tmpl?.level ?? 0,
      statsJson: tmpl?.statsJson ?? '{}',
      damages: tmpl?.damages ?? [],
      display: tmpl?.display ?? null,
    }
    // Unknown category (template not resolved) → treat as gear (an item drop), never silently dropped.
    if (tmpl && STACKABLE.has(tmpl.category)) resources.push(row)
    else gear.push(row)
  }
  return { gear, resources }
}

/**
 * item_type (slug) → the same full template row as get_template_map (keyed by object id there). Every
 * on-chain Item instance (bag/equipped/recall drop) carries only the slug, never the template's object
 * id, so this is the lookup every item-owning surface needs to resolve a real item's stats/display.
 * Memoized (derives from get_template_map's single fetch).
 * @returns {Promise<Map<string, any>>}
 */
export async function get_template_by_item_type_map() {
  const by_id = await get_template_map()
  const by_type = new Map()
  for (const tmpl of by_id.values()) if (tmpl.item_type) by_type.set(tmpl.item_type, tmpl)
  return by_type
}

/**
 * Read only the exact ItemTemplates a surface is about to show, including their chain-owned stat DFs.
 * This is the targeted companion to the inventory/findables template maps above: identity still comes
 * from the receipt's template id, while the SDK's canonical ItemTemplate reader + normalize_item_template
 * remain the single decode path for CHARACTERISTICS. One failed row is omitted; siblings still render.
 * @param {string[]} template_ids
 * @returns {Promise<Map<string, any>>}
 */
export async function get_template_detail_map(template_ids) {
  const ids = [...new Set((template_ids ?? []).map(String).filter(Boolean))]
  if (!ids.length) return new Map()
  try {
    const sdk = await get_sdk()
    const rows = await Promise.all(ids.map(async (id) => [id, await sdk.get_item_template(id).catch(() => null)]))
    return new Map(rows.filter(([, row]) => !!row).map(([id, row]) => [id, normalize_item_template(row, id, null)]))
  } catch {
    return new Map()
  }
}
