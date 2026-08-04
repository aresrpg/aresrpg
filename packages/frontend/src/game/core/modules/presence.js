// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presence — the CORE→CONTEXT BRIDGE (D770a W3b; reshaped BRIDGE-A pipeline-conformance pass). The peer
// OBSERVATIONS live in @aresrpg/world's presence atom (fed typed inputs by the p2p transport adapter — the
// WS-era `packet/*` shim is dead); this module projects `visible_players` into the stable
// `state.observed_peers` Map the roam scene and the HUD render through core/render_rows.js.
//
// ADVISORY-ONLY (realtime constitution D2): every row here is one client's report of one room at one instant.
// It may place an avatar on screen and refine a coordinate. It may never answer whether someone is online, in
// this world, in my party, or the owner of anything. The map is named for what it holds, has exactly ONE
// writer (this reducer), and stamps `observed_at` so a consumer can weigh the observation's age.
//
// ONE-PIPELINE LAW: observe() is a THIN EDGE ADAPTER (mirrors chat.js's subscribe_chat → dispatch) — it
// subscribes to the external presence_store and FORWARDS its current peer projection as an
// `action/presence_snapshot` input, nothing else: no diffing, no state mutation, no manual STATE_UPDATED.
// reduce() is the ONE home for the projection: it diffs the snapshot against the existing Map and
// spawns/retargets/despawns entries. STATE_UPDATED rides the standard per-dispatch emission every sibling
// module already relies on (chat.js/player.js/mob_groups.js) — no bespoke notify-gate lives here anymore;
// downstream consumers already self-derive change detection off a stable digest (select_observed_count,
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
      const peers = state.observed_peers
      const listed = new Set()
      for (const row of Array.isArray(payload) ? payload : []) {
        listed.add(row.id)
        const classe = row.classe ?? FALLBACK_CLASS
        const existing = peers.get(row.id)
        if (existing) {
          // RETARGET: the scene owns entry.position (its lerp state) — only the target + identity move.
          existing.target_position = row.position
          if (typeof row.target_yaw === 'number') existing.target_yaw = row.target_yaw
          existing.name = row.name
          existing.classe = classe
          existing.male = row.male ?? existing.male ?? true
          existing.sprites = get_class(classe)?.sprites ?? FALLBACK_SPRITES
          existing.hue = color_to_hue(row.color_1 ?? 0)
          existing.color_1 = row.color_1 ?? 0
          existing.color_2 = row.color_2 ?? 0
          existing.color_3 = row.color_3 ?? 0
          existing.observed_at = row.observed_at
        } else {
          // SPAWN: seed position = target (the scene starts its lerp from here).
          peers.set(row.id, {
            id: row.id,
            name: row.name,
            classe,
            male: row.male ?? true,
            sprites: get_class(classe)?.sprites ?? FALLBACK_SPRITES,
            hue: color_to_hue(row.color_1 ?? 0),
            color_1: row.color_1 ?? 0,
            color_2: row.color_2 ?? 0,
            color_3: row.color_3 ?? 0,
            position: row.position,
            target_position: row.position,
            target_yaw: row.target_yaw,
            observed_at: row.observed_at,
            action: 'IDLE',
          })
        }
      }
      // DESPAWN — the freshness law: an expired observation leaves no ghost. This map has ONE writer and one
      // meaning, so an unlisted row is simply an observation that ended (#595's collateral-reap guard retired
      // with the shared Map it guarded: my own followers live in their own home now and are nobody's to reap).
      for (const id of peers.keys()) if (!listed.has(id)) peers.delete(id)
      return { ...state, observed_peers: peers }
    },
    /** @param {import('../game.js').Context} context */
    observe({ dispatch }) {
      // THIN EDGE: forward the presence atom's current peer projection into the reducer's input door — no
      // Map ownership, no mutation, no notify decision made here (see header). The clock is read HERE because
      // an observation's age is a fact about WHEN it was received, and a reducer may not read a clock.
      const forward = () =>
        dispatch(
          'action/presence_snapshot',
          visible_players(presence_store.getState()).map((row) => ({ ...row, observed_at: Date.now() }))
        )
      presence_store.subscribe(forward)
      forward() // adopt whatever the atom already holds (boot-order independence)
    },
  }
}
