// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pet-companion DECISION layer, split from pet_companion.js's rig factory so it carries NO @aresrpg/engine3
// import (engine3/player statically pulls in the private content repo's senshi_male.glb — issue #117 — so any
// test importing the rig factory needs that asset; this module stays testable without it, engine-free by
// construction).
//
// #526 — every equipped pet renders NO world companion. Root cause: resolve_pet_companion resolved appearance
// through cosmetic_glb.js's cosmetic_glb_url, the worn-cosmetic convention (`<slug>.glb` in the COSMETIC
// quilt) — but no pet's art was ever published there; EVERY pet slug 404s against that quilt (verified live,
// testnet). A catalog-based fix already existed for this exact class of bug (#266) but never reached edge: it
// resolves through data/pet_catalog.js, the LOCKED Hytale-33 roster (exact slug match) whose `glb` lives in the
// published `mob` quilt. That alone still misses this ticket's two repro pets (pet_bouloute / pet_modni_lyk):
// they predate the Hytale-33 catalog and were never added to it. Their creature art is published instead under
// the ALREADY-LIVE mob catalog (data/mob_catalog.js — the same one mob rendering resolves through, verified
// live), keyed WITHOUT the item's `pet_` slug prefix (`bouloute` -> Lamb, `modni_lyk` -> Cat_Viki; `pet_siluri`
// is the one legacy row that kept its prefix there, so the exact key is tried before the stripped one). Both
// catalogs' `glb` resolves through the SAME published `mob` quilt — pets are drawn from the shared creature
// corpus, never a pet-only quilt. No match anywhere -> no-spawn, logged once per distinct slug (this resolves
// every frame — dedupe, never flood): the no-silent-substitute law applied to pets.

import { get_pet_catalog } from './data/pet_catalog.js'
import { get_catalog as get_mob_catalog } from './data/mob_catalog.js'
import { game_log } from '../core/log.js'
import { model_asset_url } from './model_asset_url.js'

// Call-time read on purpose (cosmetic_glb.js's law): vite statically inlines `import.meta.env.DEV`; bun
// tests flip `process.env.DEV` per-call instead of racing the process-global module registry.
const is_dev = () => Boolean(import.meta.env.DEV)

/** Slugs already warned about — resolve_pet_companion runs every frame, so dedupe instead of flooding. */
const warned_slugs = new Set()

/**
 * Resolve an equipped pet's slug to a served GLB url through the published catalogs — see the module header
 * for the two-catalog join. Pure aside from the deduped miss log. @param {string} slug @returns {string | null}
 */
export function resolve_pet_model_url(slug) {
  const pet_catalog = get_pet_catalog()
  const mob_catalog = get_mob_catalog()
  const glb = pet_catalog[slug]?.glb ?? mob_catalog[slug]?.glb ?? mob_catalog[slug.replace(/^pet_/, '')]?.glb ?? null
  if (glb) return model_asset_url('mob', `${glb}.glb`)
  if (!warned_slugs.has(slug)) {
    warned_slugs.add(slug)
    game_log('pet', `no catalog entry for equipped pet slug '${slug}' — companion stays unspawned`)
  }
  return null
}

const no_companion = () => ({ spawn: false, glb_url: null, key: null })
const companion_for_slug = (slug, resolve_model) => {
  if (!slug) return no_companion()
  const glb_url = resolve_model(slug)
  return glb_url ? { spawn: true, glb_url, key: slug } : no_companion()
}

/**
 * Pure decision helper — equipped-pet state -> spawn/despawn + appearance verdict. DEV `?pet=<slug>` /
 * `window.__force_pet` forces a slug (QA path, mirrors resolve_mount's `?mount=`), else the live
 * `pet_equipped` + sibling `pet.slug` (character_pet_projection's honest identity-snapshot-gap contract:
 * `pet_equipped: true` with a null `pet` must never spawn a placeholder). Pure over the supplied character
 * (and the injected resolver); safe on null/partial input. Every slug resolves through the published catalogs
 * (resolve_pet_model_url by default) — an unresolvable slug is an honest no-spawn, never a placeholder or a
 * speculative model request.
 * @param {any} character the live selected character (carries pet/pet_equipped from the /v1 read-model)
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @param {(slug: string) => string | null} [resolve_model] catalog-backed model lookup (injectable for tests)
 * @returns {{ spawn: boolean, glb_url: string | null, key: string | null }}
 */
export function resolve_pet_companion(character, search, resolve_model = resolve_pet_model_url) {
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
