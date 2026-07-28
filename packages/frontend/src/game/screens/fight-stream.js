// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COURTESY CHANNEL (#334) — the transport seam for channel two (docs/FIGHT_PIPELINE.md). In a multi-peer
// fight the ACTIVE player's client STREAMS its drafted turn (the move/cast batch, PRE-commit) through the courier;
// RECEIVERS feed each peer batch into the ONE fight door (`apply_peer_batch`), which sim-verifies it
// through the LOCAL sim (peer_legality) and either PRE-PAINTS it as a prediction or DROPS + FLAGS it — an illegal
// injected batch never reaches the eye, and raises ONE neutral toast. Legality is the CORE's single home now (the
// old dungeon_turn AP/MP/range gates moved into peer_legality); this module is pure transport glue.
//
// CHAIN-AUTHORSHIP LAW (untouched): the stream is PREVIEW, NEVER authorship — courier paints, the chain authors. A
// courtesy batch enters the prediction overlay (source 'intent'), never committed truth; the canonical receipt/
// journal retires it by claim. Loss of the courtesy channel costs LATENCY, never correctness.
//
// PLACEMENT GHOSTS — a THIRD stream kind (`'placement'`): pre-start picks aren't committed, so teammates SEE where
// others intend to stand. COSMETIC ONLY, no sim-verify (a lying ghost can't do anything) — folded straight into
// the core's `placement_ghost` input (fold.js owns the GC + own-seat exclusion). Unchanged by #334.
//
// LoC law: this is a SEPARATE module — it does NOT grow the fight core, which it hooks with a single idempotent
// `init_fight_stream()` call from the dungeon bridge.

import { fight_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'
import { STATUS_PLACEMENT } from '@aresrpg/fight/board_state'
import { apply_peer_batch, drafted_batches, subscribe_flagged } from '@aresrpg/fight/txs'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { broadcast_fight_stream, subscribe_fight_stream } from '../../courier/world.js'
import { push_event_toast } from '../core/toast.js'
import i18n from '../../i18n'
import { use_dungeon_turn } from './dungeon-turn.js'

const STATUS_ACTIVE = 1

let installed = false

/**
 * Idempotent one-time install of BOTH sides of the stream. Called from dungeon_store's engine bridge on the first
 * sync — the listeners live for the app lifetime and no-op whenever there is no active dungeon fight for me.
 */
export function init_fight_stream() {
  if (installed) return
  installed = true
  subscribe_fight_stream(on_peer_stream)
  // SENDER — placement ghosts: every seat streams its own pre-start pick (cosmetic; the core owns the GC).
  use_dungeon_turn.subscribe((s, prev) => {
    if (s.placement_pick !== prev.placement_pick) stream_placement(s.placement_pick)
  })
  // SENDER — courtesy (#334): my drafted move/cast batches stream to peers as they enter the core, on MY turn only.
  fight_store.subscribe(stream_my_drafts)
  // An illegal peer preview raises ONE neutral toast (reducer-owned + remount-safe — the turn_lost/divergence idiom).
  subscribe_flagged(fight_store, {
    on_flagged: () => push_event_toast({ state: 'info', title: i18n.t('fight.courtesy_dropped') }),
  })
}

/** Broadcast one drafted PLACEMENT pick to peers — every seat streams its own pick independently pre-start. */
function stream_placement(target) {
  if (target == null) return // a cleared/toggled-off pick — nothing to preview
  const dungeon = use_dungeon.getState().dungeon
  const fight = fight_view() // synchronous core view (S2 mirror kill)
  if (!dungeon || !fight) return
  const me = fight.my_entity_id
  if (!me || !dungeon.escrow.some(p => (p.character ?? p.character_id) === me)) return
  if (dungeon.status !== STATUS_PLACEMENT) return
  broadcast_fight_stream({ dungeon_id: dungeon.id, address: me, kind: 'placement', target })
}

// The courtesy batches already streamed this fight (dedupe by intent_id) — reset per fight/session so the id-set
// never grows across fights, and a fresh fight re-arms broadcasting.
const sent_batches = new Set()
let sent_generation = null

/** SENDER — stream every NEW drafted move/cast batch of MY OWN turn (the receipt vocabulary, stripped for the
 *  wire) exactly once. Fires on each core mutation; a peer's turn (provider ≠ local_turn) and peer courtesy
 *  overlays (excluded by drafted_batches) never re-broadcast. */
function stream_my_drafts() {
  const state = fight_store.getState()
  if (state.session_generation !== sent_generation) {
    sent_batches.clear()
    sent_generation = state.session_generation
  }
  if (state.provider !== 'local_turn') return // only MY own turn streams a courtesy draft
  const dungeon_id = state.fight_id
  const me = state.ctx?.my_entity_id
  if (!dungeon_id || !me) return
  for (const batch of drafted_batches(fight_store)) {
    if (sent_batches.has(batch.intent_id)) continue
    sent_batches.add(batch.intent_id)
    broadcast_fight_stream({ dungeon_id, address: me, kind: 'batch', intent_id: batch.intent_id, actions: batch.actions })
  }
}

/** RECEIVE a peer's streamed signal. placement: fold a cosmetic ghost. batch (courtesy): feed it into the ONE
 *  fight door, which legality-gates + pre-paints or drops+flags. Own-echo and wrong-fight are dropped up front. */
function on_peer_stream({ dungeon_id, address, kind, target, intent_id, actions }) {
  const dungeon = use_dungeon.getState().dungeon
  if (!dungeon || dungeon.id !== dungeon_id) return
  const fight = fight_view() // synchronous core view (S2 mirror kill)
  if (!fight || address === fight.my_entity_id) return // ignore my own echo — render only OTHER peers

  if (kind === 'placement') {
    if (dungeon.status !== STATUS_PLACEMENT) return
    if (typeof target !== 'number') return
    if (!dungeon.escrow.some(p => (p.character ?? p.character_id) === address)) return
    fight_store.getState().input({ type: 'placement_ghost', fight_id: dungeon_id, character: address, cell: target })
    return
  }

  // COURTESY (#334): the peer's drafted turn enters the ONE fight door as a legality-gated prediction — the CORE
  // sim-verifies (peer_legality) then pre-paints or drops+flags. No frontend sim-verify: legality has ONE home now.
  if (kind === 'batch') {
    if (dungeon.status !== STATUS_ACTIVE) return
    if (!Array.isArray(actions) || !actions.length) return
    apply_peer_batch(fight_store, { peer: address, intent_id, actions, fight_id: dungeon_id })
  }
}
