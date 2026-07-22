// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pet look-up catalog — ONE published Walrus blob (pet_catalog.json), fetched at boot through the same
// runtime-content seam as mob_catalog.js. The published rows are keyed by the chain-facing pet slug and carry
// `{ appearance, glb }`; appearance is provenance only, not a resolution input. Every row's `glb` is a bare
// `hy_<appearance>` reference-corpus id — the same identifier space mob rows use — so companion resolution
// reads the cache synchronously, then resolves the row's exact GLB through the EXISTING `mob` asset class
// (mobs.js's resolve_mob_visual_url convention: `${glb}.glb` in the mob quilt), never a pet-only quilt.
// Missing catalog rows and null GLBs stay null all the way to the spawn verdict, so no speculative model request
// can be issued. Failed catalog loads remain retryable rather than caching absence as truth.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

/** @typedef {{ appearance: string | null, glb: string | null }} PetCatalogEntry */
/** @typedef {Record<string, PetCatalogEntry>} PetCatalog */

const create_pet_catalog_cache = () => {
  /** @type {{ catalog: PetCatalog, loaded: boolean }} */
  let state = { catalog: {}, loaded: false }

  /** The cached published rows (synchronous — the companion resolver's hot read). */
  const get_pet_catalog = () => state.catalog

  /**
   * Fetch the published catalog once and cache it. Resolves to a no-op when its manifest class is absent or the
   * request fails, leaving the empty cache retryable. Call after load_asset_manifest() settles.
   * @param {(url_class: string, filename: string) => string | null} [resolve_asset]
   * @param {typeof fetch} [fetch_impl]
   * @returns {Promise<void>}
   */
  const load_pet_catalog = async (resolve_asset = walrus_asset_url, fetch_impl = globalThis.fetch) => {
    if (state.loaded) return
    const url = resolve_asset('pet_catalog', 'pet_catalog.json')
    if (!url) return
    try {
      const response = await fetch_impl(url)
      if (!response.ok) return
      const rows = await response.json()
      state = {
        catalog: /** @type {PetCatalog} */ (rows),
        loaded: true,
      }
    } catch {
      // Network / parse failure — stay retryable; the resolver returns no-spawn until a later load lands.
    }
  }

  /**
   * Test seam: seed published-shape rows directly, or pass nothing to reset to pristine/retryable state.
   * @param {PetCatalog} [next]
   * @returns {void}
   */
  const set_pet_catalog_for_test = (next) => {
    state = { catalog: next ?? {}, loaded: next !== undefined }
  }

  return { get_pet_catalog, load_pet_catalog, set_pet_catalog_for_test }
}

export const { get_pet_catalog, load_pet_catalog, set_pet_catalog_for_test } = create_pet_catalog_cache()

/**
 * Resolve one catalog row's exact GLB through the published `mob` quilt (bytes are shared with mob rendering —
 * see mobs.js's resolve_mob_visual_url). `appearance` is deliberately not a gate; only the row's independent
 * `glb` decides. Missing rows / null `glb` stay null defensively, even though the published catalog no longer
 * ships either as null.
 * @param {string} slug
 * @param {(url_class: string, filename: string) => string | null} [resolve_asset]
 * @param {PetCatalog} [catalog]
 * @returns {string | null}
 */
export const get_pet_model_url = (slug, resolve_asset = walrus_asset_url, catalog = get_pet_catalog()) => {
  const glb = catalog[slug]?.glb ?? null
  return glb ? resolve_asset('mob', `${glb}.glb`) : null
}
