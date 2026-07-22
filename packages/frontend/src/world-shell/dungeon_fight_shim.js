// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 — the DUNGEON/WORLD context SHIM over the generic fight core (fight/). It owns NO fight logic (gate c
// verb-ban): only (a) OPEN a fight in the core with the run's identity ctx, (b) feed a decoded Fight OBJECT read
// into the core's snapshot door, (c) hold a terminal collapse until the core's presentation wave drains, (d)
// route a terminal/room-cleared status to the reused settlement chain. The core is the single fight-state owner.

import { fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { STATUS_ROOM_CLEARED } from '@aresrpg/fight/board_state'

import { TERMINAL_HOLD_CAP_MS } from '../fight-engine/overlay_intents.js'

import { settle_chain_latched } from './dungeon_settlement.js'
import { run_signal_settlement } from './fight_claim_latch.js'

// (b) the SYNC seam (chain read → core snapshot door + the per-world render offset) lives in its own module to keep
// this shim under the ≤120-LoC thin-shim gate; re-exported here so importers keep one import site.
export { resolve_world_offset, sync_dungeon_fight } from './dungeon_fight_sync.js'

/**
 * (a) OPEN a fight in the core — the ENGAGE/resume handoff. Idempotent for a live same-id fight (never re-wipes
 * the core mid-play). `my_key` stays null: the core resolves my seat from `my_entity_id` at first adoption.
 * @param {{ fight_id: string, character_id: string|null, address: string|null, spectator?: boolean,
 *   run?: any, rooms_total?: number,
 *   mob_names?: Record<string,string>, mob_levels?: Record<string,number>, mob_elements?: Record<string,number>,
 *   offset?: { x:number, z:number } }} args
 */
export function init_dungeon_fight({
  fight_id,
  character_id,
  address,
  spectator = false,
  run = null,
  rooms_total = 0,
  mob_names = {},
  mob_levels = {},
  mob_elements = {},
  offset = undefined,
}) {
  if (fight_store.getState().fight_id === fight_id) return // already the live core fight — never re-wipe on re-entry
  fight_store.getState().input({
    type: 'init',
    fight_id,
    my_key: null,
    ctx: {
      address,
      my_entity_id: character_id,
      creator: address,
      spectator,
      run,
      rooms_total,
      mob_names,
      mob_levels,
      mob_elements,
      offset,
      beat_ctx: { grid_width: 20 },
    },
  })
}

/**
 * (c) Hold `collapse` for the presentation drain, hard-capped at `cap_ms`. SESSION-SCOPED + LOCAL-AWARE
 * (register #42): the collapse is bound to the fight it was armed for — a NEW fight opening under it drains the
 * OLD terminal immediately (fight_id changed = the old fight is gone) rather than waiting on the new fight's
 * wave — and it holds on ANY remaining wave (`project.draining`), so a fight that ends on MY OWN kill waits for
 * that local killing queue (attack→hit→floater→despawn) instead of collapsing before it, which `presenting`
 * (nonlocal-only) allowed. The cap_ms backstop still bounds a wedged renderer.
 * @param {() => void} collapse @param {number} [cap_ms]
 */
export function hold_until_presented(collapse, cap_ms = TERMINAL_HOLD_CAP_MS) {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(timer)
    collapse()
  }
  const timer = setTimeout(finish, cap_ms)
  const target = fight_store.getState().fight_id
  const drained = (s) => s.fight_id !== target || !project.draining(s)
  const unsubscribe = fight_store.subscribe((s) => {
    if (drained(s)) finish()
  })
  if (drained(fight_store.getState())) finish() // already drained — fire this tick
}

/**
 * (d) Route room clears directly and terminals through the signal latch; forward ids/callback unchanged.
 * @param {any} store @param {number} status @param {any} ids @param {{ on_settled?: Function }} [opts]
 */
export function route_settlement(store, status, ids = {}, { on_settled } = {}) {
  const fight_id = ids.fight_id ?? store.getState().fight_id
  const run = () => settle_chain_latched(store, { terminal: status !== STATUS_ROOM_CLEARED, ...ids, on_settled })
  return status === STATUS_ROOM_CLEARED ? run() : run_signal_settlement(status, fight_id, run)
}
