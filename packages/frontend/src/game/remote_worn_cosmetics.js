// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REMOTE WORN COSMETICS — the peer half of TR-97's cosmetic resolution. cosmetic_glb.js's resolve_worn_cosmetics
// already joins a `/v1/characters` doc against the `/v1/encyclopedia` template catalog into `{head,back}` rig
// slots for the LOCAL player (embed_voxel_player.js); this is the SAME join applied to every REMOTE peer.
//
// COSMETICS TRANSPORT RULING: cosmetics never trust the webrtc payload — they load from the rpc
// directly. A peer's worn hat/cloak is chain truth a player can't fake, so it resolves from /v1
// (character_name_resolve.js's resolve_character_docs — the SAME batched-fetch home the fight roster already
// uses for co-fighter names), never from the p2p presence payload (presence.js carries identity only).
//
// Batched + cached: every stale/missing peer id across the current rig set resolves in ONE /v1/characters?ids=
// read per refresh wave (never one fetch per peer per frame — remote_players.js's frame loop runs at 60fps).
// TTL-bounded (~60s — an equip lands within the window); a peer with no cache row yet always counts as stale,
// so a freshly-spawned rig resolves on its very next refresh call — no separate "identity change" trigger
// needed. Never caches an absence permanently: a failed/pending id just stays stale and retries the next call.

import { resolve_character_docs } from '../world-shell/character_name_resolve.js'

import { resolve_worn_cosmetics } from './cosmetic_glb.js'

const WORN_TTL_MS = 60_000

const BLANK_WORN = { head: null, back: null }

/**
 * @param {{
 *   fetch_characters?: (query:{ids:string[]}) => Promise<any[]>,
 *   templates?: () => Map<string, any>,
 *   now?: () => number,
 * }} [deps] pure-injection test seam (defaults: the real rpc/client fetch, no template catalog, Date.now)
 */
export function create_remote_worn_cache(deps = {}) {
  const templates = deps.templates ?? (() => new Map())
  const now = deps.now ?? (() => Date.now())
  /** @type {Map<string, { worn: {head:any, back:any}, resolved_at: number }>} */
  const cache = new Map()
  const pending = new Set()

  /** The last-resolved worn set for a peer — synchronous, never blocks the frame loop. */
  const worn_of = (id) => cache.get(id)?.worn ?? BLANK_WORN

  /**
   * Batch-refresh every id in `ids` whose cache row is missing/stale/not already in flight. Fire-and-forget —
   * callers read the result later via worn_of(); safe to call every frame (a no-op Map scan when nothing's due).
   * @param {Iterable<string>} ids @returns {Promise<void>}
   */
  const refresh = (ids) => {
    const stale = []
    for (const id of ids) {
      const hit = cache.get(id)
      if ((!hit || now() - hit.resolved_at > WORN_TTL_MS) && !pending.has(id)) stale.push(id)
    }
    if (!stale.length) return Promise.resolve()
    for (const id of stale) pending.add(id)
    return resolve_character_docs(stale, deps.fetch_characters)
      .then((docs) => {
        const at = now()
        const catalog = templates()
        for (const id of stale) {
          const character = docs.get(id)
          cache.set(id, { worn: character ? resolve_worn_cosmetics(character, catalog) : BLANK_WORN, resolved_at: at })
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

  return { worn_of, refresh, drop }
}
