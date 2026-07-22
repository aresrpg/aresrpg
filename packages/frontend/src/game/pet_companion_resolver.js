// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { get_pet_model_url } from './data/pet_catalog.js'

// Call-time read on purpose: vite statically inlines `import.meta.env.DEV`; bun
// tests flip `process.env.DEV` per-call instead of racing the process-global module registry.
const is_dev = () => Boolean(import.meta.env.DEV)

const no_companion = () => ({ spawn: false, glb_url: null, key: null })
const companion_for_slug = (slug, resolve_model) => {
  if (!slug) return no_companion()
  const glb_url = resolve_model(slug)
  return glb_url ? { spawn: true, glb_url, key: slug } : no_companion()
}

/**
 * Pure decision helper — equipped-pet state -> spawn/despawn + appearance verdict. DEV `?pet=<slug>` /
 * `window.__force_pet` selects a slug (QA path, mirrors resolve_mount's `?mount=`), else the live
 * `pet_equipped` + sibling `pet.slug` (character_pet_projection's honest identity-snapshot-gap contract:
 * `pet_equipped: true` with a null `pet` must never spawn a placeholder). Pure over the supplied
 * character; safe on null/partial input. Every slug must resolve through the published pet catalog: a missing
 * row or null GLB returns no-spawn, structurally preventing the rig from issuing a model request.
 * @param {any} character the live selected character (carries pet/pet_equipped from the /v1 read-model)
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @param {(slug: string) => string | null} [resolve_model] catalog-backed model lookup
 * @returns {{ spawn: boolean, glb_url: string | null, key: string | null }}
 */
export function resolve_pet_companion(character, search, resolve_model = get_pet_model_url) {
  if (is_dev()) {
    const query = search ?? (typeof location !== 'undefined' ? location.search : '')
    const forced = typeof window !== 'undefined' ? /** @type {any} */ (window).__force_pet : null
    const slug = (forced && String(forced)) || new URLSearchParams(query).get('pet')
    if (slug) return companion_for_slug(slug, resolve_model)
  }
  const equipped = character?.pet_equipped === true
  const slug = equipped && typeof character?.pet?.slug === 'string' ? character.pet.slug : ''
  return companion_for_slug(slug, resolve_model)
}
