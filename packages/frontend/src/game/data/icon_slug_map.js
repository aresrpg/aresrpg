// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The icon slug recovery map — ONE published Walrus blob (icon_slug_map.json), fetched at boot like every
// other runtime asset (mirrors game/data/spell_corpus.js — one runtime-content pattern, many consumers). It is
// the content pipeline's authored-slug join: display name -> the item's AUTHORED icon slug, published for
// every item whose art lives under a slug `slugify_name`'s name-derivation misses (renames, `bag_of_*`
// phrasing, apostrophes — issue #160, ~900/1,781 items). The client never builds this map in prod — it
// fetches the published blob and caches it; get_icon_slug_map() reads that cache synchronously
// (chain_icon_slug resolves every fight/inventory/encyclopedia render, so the read must be O(1), never a
// promise). Absence (the manifest carries no `icon_slug_map` row yet — pre-publish — or the fetch fails)
// DEGRADES LOUDLY to {} + ONE console.error naming the missing asset (mirrors spell_corpus.js's issue #106
// pattern): chain_icon_slug's existing slugify_name fallback keeps painting the ~880 name-derivable icons,
// never a throw, while the map-only ~900 stay on their pre-#160 glyph until the map loads. Absence is NEVER
// cached as truth: a failed load leaves the cache empty AND `loaded` false, so a later call still populates it.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

/** @type {Record<string, string>} */
let map = {}
let loaded = false
let warned = false

// ONE deduped content-degrade shout (per session): chain_icon_slug fires on every render, so the warning
// lives here — at the single load event — never inside the hot resolver.
const warn_absent = (why) => {
  if (warned) return
  warned = true
  console.error(
    `[icon-slug-map] no icon_slug_map runtime asset (${why}) — the ~900 authored-slug icons stay on the ` +
      `slugify_name fallback until the seed ceremony publishes icon_slug_map.json (issue #160).`
  )
}

/**
 * Fetch the published name->slug map once and cache it. Non-blocking at boot (chain_icon_slug keeps
 * resolving through slugify_name while this resolves). No-op-with-a-shout when the manifest has no
 * `icon_slug_map` row yet (walrus_asset_url -> null) or the fetch fails — leaving the cache empty and
 * RETRYABLE (never a frozen absence). Call after the asset manifest is seeded (main.tsx, post load_asset_manifest).
 * @returns {Promise<void>}
 */
export async function load_icon_slug_map() {
  if (loaded) return
  const url = walrus_asset_url('icon_slug_map', 'icon_slug_map.json')
  if (!url) return warn_absent('not in the asset manifest — unpublished')
  try {
    const response = await fetch(url)
    if (!response.ok) return warn_absent(`HTTP ${response.status}`)
    const rows = await response.json()
    map = rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {}
    loaded = true
  } catch (error) {
    // Network / parse failure — stay retryable; chain_icon_slug keeps its slugify_name fallback until a
    // later load lands.
    warn_absent(`fetch failed: ${error?.message ?? error}`)
  }
}

/** The cached map (synchronous — the hot resolver read). Empty until load_icon_slug_map resolves it. */
export const get_icon_slug_map = () => map

/**
 * Test seam (mirrors set_spell_corpus_for_test): seed the module-state map directly, no fetch. Pass the
 * published map to exercise the real map-first resolution, or nothing to reset to PRISTINE — empty and NOT
 * loaded, so load_icon_slug_map runs again (the seam the loader-degrade tests need). Always clears the
 * once-per-session degrade latch so a fresh case can re-observe the shout.
 * @param {Record<string, string>} [next]
 * @returns {void}
 */
export function set_icon_slug_map_for_test(next) {
  map = next && typeof next === 'object' ? next : {}
  loaded = next !== undefined
  warned = false
}
