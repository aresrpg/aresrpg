// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 — the RUN + WORLD-FIGHT LIFECYCLE store. It owns the on-chain run/session lifecycle (enter, engage, resume,
// settle, recover) and signs every gameplay tx, but it holds ZERO fight state: the generic fight core (fight/)
// is the single owner of board/turn/prediction state. This store feeds the core through dungeon_fight_shim and
// mirrors the core's board projection into its legacy `dungeon` field for unchanged consumers.

import { create } from 'zustand'
import { fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

import { use_auth } from '../auth'
import { set_zone_music, stop_zone_music } from '../game/core/audio/ambient_music.js'
import { game_log } from '../core/log.js'

import { install_fight_trace_tee } from './fight_trace_tee.js'
import { auto_open_pending_outcomes } from './dungeon_settlement.js'
import { should_boot_open } from './pending_outcomes.js'
import { publish_dungeon_session } from './dungeon_session.js'
import { create_dungeon_entry_actions } from './dungeon_run_entry_actions.js'
import { create_dungeon_sync_actions } from './dungeon_run_sync_actions.js'
import { create_dungeon_fight_actions, teardown_dungeon_fight } from './dungeon_run_fight_actions.js'

export { walk_current_fight_journal } from './dungeon_run_sync_actions.js'

const get_dungeon_store = () => use_dungeon

export const use_dungeon = create((set, get) => ({
  /** @type {string | null} the live room Fight id (the board identity) — null while roaming the plane */
  fight_id: null,
  /** An executed world create/join receipt owns fight_id while the full board read catches up. */
  fight_syncing: false,
  /** Executed-failure proof for one exact fight@actor@deadline. Automatic fire may never cross it. */
  _turn_commit_failure: null,
  /** True for a seatless, read-only world-fight observer. Null identity keeps the core provider idle. */
  spectating: false,
  /** True when the live `fight_id` was set by THIS client's explicit start/join gesture. */
  fight_fresh: false,
  /** @type {number | null} Date.now() when this client's session first bound to the live fight. */
  fight_started_at_ms: null,
  /** True when the clock was captured on resume/poll-adopt and is therefore only a duration floor. */
  fight_start_partial: false,
  /** @type {string | null} the bound RunPass id (the session identity) */
  run_pass_id: null,
  /** @type {Record<string,string>} character id → its distinct owned RunPass for this team dungeon */
  owned_run_pass_ids: {},
  /** Opened companion FightResults are separate from the active character's one-card result surface. */
  owned_result_ids: {},
  /** A partial activation is adopted and never replayed; explicit recovery/abandon owns the next action. */
  owned_team_entry_blocked: false,
  /** A failed/missing companion outcome blocks the next room; no digest-bearing settle is auto-replayed. */
  owned_team_settlement_blocked: false,
  /** @type {string | null} the run's World id */
  world_id: null,
  /** Legacy alias some surfaces label by — the session identity. @type {string | null} */
  dungeon_id: null,
  /** @type {string | null} */
  template_id: null,
  /** @type {Record<string,string>} mob template id → display name */
  mob_names: {},
  /** @type {Record<string, number>} mob template id → level (min_level) */
  mob_levels: {},
  /** @type {Record<string, number>} mob template id → element code */
  mob_elements: {},
  /** @type {string | null} */
  character_id: null,
  /** @type {string | null} wallet that started the live session (cross-account leak guard) */
  session_address: null,
  _abandoning: false,
  _placing: false,
  _settling: false,
  _claiming: false,
  /** @type {any | null} the mirrored board projection */
  dungeon: null,
  /** @type {any | null} the decoded RunPass */
  run: null,
  /** @type {string[][]} MobTemplate ids per room */
  rooms: [],
  /** @type {string | null} my opened FightResult */
  result_id: null,
  /** @type {'idle' | 'entering' | 'waiting_for_party' | 'playing' | 'claiming' | 'done'} */
  phase: 'idle',
  /** Optimistic session flag — the plane mounts when the player commits to entry. */
  in_session: false,
  /** @type {{ room: number, xp: number, item_qty: number } | null} */
  room_recap: null,
  /** @type {string | null} */
  error: null,
  busy: false,
  /** @type {number | null} Date.now() a resume lock was acquired */
  busy_since: null,
  /** @type {ReturnType<typeof setInterval> | null} */
  _poll_timer: null,

  ...create_dungeon_entry_actions({ set, get, get_store: get_dungeon_store }),
  ...create_dungeon_sync_actions({ set, get, get_store: get_dungeon_store }),
  ...create_dungeon_fight_actions({ set, get, get_store: get_dungeon_store }),

  /** Reset the local UI state without touching the chain. */
  reset_local() {
    get()._stop_polling()
    teardown_dungeon_fight()
    set({
      run_pass_id: null,
      owned_run_pass_ids: {},
      dungeon_id: null,
      fight_id: null,
      fight_started_at_ms: null,
      fight_start_partial: false,
      world_id: null,
      template_id: null,
      dungeon: null,
      run: null,
      rooms: [],
      result_id: null,
      phase: 'idle',
      error: null,
      busy: false,
      busy_since: null,
      in_session: false,
      room_recap: null,
      _claiming: false,
      fight_syncing: false,
      spectating: false,
      _turn_commit_failure: null,
    })
  },
}))

// Publish only the session identity fields cross-domain readers need.
publish_dungeon_session(use_dungeon.getState())
use_dungeon.subscribe(publish_dungeon_session)

// Transparent recorder tap on the fight-store door, gated off in ordinary play.
install_fight_trace_tee(fight_store)

// The one projection mirror: core board view → the legacy `dungeon` field.
fight_store.subscribe((s) => use_dungeon.setState({ dungeon: project.board_view(s) }))

// Mirror transaction flight and its executed-failure proof through one reducer input.
let _mirrored_busy = false
let _mirrored_turn_commit_failure = null
use_dungeon.subscribe((s) => {
  if (s.busy === _mirrored_busy && s._turn_commit_failure === _mirrored_turn_commit_failure) return
  _mirrored_busy = s.busy
  _mirrored_turn_commit_failure = s._turn_commit_failure
  fight_store.getState().input({ type: 'busy', value: s.busy, latch: s._turn_commit_failure })
})

// Three-state fight/dungeon music. Audio faults never interrupt a state write.
let _dungeon_music_armed = false
use_dungeon.subscribe((state) => {
  if (state.in_session === _dungeon_music_armed) return
  _dungeon_music_armed = state.in_session
  try {
    if (state.in_session) set_zone_music('arctic')
    else stop_zone_music()
  } catch (error) {
    game_log('dungeon', 'zone-music edge threw (isolated); the state change that triggered it is unaffected', error)
  }
})

// Boot recovery must not depend on mounting a result UI surface.
const _kick_pending_open = () => {
  const { address } = use_auth.getState()
  if (!address) return
  void auto_open_pending_outcomes(use_dungeon, address).catch(() => {})
}
if (should_boot_open(use_auth.getState().address)) _kick_pending_open()
use_auth.subscribe((s) => {
  if (should_boot_open(s.address)) _kick_pending_open()
})
