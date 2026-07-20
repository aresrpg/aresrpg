// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// JOIN-REQUEST EFFECT (character↔world session binding) — the create RECEIPT drives the actual world
// join. The session gate's pure core emits a `join_request` EFFECT REQUEST on begin_join (roster/store.ts, the
// instant the create tx lands); THIS edge runs the money-routed auto_join_world for that character — receipt-
// driven, ONE pipeline, never a DiscoveryPrompts poll noticing `unjoined`. auto_join_world's once-per-character
// latch dedupes with DiscoveryPrompts' ghost-world/legacy healer, so a double-arm never double-spends.
//
// It lives in its OWN module (mirrors wire_fast_travel_effects) — NOT the session_gate adapter — because
// world_join.js publishes BACK into the gate (publish_world_binding), so wiring the executor inside the gate
// would close a dependency cycle (depcruise no-circular). Nothing imports this module except the boot seam
// (embed_voxel.js calls wire_join_request_effect beside wire_fast_travel_effects), so the graph stays a DAG.

import { subscribe_join_request } from '@aresrpg/world/session_gate'

import { push_event_toast } from '../game/core/toast.js'
import { game_log } from '../core/log.js'
import i18n from '../i18n'

import { use_world_binding, session_gate_input } from './session_gate.js'
import { auto_join_world } from './world_join.js'

let wired = false

/** Arm the join-request edge (idempotent — one subscription for the app lifetime). Called on session boot
 *  beside wire_fast_travel_effects; the singleton gate + this one subscription survive session swaps. */
export function wire_join_request_effect() {
  if (wired) return
  wired = true
  // subscribe_join_request fires the fold's join_request EFFECT REQUEST; use_world_binding forwards .subscribe
  // to the one gate atom (state, prev) → the edge fires once per fresh request (the failsafe-timer idiom).
  subscribe_join_request(use_world_binding, ({ character_id }) => {
    if (!character_id) return
    void auto_join_world({ character_id }).catch((error) => {
      // No-silent-failure: release the loading hold to honest spectate + one humanized toast; the manual world
      // switcher is the retry (never auto-refired — tx-retry law). auto_join_world's latch stays set on failure.
      game_log('session-gate', 'create→play auto-join failed — releasing the hold to spectate', error)
      session_gate_input({ type: 'join_failed', character_id })
      push_event_toast({ state: 'error', title: i18n.t('discovery.join_failed') })
    })
  })
}
