// The mob look-up catalog — ONE published Walrus blob (mob_catalog.json), fetched at boot like every other
// asset. It is the merged projection of the two heritage tables (mob_models: catalog-key/variant → {appearance};
// hytale_appearances: appearance → extracted-GLB basename), COLLAPSED to one hop at PUBLISH time (the seed
// ceremony's mob_catalog leg). The client never merges in prod — it fetches the already-merged blob and caches
// it; get_catalog() reads that cache synchronously (get_mob_model re-derives every fight frame, so the read
// must be O(1), never a promise). Absence (the manifest carries no `mob_catalog` row yet, or the fetch fails)
// resolves to {} — every consumer has a LOUD miss-path (mobs.js debug cube + deduped console.error), so mobs
// render the debug cube loudly until the blob publishes, the same progressive behavior the Walrus asset move
// already exhibits. Absence is NEVER cached as truth: a failed load leaves the cache empty AND `loaded` false,
// so a later call still populates it.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

/** @typedef {{ appearance: string | null, glb: string | null }} CatalogEntry */

/** @type {Record<string, CatalogEntry>} */
let catalog = {}
let loaded = false

/**
 * Merge the two heritage tables into the published catalog shape — the EXACT projection the seed ceremony's
 * publish leg emits, kept here as the single home for that shape (prod fetches the merged blob; the client's
 * unit tests reconstruct it from the source tables until the seed leg exists). Pure. Every mob_models key is
 * kept (even a null appearance) so a `variant` hit blocks the name-key fall-through exactly as the two-hop
 * resolver did; a null / unmapped appearance collapses to `glb: null`, the value the miss-path already handles.
 * @param {Record<string, { appearance?: string | null } | undefined>} mob_models
 * @param {Record<string, string | undefined>} hytale_appearances
 * @returns {Record<string, CatalogEntry>}
 */
export function merge_mob_catalog(mob_models, hytale_appearances) {
  return Object.fromEntries(
    Object.entries(mob_models).map(([key, entry]) => {
      const appearance = entry?.appearance ?? null
      return [key, { appearance, glb: appearance ? (hytale_appearances[appearance] ?? null) : null }]
    })
  )
}

/**
 * Fetch the published catalog once and cache it. Non-blocking at boot (the world mounts while it resolves;
 * mobs pop from debug-cube to model on arrival). Resolves to a no-op when the manifest has no `mob_catalog`
 * row yet (walrus_asset_url → null) or the fetch fails — leaving the cache empty and RETRYABLE (never a frozen
 * absence). Call after the asset manifest is seeded (main.tsx, post load_asset_manifest).
 * @returns {Promise<void>}
 */
export async function load_mob_catalog() {
  if (loaded) return
  const url = walrus_asset_url('mob_catalog', 'mob_catalog.json')
  if (!url) return
  try {
    const response = await fetch(url)
    if (!response.ok) return
    catalog = /** @type {Record<string, CatalogEntry>} */ (await response.json())
    loaded = true
  } catch {
    // Network / parse failure — stay retryable; mobs render the debug cube loudly until a later load lands.
  }
}

/** The cached catalog (synchronous — the hot resolver read). Empty until load_mob_catalog resolves it. */
export const get_catalog = () => catalog

/**
 * Test seam (mirrors reset_asset_manifest_for_test): seed the module-state catalog directly, no fetch. Pass a
 * merged catalog (via merge_mob_catalog) to exercise the real resolution path, or nothing to reset to empty.
 * @param {Record<string, CatalogEntry>} [next]
 * @returns {void}
 */
export function set_catalog_for_test(next) {
  catalog = next ?? {}
  loaded = true
}
