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
// frame loop runs at 60fps). TTL-bounded (~60s — the FLOOR under every peer's freshness); a peer with no cache
// row yet always counts as stale, so a freshly-spawned rig resolves on its very next refresh call. Never caches
// an absence permanently: a failed/pending id just stays stale and retries the next call.
//
// #2171 — the TTL is the floor, not the latency: a peer's own presence beat carries an appearance REVISION
// (presence_appearance.js), and a revision the renderer has not applied yet calls invalidate() below, which
// makes that row due on the next refresh wave instead of up to a minute later. That signal is a bare number: it
// can say "re-read me", and it can say nothing else — every rendered appearance fact still comes from the /v1
// read here, so the transport ruling above is unchanged and a lying beat buys its sender exactly one refetch.

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
  /** @type {Set<string>} ids whose cached row a presence beat has declared stale — see invalidate(). */
  const dirty = new Set()

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
      const due = !hit || dirty.has(id) || now() - hit.resolved_at > CHARACTER_TTL_MS
      if (due && !pending.has(id)) stale.push(id)
    }
    if (!stale.length) return Promise.resolve()
    // Clearing the mark HERE (not on completion) is what makes a mid-flight invalidation survive: this read
    // only covers what was known stale when it left, so a beat that lands while it is in flight re-marks the
    // id and the very next call re-reads it — never a change silently swallowed by an older response.
    for (const id of stale) {
      pending.add(id)
      dirty.delete(id)
    }
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

  /**
   * #2171 — mark one peer's row STALE so the next refresh() re-reads it, instead of waiting out the TTL. The
   * caller's trigger is a presence beat whose appearance revision moved (presence_appearance.js): the beat says
   * only THAT something changed, so this door is the only thing it can reach — the answer to WHAT changed still
   * comes from the /v1 read below, exactly as #553 rules. Stale-while-revalidate on purpose: the last-resolved
   * verdict keeps rendering until the fresh one lands, so an invalidation never flickers a peer bare.
   * @param {string} id
   */
  const invalidate = (id) => {
    dirty.add(id)
  }

  /** Forget a despawned peer — bounds cache growth across a long session's stream of strangers. */
  const drop = (id) => {
    cache.delete(id)
    pending.delete(id)
    dirty.delete(id)
  }

  return { worn_of, pet_of, veteran_of, refresh, invalidate, drop }
}
