// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presence — the CORE→CONTEXT BRIDGE (D770a W3b; reshaped BRIDGE-A pipeline-conformance pass). The peer
// TRUTH lives in @aresrpg/world's presence atom (fed typed inputs by the p2p transport adapter — the WS-era
// `packet/*` shim is dead); this module projects `visible_players` into the stable `state.visible_characters`
// Map the imperative roam scene + every HUD consumer (remote_players, OnlinePlayers, WorldChat, party
// surfaces, presence_count) already read.
//
// ONE-PIPELINE LAW: observe() is a THIN EDGE ADAPTER (mirrors chat.js's subscribe_chat → dispatch) — it
// subscribes to the external presence_store and FORWARDS its current peer projection as an
// `action/presence_snapshot` input, nothing else: no diffing, no state mutation, no manual STATE_UPDATED.
// reduce() is the ONE home for the projection: it diffs the snapshot against the existing Map and
// spawns/retargets/despawns entries. STATE_UPDATED rides the standard per-dispatch emission every sibling
// module already relies on (chat.js/player.js/mob_groups.js) — no bespoke notify-gate lives here anymore;
// downstream consumers already self-derive change detection off a stable digest (select_online_count,
// OnlinePlayers' sorted-keys digest) rather than off notify timing, so nothing downstream cared about it.
//
// The Map reference is STABLE and its entries are render-mutable on purpose: the scene lerps
// `position → target_position` each frame by writing entry.position, so reduce() only RETARGETS known
// entries (target_position / target_yaw / resolved identity) and never stomps the lerp state, never
// reallocates the Map itself.
//
// Identity: the projection prefers the CHAIN-resolved record (the adapter's read_character effect) and
// falls back to the peer's self-declared p2p identity; this bridge maps classe→sprites and color→hue at
// the edge (frontend data lookups the hermetic core cannot own).

import { visible_players } from '@aresrpg/world/presence'

import { get_class } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { presence_store } from '../../../world-shell/presence_adapter.js'

const FALLBACK_CLASS = 'senshi'
const FALLBACK_SPRITES = '/sprites/senshi'

/** @type {import('../game.js').Module} */
export default function presence() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type !== 'action/presence_snapshot') return state
      const vc = state.visible_characters
      const listed = new Set()
      for (const row of Array.isArray(payload) ? payload : []) {
        listed.add(row.id)
        const classe = row.classe ?? FALLBACK_CLASS
        const existing = vc.get(row.id)
        if (existing) {
          // RETARGET: the scene owns entry.position (its lerp state) — only the target + identity move.
          existing.target_position = row.position
          if (typeof row.target_yaw === 'number') existing.target_yaw = row.target_yaw
          existing.name = row.name
          existing.classe = classe
          existing.male = row.male ?? existing.male ?? true
          existing.sprites = get_class(classe)?.sprites ?? FALLBACK_SPRITES
          existing.hue = color_to_hue(row.color_1 ?? 0)
        } else {
          // SPAWN: seed position = target (the scene starts its lerp from here).
          vc.set(row.id, {
            id: row.id,
            name: row.name,
            classe,
            male: row.male ?? true,
            sprites: get_class(classe)?.sprites ?? FALLBACK_SPRITES,
            hue: color_to_hue(row.color_1 ?? 0),
            position: row.position,
            target_position: row.position,
            target_yaw: row.target_yaw,
            action: 'IDLE',
          })
        }
      }
      // DESPAWN — the freshness law: an expired peer leaves no ghost. SHARED-MAP GUARD (#595): group_wiring.js's
      // apply_follow writes owned-follow rows into this SAME Map outside this reducer's door (its own render
      // set, keyed off the party group_loop, never a p2p fact) — this reducer only owns P2P peer rows, so it
      // must never reap an owned_follow row it didn't list; that row's REMOVE-side is apply_follow's job
      // (deps.apply_follow already gates its own delete on the identical flag). Without this, EVERY p2p
      // presence tick wiped every owned follower's registry row a beat before apply_follow's next tick could
      // restore it — remote_players.js reacted correctly to the row vanishing (same-tick teardown), but the
      // vanish itself was spurious: a live follower's pet/avatar cycling torn-down↔respawned off a race
      // between two uncoordinated writers, not an actual despawn.
      for (const id of vc.keys()) if (!listed.has(id) && !vc.get(id)?.owned_follow) vc.delete(id)
      return { ...state, visible_characters: vc }
    },
    /** @param {import('../game.js').Context} context */
    observe({ dispatch }) {
      // THIN EDGE: forward the presence atom's current peer projection into the reducer's input door — no
      // Map ownership, no mutation, no notify decision made here (see header).
      const forward = () => dispatch('action/presence_snapshot', visible_players(presence_store.getState()))
      presence_store.subscribe(forward)
      forward() // adopt whatever the atom already holds (boot-order independence)
    },
  }
}
