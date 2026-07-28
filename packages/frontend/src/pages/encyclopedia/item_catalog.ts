// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fresh SPEC §12 template catalog — DERIVED FROM seed/mainnet/**/*.json (the SAME corpus that mints on-chain
// templates) at build/serve time via the `virtual:item_catalog` module (packages/frontend/dev/item_catalog_plugin.ts),
// over the ONE shared transform (scripts/lib/item_catalog_transform.mjs). There is NO checked-in item_catalog.json /
// item_slugs.json anymore: owner SSOT ruling 2026-07-14 ("you let multiple source of truth path? … delete it
// immediately, use the exact same seed data we push on chain") — a checked-in seed-derived artifact went stale
// after a rebalance and served L180 stats on an L4 item (walker_hat). Build-time derivation makes that
// structurally impossible.
//
// This is the join target for an item's AUTHORED CHARACTERISTICS (stat ranges / damages / rarity / seed itemType)
// — fields the §14 /v1 liveness index does not carry (see items_tab.tsx's file header).
//
// Join key: SLUG ONLY, via the name→slug map. Never NAME (a renamed item's on-chain name has no reason to exist
// in an unrelated legacy dataset) and never an array index. No catalog row for a slug => undefined — the caller
// renders honest-empty, never a neighbor's stats. (This REPLACED an older join against use_content().templates.item
// — packages/sdk/src/items.json, a STALE 2026-06-29 legacy FalkorDB snapshot — whose ids coincidentally overlapped
// the seed corpus and resolved "Koa Slime Codex" to the WRONG catalog's row; item_catalog.test.ts pins that case.)
import { map_stats } from './content'

export interface CatalogEntry {
  rarity?: string
  item_type?: string
  stats: Record<string, number | [number, number]>
  damages: { element: string; from: number; to: number }[]
}

interface RawCatalogEntry {
  rarity?: string
  /** The seed transform's legacy field name; this value is row.itemType, not an equip requirement. */
  weapon_class?: string
  stats?: Record<string, [number, number]>
  damages?: { element: string; from: number; to: number }[]
}

/** The two seed-derived maps, injected at the call site: production passes them from `virtual:item_catalog`;
 * the unit test recomputes them live from seed via the shared transform. One data source, two entry points. */
export interface CatalogData {
  catalog: Record<string, RawCatalogEntry>
  slugs: Record<string, string>
}

/** Bind the seed-derived maps ONCE and get back the name resolver. The returned `catalog_for_name` resolves a
 * live item's authored characteristics by its on-chain NAME through the honest slug join (name -> slug ->
 * catalog row). It returns undefined when the name has no slug or the slug has no catalog row — the caller must
 * render honest-empty, never fabricate a value or fall back to a name-keyed lookup. */
export function make_catalog_lookup({ catalog, slugs }: CatalogData) {
  return function catalog_for_name(name: string): CatalogEntry | undefined {
    const slug = slugs[name]
    if (!slug) return undefined
    const row = catalog[slug]
    if (!row) return undefined
    return {
      rarity: row.rarity,
      item_type: row.weapon_class,
      stats: map_stats(row.stats ?? {}),
      damages: row.damages ?? [],
    }
  }
}

/** Resolve the existing `/encyclopedia/items/:id` route segment after live rows arrive. Template object IDs are
 * canonical; a seed slug fallback lets stable cross-surfaces (such as loot-box pools) deep-link across deployments. */
export function selected_item_for_route<T extends { id: string; slug?: string }>(
  items: readonly T[],
  route_id: string | null
): T | null {
  if (!route_id) return null
  return items.find((item) => item.id === route_id || item.slug === route_id) ?? null
}

export function related_items_for_job<T extends { template_id: string }>(
  items: readonly T[] | null | undefined,
  gatherables: readonly { id: string; job: number; tier: number }[],
  rare_links: readonly { template_id: string; rare_template_id: string }[] | null | undefined,
  recipes: readonly { output_template_id: string; required_job: number }[] | null | undefined,
  job_index: number
): T[] {
  if (!items || job_index < 0) return []
  const gatherable_ids = new Set(
    gatherables.filter((gatherable) => gatherable.job === job_index).map((gatherable) => gatherable.id)
  )
  const related_ids = new Set(gatherable_ids)
  for (const link of rare_links ?? []) {
    if (gatherable_ids.has(link.template_id)) related_ids.add(link.rare_template_id)
  }
  for (const recipe of recipes ?? []) {
    if (recipe.required_job === job_index) related_ids.add(recipe.output_template_id)
  }
  return items.filter((item) => related_ids.has(item.template_id))
}
