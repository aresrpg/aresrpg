// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD FIGHT — the two overworld entry points (ENTER create-handoff · RESUME reconnect) for a BARE on-chain Fight
// (no RunPass); the SAME store + core play/settle it (`run_pass_id: null`). `dungeon_id`=fight id; `in_session`=false.

import { use_auth } from '../auth'
import { get_fights } from '../rpc/client'
import { game_log } from '../core/log.js'
import i18n from '../i18n'
import { push_event_toast } from '../game/core/toast.js'

import { use_dungeon } from './dungeon_store.js'
import { use_party } from './party_store.js'
import { fight_state_trace } from './fight_state_trace.js'
import { poll_receipt_fight, receipt_entry_decision } from './world_fight_receipt.js'
import { init_dungeon_fight } from './dungeon_fight_shim.js'
import { ensure_resumable_fight } from './fight-liquidation.js'

const { getState } = use_dungeon
/** True while a fight/dungeon session already owns the shared store (never stomp a live board). */
const session_busy = () => getState().fight_id != null || getState().run_pass_id != null
const is_live = (f) => !!f && (f.status === 'placement' || f.status === 'active') // the two hostable statuses

/** ENTER: publish the minted id as a run-pass-LESS session, OPEN it in the core, start the poll (idempotent; a live
 *  session is never stomped; `resumed` suppresses the cinematic). `is_public` gates the owned-party auto-form: a
 *  PUBLIC fight discards the party id, so forming one is a wasted create tx (defaults false — form, for every
 *  non-engage entry that stays on today's behavior). @param {{fight_id,world_id?,character_id,resumed?,is_public?}} */
export function enter_world_fight({ fight_id, world_id = null, character_id, resumed = false, is_public = false }) {
  const store = getState()
  const decision = receipt_entry_decision({
    current_fight_id: store.fight_id,
    current_run_pass_id: store.run_pass_id,
    next_fight_id: fight_id,
    character_id,
  })
  fight_state_trace('fight_create_adopt', { fight_id, character_id, resumed, decision })
  if (decision === 'invalid' || decision === 'same') return // same receipt id enriches the existing mount
  if (decision === 'busy')
    return game_log('world-fight', 'enter refused — a session is already live', { have: store.fight_id })
  const { address } = use_auth.getState()
  use_dungeon.setState({
    fight_id,
    fight_fresh: !resumed, // fresh create vs reload-resume — the entry cinematic gates on this stamp
    dungeon_id: fight_id, // the session identity → GameWorldHud in_dungeon stays true (no dead WS chrome)
    world_id,
    template_id: world_id,
    character_id,
    run_pass_id: null, // a world fight has no RunPass — refresh()/settle take their world (no-run) branches
    run: null,
    rooms: [], // no dungeon rooms → the core resolves victory as terminal WON (not ROOM_CLEARED)
    result_id: null,
    phase: 'playing',
    error: null,
    fight_syncing: !resumed, // create/join receipt truth outranks a temporarily-missing serving-node read
    spectating: false,
    session_address: address,
  })
  init_dungeon_fight({ fight_id, character_id, address }) // OPEN it in the core (refresh feeds the snapshot)
  fight_state_trace('fight_create_published', { fight_id, character_id, resumed, fight_syncing: !resumed })
  getState()._start_polling()
  if (resumed) return void getState().refresh()
  // Auto-form the owned party at engagement; the GROUP LOOP (group_wiring → @aresrpg/party group_loop)
  // watches this fight's placement window and seats every aligned owned member exactly once — the join
  // decision left this file (one home: the reducer; the per-member tx stays owned_team_actions). A PUBLIC
  // fight carries no party id (anyone may join), so forming one here is a discarded on-chain create tx — skip it.
  if (!is_public)
    void use_party
      .getState()
      .ensure_owned_party()
      .catch((error) => game_log('world-fight', 'owned party auto-form stopped', error))
  void poll_receipt_fight({ fight_id, get_state: getState, refresh: () => getState().refresh() }).then((outcome) => {
    // The tight backoff loop gave up at its wait ceiling — never a silent stop: the slower 4s heartbeat
    // (_start_polling, already running) is the one still converging it, traced here for visibility.
    if (outcome === 'timed_out')
      game_log('world-fight', 'receipt poll hit its wait ceiling — the 4s heartbeat keeps trying', { fight_id })
  })
}

