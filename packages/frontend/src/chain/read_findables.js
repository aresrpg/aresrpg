// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Findable-item resolution for the EXPLORATION world cards — maps a World's on-chain `drop_table`
// (`[{ item_template, percent }]`) to the two labelled clusters the card shows: GEAR (non-stackable
// equippables) and RESOURCES (stackable). The gear/resource split comes from each template's
// `item_category` (item.move's verify_category domain), read from the /v1 template projection.
// Memoized module-side (templates change rarely; every card reuses one fetch) — HONEST: on error it
// resolves to an empty map, so a card degrades to "no findables" rather than fabricating drops.

import { get_encyclopedia } from '../rpc/client'

import { get_sdk } from './sdk'
import { normalize_item_template, decode_item_stat_ranges } from './read_templates.js'

// normalize_item_template UPPERCASEs item_category, so RESOURCE/CONSUMABLE/RUNE are the stackable categories
// (mirrors item.move `is_stackable_category` — rune joined 2026-07-11 with the single-tx crush mint; all gear
// is non-stackable).
const STACKABLE = new Set(['RESOURCE', 'CONSUMABLE', 'RUNE'])

let _templates_promise =
  /** @type {Promise<Map<string, { id: string, name: string, category: string, item_type: string,
   *   level: number, statsJson: string, display: { name: string, image_url: string, description: string } | null }>> | null} */ (
    null
  )

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
 * id → the legacy template-row shape, adapted from the `/v1/encyclopedia` item projection. The projection
 * carries exact identity/name/category/level plus the authored stat ranges (issue #219, decoded below);
 * fields it still does not index (Display image data) keep explicit empty defaults. Memoized; empty map on error.
 */
export function get_template_map() {
  if (!_templates_promise)
    _templates_promise = (async () => {
      try {
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
            display: null,
          })
        }
        return map
      } catch {
        return new Map()
      }
    })()
  return _templates_promise
}

/**
 * D121 — the SINGLE item-template accessor as an ARRAY (get_template_map's rows). RETIRED as the shared catalog
 * fetch for shop + marketplace enrichment — both have SINCE migrated to /v1 encyclopedia reads (S-61/S-86); no
 * external callers remain today. Root-cause fix (at the time) for the triple
 * template read the N+1 audit found. Empty array on error (map degrades to empty).
 * @returns {Promise<Array<any>>}
 */
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

/**
 * Resolve a recall haul's freshly-minted `item_ids` into real per-drop templates for the RESULT CARD —
 * a minted `Item` carries only { name, item_category, item_type, level, amount, stackable } (item.move),
 * NOT its stats/Display, so we (1) batch-read the minted Items themselves for their `item_type` + `amount`,
 * then (2) resolve each `item_type` against the template map (by slug, since templates are keyed by object
 * id and Items carry only the slug). HONEST: an id that fails to resolve (RPC miss) is dropped rather than
 * shown with fabricated data.
 * @param {string[]} item_ids
 * @param {Map<string, any>} template_map keyed by object id (get_template_map's shape)
 * @returns {Promise<Array<any>>}
 */
export async function resolve_recall_drops(item_ids, template_map) {
  if (!item_ids?.length) return []
  try {
    const sdk = await get_sdk()
    const minted = await get_owned_items_by_id(sdk.grpc_client, item_ids)
    const by_type = new Map()
    for (const tmpl of template_map?.values() ?? []) if (tmpl.item_type) by_type.set(tmpl.item_type, tmpl)
    return minted.map((it) => {
      const tmpl = by_type.get(it.item_type)
      return {
        id: it.id,
        item_type: it.item_type,
        name: tmpl?.name || it.name,
        amount: it.amount,
        level: it.level || tmpl?.level || 0,
        statsJson: tmpl?.statsJson ?? '{}',
        display: tmpl?.display ?? null,
      }
    })
  } catch {
    return []
  }
}

/** Batch-fetch specific Item object ids (the freshly-minted recall drops), same shape as get_owned_items. */
async function get_owned_items_by_id(
  /** @type {import("@mysten/sui/grpc").SuiGrpcClient} */ grpc_client,
  /** @type {string[]} */ ids
) {
  const out = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    // #23 gRPC: getObjects → { objects:[Object|Error] }; json:true flattens the Item's scalar fields.
    const { objects } = await grpc_client.core.getObjects({ objectIds: chunk, include: { json: true } })
    for (const o of objects ?? []) {
      if (o instanceof Error) continue
      const f = o?.json
      if (!f) continue
      out.push({
        id: o.objectId,
        name: f.name ?? '',
        item_type: f.item_type ?? '',
        level: Number(f.level ?? 0),
        amount: Number(f.amount ?? 1),
      })
    }
  }
  return out
}
