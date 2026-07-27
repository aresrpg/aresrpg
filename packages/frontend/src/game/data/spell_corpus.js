// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The authored spell corpus — ONE published Walrus blob (spell_corpus.json), fetched at boot like every other
// asset (mirrors game/data/mob_catalog.js — one runtime-content pattern, two consumers). It is the merged
// projection the seed ceremony emits at PUBLISH time: the authored spell rows joined to the deployment's
// on-chain object ids. The client never merges in prod — it fetches the already-merged blob and caches it;
// get_spell_corpus() reads that cache synchronously (fight-spells.js re-derives its rows from it). Gameplay
// content NEVER ships inside the repo: the blob is a runtime asset. Absence (the manifest carries no
// `spell_corpus` row yet — the open-source / pre-publish tree — or the fetch fails) DEGRADES LOUDLY to [] +
// ONE console.error naming the missing asset (issue #106); the spellbook, casting and the encyclopedia go
// inert while the scene still renders. Absence is NEVER cached as truth: a failed load leaves the cache empty
// AND `loaded` false, so a later call still populates it.

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

/** @type {Array<Record<string, any>>} */
let corpus = []
let loaded = false
let warned = false
const listeners = new Set()

const publish = () => {
  for (const listener of listeners) listener()
}

// ONE deduped content-degrade shout (per session). The boot-smoke check allowlists this exact prefix — the
// spell_corpus blob is a seed-side publish dependency, not a repo artifact (issue #106).
const warn_absent = (why) => {
  if (warned) return
  warned = true
  console.error(
    `[spell-corpus] no spell_corpus runtime asset (${why}) — the spellbook, casting and the spell ` +
      `encyclopedia are inert until the seed ceremony publishes spell_corpus.json (issue #106).`
  )
}

/**
 * Fetch the published corpus once and cache it. Non-blocking at boot (the scene mounts while it resolves; the
 * spell surfaces fill in on arrival). No-op-with-a-shout when the manifest has no `spell_corpus` row yet
 * (walrus_asset_url → null) or the fetch fails — leaving the cache empty and RETRYABLE (never a frozen
 * absence). Call after the asset manifest is seeded (main.tsx, post load_asset_manifest).
 * @returns {Promise<void>}
 */
export async function load_spell_corpus() {
  if (loaded) return
  const url = walrus_asset_url('spell_corpus', 'spell_corpus.json')
  if (!url) return warn_absent('not in the asset manifest — unpublished')
  try {
    const response = await fetch(url)
    if (!response.ok) return warn_absent(`HTTP ${response.status}`)
    const rows = await response.json()
    corpus = Array.isArray(rows) ? rows : []
    loaded = true
    publish()
  } catch (error) {
    // Network / parse failure — stay retryable; the spell surfaces stay inert until a later load lands.
    warn_absent(`fetch failed: ${error?.message ?? error}`)
  }
}

/** The cached corpus rows (synchronous — the hot resolver read). Empty until load_spell_corpus resolves it. */
export const get_spell_corpus = () => corpus

/** Subscribe to corpus-reference changes so already-mounted spell surfaces re-resolve after boot loading. */
export const subscribe_spell_corpus = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Test seam (mirrors set_catalog_for_test): seed the module-state corpus directly, no fetch. Pass the merged
 * rows to exercise the real projection (marks the cache loaded), or nothing to reset to PRISTINE — empty and
 * NOT loaded, so load_spell_corpus runs again (the seam the loader-degrade tests need). Always clears the
 * once-per-session degrade latch so a fresh case can re-observe the shout.
 * @param {Array<Record<string, any>>} [next]
 * @returns {void}
 */
export function set_spell_corpus_for_test(next) {
  corpus = Array.isArray(next) ? next : []
  loaded = Array.isArray(next)
  warned = false
  publish()
}
