// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pet look-up catalog — ONE published asset-host blob (pet_catalog.json), fetched at boot like every other
// runtime-content asset (mirrors game/data/mob_catalog.js — one pattern, two catalogs). Rows are keyed by the
// locked, authored pet roster's slug (seed-side membership, out of this repo's content boundary — see
// CLAUDE.md) and carry `{ appearance, glb }`; `glb` resolves through the SAME published `mob` quilt mob
// rendering already uses (pets are drawn from the shared creature corpus, never a pet-only quilt) — see
// pet_companion_resolver.js's resolve_pet_model_url, which also falls back to this ALREADY-LIVE mob catalog
// for the earlier pet generation (bouloute, modni_lyk, tokeko, …) whose creature art was published there
// first, before this catalog existed (#526). Absence (the manifest carries no `pet_catalog` row yet, or the
// fetch fails) resolves to {} and stays RETRYABLE, never cached as truth — mirrors mob_catalog.js's contract.

import { asset_url } from '@aresrpg/sdk/jobs'

/** @typedef {{ appearance: string | null, glb: string | null }} PetCatalogEntry */

/** @type {Record<string, PetCatalogEntry>} */
let catalog = {}
let loaded = false

/**
 * Fetch the published catalog once and cache it. Non-blocking at boot (the world mounts while it resolves;
 * equipped pets pop in on arrival). Resolves to a no-op when the manifest has no `pet_catalog` row yet
 * (asset_url → null) or the fetch fails — leaving the cache empty and RETRYABLE (never a frozen
 * absence). Call after the asset manifest is seeded (main.tsx, post load_asset_manifest).
 * @returns {Promise<void>}
 */
export async function load_pet_catalog() {
  if (loaded) return
  const url = asset_url('pet_catalog', 'pet_catalog.json')
  if (!url) return
  try {
    const response = await fetch(url)
    if (!response.ok) return
    catalog = /** @type {Record<string, PetCatalogEntry>} */ (await response.json())
    loaded = true
  } catch {
    // Network / parse failure — stay retryable; companions resolve through the mob_catalog fallback (or stay
    // unspawned) until a later load lands.
  }
}

/** The cached catalog (synchronous — the hot resolver read). Empty until load_pet_catalog resolves it. */
export const get_pet_catalog = () => catalog

/**
 * Test seam (mirrors mob_catalog.js's set_catalog_for_test): seed the module-state catalog directly, no
 * fetch. Pass a catalog to exercise the real resolution path, or nothing to reset to empty/retryable.
 * @param {Record<string, PetCatalogEntry>} [next]
 * @returns {void}
 */
export function set_pet_catalog_for_test(next) {
  catalog = next ?? {}
  loaded = next !== undefined
}