/**
 * WATCH a public active world fight without taking a seat. This is the same read/poll/journal session as a
 * participant resume, but its core context has no wallet/character identity and is explicitly spectator-only.
 * Returns false when the request is not public/live-shaped or another fight/run already owns the shared store.
 * @param {{ fight_id:string, world_id?:string|null, public_fight?:boolean, status?:string|null }} args
 */
export function spectate_world_fight({ fight_id, world_id = null, public_fight = false, status = null }) {
  if (!fight_id || !public_fight || status !== 'active' || session_busy()) return false
  const { address } = use_auth.getState()
  use_dungeon.setState({
    fight_id,
    fight_fresh: false,
    dungeon_id: fight_id,
    world_id,
    template_id: world_id,
    character_id: null,
    run_pass_id: null,
    run: null,
    rooms: [],
    result_id: null,
    phase: 'playing',
    error: null,
    fight_syncing: true,
    spectating: true,
    session_address: address,
  })
  // Null address is intentional: engine_view otherwise adopts the first seat owned by this wallet even when the
  // requested character is null. The spectator marker drives read-only projection while the null seat keeps the
  // core provider idle.
  init_dungeon_fight({ fight_id, character_id: null, address: null, spectator: true })
  getState()._start_polling()
  void getState().refresh()
  return true
}

/** RESUME after a reload: discover the candidate, then validate it is still live BEFORE entry (absent/terminal
 *  stays in-world; a transient read holds for a later boot pass). EVERY candidate then passes the chain-truth
 *  presentability gate (fight-liquidation.js — the REJOIN-SPAWN root, widened by #882): an expired placement
 *  window liquidates via `force_start` and an expired TURN via `crank` BEFORE adoption, and a fight those doors
 *  resolved terminal routes back to the world with an honest toast instead of re-capturing the character.
 *  @param {string} character_id
 *  @param {{ force_start_door?: Function, crank_door?: Function, is_current?: () => boolean }} [deps] unit seam only */
export async function resume_world_fight(character_id, deps = {}) {
  const is_current = deps.is_current ?? (() => true)
  if (!character_id || !is_current() || session_busy()) return
  let fights
  try {
    fights = await get_fights({ character: character_id })
  } catch (error) {
    return game_log('world-fight', 'resume read failed — no reconnect this pass', error)
  }
  if (!is_current()) return
  const live = (fights ?? []).find(is_live)
  const fight_id = live?.fight_id ?? live?.fight
  if (!fight_id) return // nothing resumable — stay in the world
  let current
  try {
    current = (await get_fights({ id: fight_id })).find((f) => (f.fight_id ?? f.fight) === fight_id && is_live(f))
  } catch (error) {
    return game_log('world-fight', 'resume liveness read failed — staying in the world', error)
  }
  if (!is_current()) return
  if (!current) {
    if (session_busy())
      return fight_state_trace('fight_resume_validation_superseded', {
        candidate_fight_id: fight_id,
        current_fight_id: getState().fight_id,
      })
    return getState()._recover_dead_fight_reference({ character_id, state: 'absent' })
  }
  // ONE chain-truth gate for both live statuses (#882): expired placement → force_start, expired turn → crank,
  // and whatever the chain reports AFTER that door decides. `gone` = the door resolved it terminal (or it was
  // destroyed): route out honestly — the character is freed and its outcome recovered, never re-captured.
  const decision = await ensure_resumable_fight(fight_id, {
    force_start_door: deps.force_start_door,
    crank_door: deps.crank_door,
  })
  if (!is_current()) return
  if (decision === 'gone') {
    fight_state_trace('fight_resume_expired_gone', { fight_id, character_id })
    push_event_toast({ state: 'info', title: i18n.t('fights.expired_fight_cleared') })
    return getState()._recover_dead_fight_reference({ character_id, state: 'settled' })
  }
  if (decision !== 'enter') return
  if (!is_current() || session_busy()) return // a session opened or the request changed while reading — never stomp it
  enter_world_fight({ fight_id, world_id: current.world ?? live.world ?? null, character_id, resumed: true })
}
