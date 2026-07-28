// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REMOTE CHARACTER CACHE — the peer half of two render facts that both resolve off the SAME `/v1/characters`
// doc: TR-97's worn cosmetics (cosmetic_glb.js's resolve_worn_cosmetics joins a doc against the
// `/v1/encyclopedia` template catalog into `{head,back}` rig slots for the LOCAL player, embed_voxel_player.js;
// this is that join applied to every REMOTE peer) and #553's public pets (pet_companion_resolver.js's
// resolve_pet_companion reads the SAME doc's `pet`/`pet_equipped` — the identical catalog-backed resolution the
// LOCAL player's own companion already uses, embed_voxel_player.js's `desired_pet`).
//
// TRANSPORT RULING (worn cosmetics AND pets both fall under it): both load from the rpc directly. A peer's worn
// hat/cloak or equipped pet is chain truth a player can't fake, so both resolve from /v1
// (character_name_resolve.js's resolve_character_docs — the SAME batched-fetch home the fight roster already
// uses for co-fighter names).
//
// ONE fetch drives BOTH derived views — this is deliberate, not an accident of file history: the two facts live
// on the identical doc, so a second batched-fetch cache alongside this one would double the peer /v1 read load
// for zero new information. Batched + cached: every stale/missing peer id across the current rig set resolves
// in ONE /v1/characters?ids= read per refresh wave (never one fetch per peer per frame — remote_players.js's
// frame loop runs at 60fps). TTL-bounded (~60s — an equip lands within the window); a peer with no cache row
// yet always counts as stale, so a freshly-spawned rig resolves on its very next refresh call — no separate
// "identity change" trigger needed. Never caches an absence permanently: a failed/pending id just stays stale
// and retries the next call.

import { resolve_character_docs } from '../world-shell/character_name_resolve.js'

import { has_veteran_title, resolve_worn_cosmetics } from './cosmetic_glb.js'
// pet_companion_resolver.js, never pet_companion.js — the resolver split carries NO @aresrpg/engine3 import
// (issue #117), so this cache (and its test) stays runnable in every checkout, including the public one where
// the private character GLB is absent.
import { resolve_pet_companion } from './pet_companion_resolver.js'

const CHARACTER_TTL_MS = 60_000

const BLANK_WORN = { head: null, back: null }
const NO_PET = { spawn: false, glb_url: null, key: null }

/**
 * @param {{
 *   fetch_characters?: (query:{ids:string[]}) => Promise<any[]>,
 *   templates?: () => Map<string, any>,
 *   now?: () => number,
 * }} [deps] pure-injection test seam (defaults: the real rpc/client fetch, no template catalog, Date.now)
 */
export function create_remote_character_cache(deps = {}) {
  const templates = deps.templates ?? (() => new Map())
  const now = deps.now ?? (() => Date.now())
  /** @type {Map<string, { worn: {head:any, back:any}, pet: {spawn:boolean, glb_url:string|null, key:string|null}, veteran: boolean, resolved_at: number }>} */
  const cache = new Map()
  const pending = new Set()

  /** The last-resolved worn set for a peer — synchronous, never blocks the frame loop. */
  const worn_of = (id) => cache.get(id)?.worn ?? BLANK_WORN

  /** The last-resolved pet-companion verdict for a peer — synchronous, never blocks the frame loop. #553. */
  const pet_of = (id) => cache.get(id)?.pet ?? NO_PET

  /** TR-5 — does this peer wear the veteran title? Same doc, same gate the local player reads. */
  const veteran_of = (id) => cache.get(id)?.veteran ?? false

  /**
   * Batch-refresh every id in `ids` whose cache row is missing/stale/not already in flight. Fire-and-forget —
   * callers read the result later via worn_of()/pet_of(); safe to call every frame (a no-op Map scan when
   * nothing's due).
   * @param {Iterable<string>} ids @returns {Promise<void>}
   */
  const refresh = (ids) => {
    const stale = []
    for (const id of ids) {
      const hit = cache.get(id)
      if ((!hit || now() - hit.resolved_at > CHARACTER_TTL_MS) && !pending.has(id)) stale.push(id)
    }
    if (!stale.length) return Promise.resolve()
    for (const id of stale) pending.add(id)
    return resolve_character_docs(stale, deps.fetch_characters)
      .then((docs) => {
        const at = now()
        const catalog = templates()
        for (const id of stale) {
          const character = docs.get(id)
          cache.set(id, {
            worn: character ? resolve_worn_cosmetics(character, catalog) : BLANK_WORN,
            pet: character ? resolve_pet_companion(character) : NO_PET,
            veteran: character ? has_veteran_title(character) : false,
            resolved_at: at,
          })
        }
      })
      .finally(() => {
        for (const id of stale) pending.delete(id)
      })
  }

  /** Forget a despawned peer — bounds cache growth across a long session's stream of strangers. */
  const drop = (id) => {
    cache.delete(id)
    pending.delete(id)
  }

  return { worn_of, pet_of, veteran_of, refresh, drop }
}
