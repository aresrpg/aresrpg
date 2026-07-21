// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT COURTESY CHANNEL — transport (#334, the V2 two-channel constitution, epic #216). A fight-scoped
// Trystero room (key = the fight id) is a SIBLING of the lobby + party rooms on the SAME serverless infra
// (P2P_ROOM_CONFIG — one config home, no new dependency, no server). Fighters + placement members join; the
// room tears down on fight end / forfeit. The ZONE chat room is a DIFFERENT module and is NEVER touched here
// (the #330 lesson: fight entry never tears down the roam channels).
//
// PUBLISH: at the commit's busy false→true edge (the PTB-submit moment) the active player broadcasts its drafted
// turn — read straight off the fight core's OWN optimistic intent entries (`drafted_batch`), the same normalized
// action vocabulary the receipt/journal carry (one home, never a parallel format).
// RECEIVE: a peer batch re-enters the fight core through the ONE input door (`apply_peer_batch`) as a legality-
// gated PREDICTION — the sim validates it over MY committed state, so p2p costs LATENCY, never correctness, and
// an injected illegal batch never paints (it raises the core's `flagged`, surfaced as the DungeonBoard toast).
//
// EFFECTS AT EDGES (L-P4): this file is the ONLY promise/transport surface; @aresrpg/fight stays pure — it just
// projects the payload (`drafted_batch`) and folds the peer input (`apply_peer_batch`). No fight state is written
// here; the reducer owns it.

import { joinRoom } from 'trystero'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'
import { drafted_batch, apply_peer_batch } from '@aresrpg/fight/txs'

import { game_log } from '../core/log.js'

import { P2P_ROOM_CONFIG } from './lobby-room.js'

let room = null
let batch_action = null
let room_fight_id = /** @type {string | null} */ (null)
/** @type {Map<string, string>} trystero peer_id → the on-chain character it broadcasts as (own-echo + routing). */
const peer_characters = new Map()

/** My live seat's character id — the own-echo filter (never re-enter my own broadcast as a peer prediction). */
const my_character = () => fight_view()?.my_entity_id ?? null

/**
 * Join / re-scope the fight-scoped courtesy room to `fight_id` — a sibling Trystero room keyed by the fight id,
 * on the exact same appId + discovery infra as the lobby. Idempotent per id; a `null` id leaves (teardown). The
 * lobby + party rooms are separate modules and are never touched.
 * @param {string | null} fight_id the on-chain Fight object id (null = not in a fight)
 */
export function sync_fight_room(fight_id) {
  if (fight_id === room_fight_id) return
  room?.leave()
  room = null
  batch_action = null
  peer_characters.clear()
  room_fight_id = fight_id ?? null
  if (!fight_id) return
  room = joinRoom(P2P_ROOM_CONFIG, `fight-${fight_id}`)
  batch_action = room.makeAction('fbatch')
  batch_action.onMessage = (data, { peerId }) => {
    const { fight_id: fid, character, intent_id, actions } =
      /** @type {{ fight_id: string, character: string, intent_id: string, actions: object[] }} */ (data ?? {})
    if (!fid || fid !== room_fight_id || !character || !Array.isArray(actions)) return
    if (character === my_character()) return // own echo — my turn is already painted from my own draft
    peer_characters.set(peerId, character)
    // Through the ONE door as a legality-gated peer prediction: the core resolves the actor from `character` on
    // MY roster and drops (+ flags) a batch that could not legally be that fighter's turn.
    apply_peer_batch(fight_store, { peer: character, intent_id, actions, fight_id: fid })
  }
  game_log('fight-room', `joined fight-scoped courtesy room · ${String(fight_id).slice(0, 10)}`)
}

/** Broadcast MY committed draft to the fight room — the courtesy publish. No-op with no room (solo / not joined). */
export function broadcast_fight_batch(payload) {
  batch_action?.send(payload).catch(() => {})
}

/** Leave the fight room (fight end / forfeit) — safe even if never joined. The lobby + party rooms are untouched. */
export function leave_fight_room() {
  room?.leave()
  room = null
  batch_action = null
  room_fight_id = null
  peer_characters.clear()
}

let installed = false
let prev_busy = false
let want_room = /** @type {string | null} */ (null)

/**
 * Idempotent one-time install of the courtesy channel's store bridge — the LIFECYCLE (join a live COOP fight,
 * leave on end / forfeit) and the PUBLISH (broadcast my drafted turn at the commit's busy rising edge). Installed
 * from the voxel fight adapter next to init_fight_stream (the cycle-safe dungeon-bridge hook: the adapter is a
 * leaf the store cluster never imports back). Solo fights never open a room (no teammate to court).
 */
export function init_fight_room() {
  if (installed) return
  installed = true
  fight_store.subscribe(() => {
    const s = fight_store.getState()
    const view = fight_view()
    // LIFECYCLE — a fight-scoped room earns its keep only in a COOP fight; solo has no peer to relay to.
    const players = view?.fighters ? [...view.fighters.values()].filter((fighter) => !fighter.is_mob).length : 0
    const next = s.fight_id && s.phase === 'active' && players > 1 ? s.fight_id : null
    if (next !== want_room) {
      want_room = next
      sync_fight_room(next)
    }
    // PUBLISH — the commit's busy false→true edge IS the PTB-submit moment; my drafted intents are still in the
    // store (the receipt purges them later). Only MY active turn broadcasts (a peer's turn is theirs to court).
    if (want_room && s.busy && !prev_busy && view?.active_entity_id != null && view.active_entity_id === view.my_entity_id)
      broadcast_fight_batch({ fight_id: s.fight_id, character: view.my_entity_id, ...drafted_batch(fight_store) })
    prev_busy = s.busy
  })
}
