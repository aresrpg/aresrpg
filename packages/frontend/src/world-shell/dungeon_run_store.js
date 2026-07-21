// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 — the RUN + WORLD-FIGHT LIFECYCLE store. It owns the on-chain run/session lifecycle (enter, engage, resume,
// settle, recover) and signs every gameplay tx, but it holds ZERO fight state: the generic fight core (fight/)
// is the single owner of board/turn/prediction state. This store feeds the core through the thin
// dungeon_fight_shim (init / snapshot / hold / settlement) and MIRRORS the core's board projection back into its
// legacy `dungeon` field so every existing consumer (`use_dungeon((s) => s.dungeon)`) keeps reading the same shape.
//
//   ENTER   dungeon::activate — burn ONE locked key unit → a bound RunPass at room 1 (the plane mounts).
//   ENGAGE  dungeon::next_fight — the mob-cluster click mints the room Fight + opens it in the core.
//   FIGHT   place, then ONE PTB per turn (act_move/act_weapon/act_cast + the terminal act_pass); the receipt folds
//           through the core's input door — the core paces the mob wave, projects the turn, purges predictions.
//   SETTLE  settlement::settle_and_destroy → my FightOutcome → results::open → FightResult → mint/burn. Victory
//           advances the pass; defeat / last-room consumes it. (Composition REUSED verbatim from dungeon_settlement.)
//
// CLIENT-LOOP LAWS (unchanged): single-flight per Fight (busy/_placing/_settling/_claiming); auto-crank only past
// an on-chain deadline (fight-liquidation); an EXECUTED failure (a digest exists) is NEVER auto-retried.

import { create } from 'zustand'
import { decode_fight } from '@aresrpg/sdk/fight'
import { get_mob_template } from '@aresrpg/sdk/game'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { fight_view } from '@aresrpg/fight/project'
import { fight_opened_at } from '@aresrpg/fight/trace_tap'
import {
  STATUS_OPEN,
  STATUS_ACTIVE,
  STATUS_ROOM_CLEARED,
  STATUS_WON,
  STATUS_FAILED,
  to_fight_cell,
} from '@aresrpg/fight/board_state'
import { auto_commit_blocked, executed_turn_failure, stage_to_batch, turn_commit_key } from '@aresrpg/fight/turn_commit'
import { fight_geometry_complete } from '@aresrpg/fight/board_state'
import { transaction_character_id } from '@aresrpg/fight/fight_control'
import { apply_fight_receipt_to_roster } from '@aresrpg/inventory/fight_receipt_roster'

import { context } from '../game/store.js'
import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { get_owned_items } from '../chain/read_staking'
import { get_dungeon_runs } from '../rpc/client'
import { T62_WORLDS, DEMO_NETWORK } from '../chain/deployment'
import { push_event_toast } from '../game/core/toast.js'
import i18n from '../i18n'
import { load_roster } from '../roster/load_roster'
import {
  note_victory,
  note_player_advance,
  fight_end_reset,
  is_ending,
  fight_end_state,
} from '../fight-engine/fight_end_machine.js'
import { humanize_abort, on_marker_refusal, parse_move_abort, tx_error } from '../game/core/abort_copy.js'
import { had_active_seat, mark_active_seat, session_reset } from '../fight-engine/phase.js'
import { set_zone_music, stop_zone_music } from '../game/core/audio/ambient_music.js'
import { game_log } from '../core/log.js'

import {
  as_one_toast,
  next_room_fight,
  join_room_fight,
  abandon_run,
  abandon_fight as tx_abandon_fight,
  place as tx_place,
  commit_turn_batch,
  crank as tx_crank,
  mint_all_and_burn,
} from './dungeon_actions'
import { activate_owned_dungeon_runs, join_owned_dungeon_room_fight } from './owned_team_actions.js'
import { settle_owned_dungeon_companions } from './owned_dungeon_settlement.js'
import { derive_team_entry_plan, select_owned_run_pass_ids } from './team_entry.js'
import { fight_recap_payload } from './fight_recap.js'
import { commit_with_overdue_retry } from './overdue_retry.js'
import { read_object, decode_pass, load_world_meta, resolve_entry_key, is_gone_error } from './run_reads.js'
import { read_fight_liveness } from './fight_liveness.js'
import { key_candidates } from './key_pick.js'
import { mint_owed, recover_character, auto_open_pending_outcomes } from './dungeon_settlement.js'
import { should_boot_open } from './pending_outcomes.js'
import { maybe_liquidate, reset_liquidation } from './fight-liquidation.js'
import { should_hold_receipt_fight } from './world_fight_receipt.js'
import { error_executed_digest } from './tx_digest_error.js'
import { fight_state_trace } from './fight_state_trace.js'
import {
  init_dungeon_fight,
  sync_dungeon_fight,
  resolve_world_offset,
  hold_until_presented,
  route_settlement,
} from './dungeon_fight_shim.js'

const POLL_MS = 4000

const key_units = (items) => items.reduce((total, item) => total + Math.max(1, Math.floor(Number(item.amount ?? 1))), 0)

// The items package scope for the /v1 owner-items refetch that backstops a stale/empty bag at ENTER.
const PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

// Immutable per-tab cache of a Fight's homogeneous group MobTemplate identity (name / min_level / element) — a
// resolved id (hit OR genuine miss) is cached for the tab's life so a dead id is never re-hammered every poll.
/** @type {Map<string, { name: string, min_level: number, element: number } | null>} */
const _mob_tmpl_cache = new Map()
/** @type {Set<string>} */
const _mob_tmpl_pending = new Set()

// SINGLE-PTB TURN: the batch simulation aborts `turns` ESomeoneOverdue (108) when ANOTHER player's turn stalled
// between our poll and our commit. The distinct code lets the commit flow auto-fire ONE silent crank and retry
// ONCE off a clean pre-execution refusal (zero gas, no digest — never an executed-failure retry).
const is_someone_overdue_abort = (/** @type {any} */ error) => {
  const a = parse_move_abort(error)
  return a?.module === 'turns' && a?.code === 108
}

/** The Fight OBJECT version a receipt mutated — the core's snapshot/receipt floor for that receipt's events. */
const fight_change_version = (/** @type {any} */ receipt, /** @type {string} */ fight_id) => {
  const change = (receipt?.objectChanges ?? []).find(
    (c) => String(c?.objectId) === String(fight_id) && c?.version != null
  )
  return change ? Number(change.version) : null
}

const owned_settlement_callback = ({ world_id, leader_character_id, run_pass_ids_by_character }) => {
  if (Object.keys(run_pass_ids_by_character ?? {}).length <= 1) return undefined
  return async ({ receipt }) => {
    try {
      const result_ids = await settle_owned_dungeon_companions({
        leader_receipt: receipt,
        world_id,
        leader_character_id,
        run_pass_ids_by_character,
      })
      use_dungeon.setState((state) => ({
        owned_result_ids: { ...state.owned_result_ids, ...result_ids },
        owned_team_settlement_blocked: false,
      }))
    } catch (error) {
      const landed = error?.opened_result_ids ?? {}
      use_dungeon.setState((state) => ({
        owned_result_ids: { ...state.owned_result_ids, ...landed },
        owned_team_settlement_blocked: true,
        error: i18n.t('errors.fight_result_latched'),
      }))
      push_event_toast({ state: 'error', title: i18n.t('errors.fight_result_latched') })
      throw error
    }
  }
}

/** Verify enough loaded key stacks against this exact dungeon template; a stale bag gets one /v1 refresh. */
async function verified_team_keys(sdk, key_template, items, required, address) {
  const verify = async (rows) => {
    const by_id = new Map((Array.isArray(rows) ? rows : []).filter((item) => item?.id).map((item) => [item.id, item]))
    const verified = []
    for (const candidate of key_candidates(rows)) {
      const hit = await resolve_entry_key(sdk, { key_template, candidates: [candidate] })
      if (!hit) continue
      verified.push({ ...by_id.get(candidate.id), ...hit })
      if (key_units(verified) >= required) break
    }
    return verified
  }
  const held = await verify(items)
  if (key_units(held) >= required) return held
  return verify(await get_owned_items(sdk, address, PACKAGE_ID))
}

/** Open the end-of-fight recap card — BOTH outcomes (v30: the victory card lost its defeated-enemy
 *  block when this was defeat-only; FightResult.jsx reads the same recap roster). Snapshots the session's OWN
 *  committed roster (fight_recap_payload — pure, unit-tested) from the live engine slice, so it MUST run
 *  before teardown. cause stays null: the finishing-blow attribution rides the core presentation wave. */
function open_fight_recap(get, winner, xp = 0) {
  const { fight_id, fight_started_at_ms, fight_start_partial } = get()
  // LOCAL WALL-CLOCK ONLY (no chain fight-start timestamp exists anywhere — see fight_started_at_ms above): this
  // store's own bind bookkeeping is preferred (issue #241 fallback below, not a replacement — every one of its 4
  // real bind sites already stamps this exactly). When it's missing (a caller bound `fight_id` without going
  // through this store's own start/join/resume/poll-adopt doors — the dev synth-fight harness is the one known
  // case today), derive turn-zero from the fight's OWN reducer door instead: trace_tap.js records every input's
  // wall-clock 'at' unconditionally, including the 'init' that opened this exact fight_id — the ONE fight state
  // home this store's bind field was always just a local echo of. Still null (never fabricated) if the ring has
  // nothing for it either (evicted past capacity, or never opened).
  const started_at = fight_started_at_ms ?? (fight_id ? fight_opened_at(fight_id) : null)
  context.dispatch(
    'action/fight_summary/open',
    fight_recap_payload({
      fighters: fight_view()?.fighters, // synchronous core view (S2 mirror kill)
      my_addr: use_auth.getState().address,
      winner,
      xp,
      // duration_partial:true on a resume/poll-adopt means the clock started AFTER the fight did — an honest
      // floor, never the true length.
      duration_ms: started_at ? Date.now() - started_at : 0,
      duration_partial: fight_start_partial,
    })
  )
}

/** Tear the fight down: close it in the core (the board adapter unmounts off the null view) + reset the session
 *  latches. No packet-bus dispatch — the core + its subscribers own board teardown now. */
function teardown() {
  fight_store.getState().input({ type: 'init', fight_id: null })
  fight_end_reset()
  session_reset()
  reset_liquidation()
}

/** The one SESSION-CLEARED state blob (abandon / terminal claim / reset share it — single home). */
const cleared_session = (/** @type {string} */ phase) => ({
  phase,
  run_pass_id: null,
  owned_run_pass_ids: {},
  owned_result_ids: {},
  owned_team_entry_blocked: false,
  owned_team_settlement_blocked: false,
  dungeon_id: null,
  fight_id: null,
  fight_started_at_ms: null,
  fight_start_partial: false,
  world_id: null,
  template_id: null,
  dungeon: null,
  run: null,
  rooms: [],
  in_session: false,
  room_recap: null,
  _claiming: false,
  fight_syncing: false,
  _turn_commit_failure: null,
})

export const use_dungeon = create((set, get) => ({
  /** @type {string | null} the live room Fight id (the board identity) — null while roaming the plane */
  fight_id: null,
  /** An executed world create/join receipt owns fight_id while the full board read catches up. */
  fight_syncing: false,
  /** Executed-failure proof for one exact fight@actor@deadline. Automatic fire may never cross it. */
  _turn_commit_failure: null,
  /** True when the live `fight_id` was set by THIS client's explicit start/join gesture (a FRESH create). The
   *  fight-entry cinematic gates on it; resume/poll-adopt snap straight to the settled board. */
  fight_fresh: false,
  /** @type {number | null} Date.now() the moment THIS client's session first bound to the live `fight_id` — the
   *  recap card's ONLY duration_ms source (no chain timestamp exists: fight.move's spawned_at_ms is consumed
   *  transiently for aged_bp, never stored). null until a fight starts/is adopted; reset with every session
   *  teardown (cleared_session / reset_local) so a stale clock never bleeds into the NEXT room/fight. */
  fight_started_at_ms: null,
  /** @type {boolean} true when fight_started_at_ms was captured on a RESUME/poll-adopt (this client discovered
   *  an already-live fight) rather than its OWN fresh mint/join (fight_fresh:true) — the captured clock then
   *  UNDERSTATES the true fight length (a floor, not the true start). The recap renders it with a "~" prefix. */
  fight_start_partial: false,
  /** @type {string | null} the bound RunPass id (the session identity) */
  run_pass_id: null,
  /** @type {Record<string,string>} character id → its distinct owned RunPass for this team dungeon */
  owned_run_pass_ids: {},
  /** Opened companion FightResults are kept separate from the active character's one-card result surface. */
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
  /** @type {Record<string, number>} mob template id → element code (0=fire 1=water 2=earth 3=air, 255=none) */
  mob_elements: {},
  /** @type {string | null} */
  character_id: null,
  /** @type {string | null} wallet that started the live session (cross-account leak guard) */
  session_address: null,
  _abandoning: false, // the emergency exit's OWN re-entry guard (never the poll-churned busy)
  _placing: false, // placement clicks never eaten by the poll's busy
  _settling: false, // single-flight for the background settlement chain
  _claiming: false, // single-flight for the terminal claim (forfeit + board terminal-effect share claim())
  /** @type {any | null} the MIRRORED board projection (project.board_view of the core) every consumer reads */
  dungeon: null,
  /** @type {any | null} the decoded RunPass */
  run: null,
  /** @type {string[][]} MobTemplate ids per room (world.dungeon_rooms, 0-based) */
  rooms: [],
  /** @type {string | null} my opened FightResult (mint/burn drive off it) */
  result_id: null,
  /** @type {'idle' | 'entering' | 'waiting_for_party' | 'playing' | 'claiming' | 'done'} */
  phase: 'idle',
  /** Optimistic session flag — the plane mounts the instant the player commits to an entry. @type {boolean} */
  in_session: false,
  /** @type {{ room: number, xp: number, item_qty: number } | null} the room-clear recap (RewardRecap.jsx) */
  room_recap: null,
  /** @type {string | null} */
  error: null,
  busy: false,
  /** @type {ReturnType<typeof setInterval> | null} */
  _poll_timer: null,

  /**
   * ENTER (§9): burn ONE dungeon key → a bound RunPass at room 1. SOLO and co-op both enter here (each member
   * burns their OWN key); the run then sits at the room plane until the mob-cluster ENGAGE click mints the room
   * fight. Teleport-first: the optimistic flip seeds world_id so the cave mounts on the PRE-TX state.
   * @param {string} character_id
   */
  async create_dungeon_as_leader(character_id) {
    if (get().busy) return
    if (get().owned_team_entry_blocked) {
      set({ error: i18n.t('errors.tx_failed') })
      return
    }
    const dng_t0 = performance.now()
    set({
      busy: true,
      error: null,
      phase: 'entering',
      character_id,
      in_session: true,
      world_id: T62_WORLDS[0].id, // the cave seed the teleport rides — NOT the post-tx run_pass id
      session_address: use_auth.getState().address,
      owned_run_pass_ids: {},
      owned_result_ids: {},
      owned_team_entry_blocked: false,
      owned_team_settlement_blocked: false,
    })
    game_log(
      'DNG',
      `entry: teleport-visible +${(performance.now() - dng_t0).toFixed(0)}ms (pre-tx optimistic cave mount)`
    )
    try {
      const world_id = T62_WORLDS[0].id
      const sdk = await get_sdk()
      const { rooms, key_template, mob_names, mob_levels, mob_elements } = await load_world_meta(sdk, world_id)
      if (!key_template) throw new Error('This world has no dungeon')
      if (!rooms.length) throw new Error('This dungeon has no rooms seeded')
      const { address } = use_auth.getState()
      const { use_party } = await import('./party_store.js')
      const owned_party_ready = await use_party.getState().ensure_owned_party()
      if (!owned_party_ready) throw new Error(use_party.getState().error ?? i18n.t('errors.tx_failed'))
      const roster_by_id = new Map(
        (context.get_state().sui?.characters ?? []).map((character) => [character.id, character])
      )
      const party_members = use_party.getState().party?.members ?? [
        { character: character_id, owner: address, order: 0 },
      ]
      const entry_members = party_members.map((member) => {
        const card = roster_by_id.get(member.character)
        return {
          ...member,
          character_id: member.character,
          world: card?.world_id ?? null,
          blocked_reason: member.owner === address && (!card || card.in_dungeon) ? 'unavailable' : null,
        }
      })
      const entry_input = {
        members: entry_members,
        my_address: address,
        leader_character_id: character_id,
        leader_world_id: world_id,
      }
      const eligibility = derive_team_entry_plan(entry_input, [])
      const bag_items = context.get_state().sui?.items ?? []
      const candidates = key_candidates(bag_items)
      const keys = await verified_team_keys(sdk, key_template, bag_items, eligibility.required_keys, address)
      const plan = derive_team_entry_plan(entry_input, keys)
      game_log(
        'DNG',
        `entry: key-resolved +${(performance.now() - dng_t0).toFixed(0)}ms (${candidates.length} bag candidate(s), ${plan.key_assignments.length}/${plan.required_keys} verified)`
      )
      if (!plan.required_keys || plan.key_assignments.length !== plan.required_keys)
        throw new Error(i18n.t('dungeons.no_key'))
      set({ template_id: world_id, rooms, mob_names, mob_levels, mob_elements })
      const { run_pass_ids_by_character } = await activate_owned_dungeon_runs({
        world_id,
        assignments: plan.key_assignments,
        on_activated: (owned_character_id, result) => {
          if (!result?.run_pass_id) return
          set({
            owned_run_pass_ids: {
              ...get().owned_run_pass_ids,
              [owned_character_id]: result.run_pass_id,
            },
          })
        },
      })
      const owned_run_pass_ids = Object.fromEntries([...run_pass_ids_by_character].filter(([, pass_id]) => !!pass_id))
      const run_pass_id = owned_run_pass_ids[character_id]
      if (!run_pass_id || Object.keys(owned_run_pass_ids).length !== plan.required_keys)
        throw new Error(i18n.t('errors.tx_failed'))
      game_log(
        'DNG',
        `entry: tx-confirmed +${(performance.now() - dng_t0).toFixed(0)}ms (run_pass ${String(run_pass_id).slice(0, 10)})`
      )
      set({
        run_pass_id,
        owned_run_pass_ids,
        dungeon_id: run_pass_id,
        world_id,
        template_id: world_id,
        rooms,
        mob_names,
        mob_levels,
        mob_elements,
        phase: 'waiting_for_party',
      })
      await get().refresh()
      get()._start_polling()
    } catch (error) {
      // ROLLBACK: flip in_session:false so cave_session.exit() pulls the player back OUT of the optimistic cave.
      game_log('dungeon', 'create_dungeon_as_leader failed', error)
      const reason = humanize_abort(error?.message ?? String(error))
      const confirmed = get().owned_run_pass_ids
      const leader_pass = confirmed[character_id] ?? null
      const executed_failure = !!error_executed_digest(error)
      set(
        leader_pass
          ? {
              error: reason,
              run_pass_id: leader_pass,
              dungeon_id: leader_pass,
              phase: 'waiting_for_party',
              busy: false,
              in_session: true,
              owned_team_entry_blocked: true,
            }
          : {
              error: reason,
              phase: 'idle',
              busy: false,
              in_session: false,
              owned_team_entry_blocked: executed_failure,
            }
      )
      push_event_toast({ state: 'error', title: reason })
      return
    }
    set({ busy: false })
  },

  /**
   * ENGAGE = mint the CURRENT room's fight (`dungeon::next_fight`) — fired by the mob-cluster click only
   * (tx-provenance: a room fight begins ONLY on an explicit user gesture).
   * @param {{ user?: boolean }} [opts]
   */
  async start_when_ready({
    user = false,
    // Test seam (house `force_start_door` precedent — bun `mock.module` on dungeon_actions is process-global and
    // leaks across files): the two room-fight txs are injectable so the fresh-mint hold is drivable headless.
    mint_room_fight = next_room_fight,
    join_team = join_owned_dungeon_room_fight,
  } = {}) {
    if (!user) {
      game_log('dungeon', 'BLOCKED start_when_ready without a user gesture')
      return
    }
    const {
      run_pass_id,
      owned_run_pass_ids,
      owned_team_entry_blocked,
      owned_team_settlement_blocked,
      world_id,
      rooms,
      run,
      busy,
      character_id,
      fight_id,
      _settling,
    } = get()
    if (
      busy ||
      _settling ||
      owned_team_entry_blocked ||
      owned_team_settlement_blocked ||
      !run_pass_id ||
      !world_id ||
      !character_id
    ) {
      game_log('dungeon', 'action dropped: busy/missing-ctx (loud-pipeline)', { busy })
      if (owned_team_entry_blocked) set({ error: i18n.t('errors.tx_failed') })
      else if (owned_team_settlement_blocked) set({ error: i18n.t('errors.fight_result_latched') })
      return
    }
    if (fight_id) return // a room fight is already live — the board owns the session
    set({ busy: true, error: null })
    try {
      const room = run?.room ?? 1
      const roster = rooms[room - 1] ?? []
      if (!roster.length) throw new Error(`Room ${room} has no roster`)
      const { fight_id: minted } = await mint_room_fight({
        world_id,
        run_pass_id,
        mob_template_id: roster[0], // homogeneous room (dungeon.move asserts it)
        character_id,
      })
      if (!minted) throw new Error('next_fight did not return a Fight id')
      // FRESH — the engage click minted it. `fight_syncing: true` is the RECEIPT-HOLD flag (world_fight_receipt):
      // a just-minted room fight can miss the serving node's read-after-write, and without this flag
      // should_hold_receipt_fight() is false → refresh takes _collapse_terminal_ghost (full session teardown)
      // instead of the world leg's receipt-first hold. The flag clears the instant the object hydrates.
      set({
        fight_id: minted,
        fight_fresh: true,
        fight_syncing: true,
        phase: 'playing',
        fight_started_at_ms: Date.now(), // MY OWN engage click just minted this room fight — turn-zero, exact
        fight_start_partial: false,
      })
      init_dungeon_fight({
        fight_id: minted,
        character_id,
        address: use_auth.getState().address,
        run,
        rooms_total: rooms.length,
        mob_names: get().mob_names,
        mob_levels: get().mob_levels,
        mob_elements: get().mob_elements,
      })
      await join_team({
        fight_id: minted,
        creator_pass_id: run_pass_id,
        members: Object.entries(owned_run_pass_ids ?? {})
          .filter(([owned_character_id]) => owned_character_id !== character_id)
          .map(([owned_character_id, owned_run_pass_id]) => ({
            character_id: owned_character_id,
            run_pass_id: owned_run_pass_id,
          })),
      })
      await get().refresh()
    } catch (error) {
      game_log('dungeon', 'start_when_ready failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
      await get()
        .refresh()
        .catch(() => {})
    }
    set({ busy: false })
  },

  /** ADVANCE: the next room's cluster click (clicking the next pack IS "next room"). Same door. */
  async start_next_room({ user = false } = {}) {
    if (!user) {
      game_log('dungeon', 'BLOCKED start_next_room without a user gesture')
      return
    }
    const { dungeon_id } = get()
    if (dungeon_id && is_ending(dungeon_id) && !note_player_advance()) {
      game_log('dungeon', 'advance refused — fight-end mid-claim (machine)', fight_end_state())
      return
    }
    return get().start_when_ready({ user })
  },

  /**
   * MEMBER co-op join (§9): join the creator's room fight with MY OWN pass (each member burned their own key).
   * `creator_pass_id` + `fight_id` arrive over the party p2p share.
   */
  async join_shared_dungeon(creator_pass_id, fight_id, character_id, { join = join_room_fight } = {}) {
    if (get().busy) return
    const { run_pass_id } = get()
    if (!run_pass_id) {
      set({ error: i18n.t('dungeons.no_key') }) // §9 — a member without their own activated run cannot join
      game_log('dungeon', 'join_shared_dungeon refused — no own RunPass (burn a key via ENTER first)')
      return
    }
    set({ busy: true, error: null, character_id, in_session: true, session_address: use_auth.getState().address })
    try {
      await join({ fight_id, run_pass_id, creator_pass_id, character_id })
      // FRESH — my own explicit join gesture + tx. `fight_syncing: true`: the receipt-hold flag so a fresh join
      // that misses the read-after-write HOLDS the id (world_fight_receipt) instead of collapsing the session.
      set({
        fight_id,
        fight_fresh: true,
        fight_syncing: true,
        phase: 'playing',
        fight_started_at_ms: Date.now(), // MY OWN join gesture — the earliest this client can know the fight
        fight_start_partial: false,
      })
      init_dungeon_fight({
        fight_id,
        character_id,
        address: use_auth.getState().address,
        run: get().run,
        rooms_total: get().rooms.length,
        mob_names: get().mob_names,
        mob_levels: get().mob_levels,
        mob_elements: get().mob_elements,
      })
      await get().refresh()
      get()._start_polling()
    } catch (error) {
      game_log('dungeon', 'join_shared_dungeon failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)), busy: false })
      return
    }
    set({ busy: false })
  },

  /**
   * RESUME an existing run (boot/tab-reload): validate the RunPass with ONE read, adopt its latched fight (if
   * any), then publish the session exactly once — live+mine runs only (no optimistic flip on resume).
   * @param {string} run_pass_id @param {string} character_id
   */
  async resume_dungeon(run_pass_id, character_id, { user = false } = {}) {
    if (get().busy) {
      game_log('dungeon', 'resume ignored — store busy')
      return
    }
    set({ busy: true, error: null, phase: 'entering', character_id, session_address: use_auth.getState().address })
    try {
      const sdk = await get_sdk()
      let pass
      try {
        pass = decode_pass(await read_object(sdk, run_pass_id))
      } catch (error) {
        if (is_gone_error(error)) return get()._recover_stale_membership({ user })
        throw error
      }
      const me = use_auth.getState().address
      if (!pass || pass.owner !== me) return get()._recover_stale_membership({ user })
      // Validate the latched Fight itself before any session field flips (a durable-but-dead reference remounts a
      // ghost board otherwise). A transport failure throws to the retryable resume path; only absent/terminal
      // truth clears locally and starts the pending-outcome recovery.
      if (pass.fight) {
        const liveness = await read_fight_liveness(sdk, pass.fight)
        if (liveness.state !== 'live')
          return get()._recover_dead_fight_reference({ character_id, state: liveness.state })
      }
      const { rooms, mob_names, mob_levels, mob_elements } = await load_world_meta(sdk, pass.world)
      const expected_owned_ids = (context.get_state().sui?.characters ?? [])
        .filter((character) => character?.id && character.world_id === pass.world)
        .map((character) => character.id)
        .slice(0, 6)
      let owned_run_pass_ids = { [character_id]: run_pass_id }
      try {
        const rebuilt = select_owned_run_pass_ids({
          runs: await get_dungeon_runs({ owner: me }),
          owned_character_ids: expected_owned_ids,
          world_id: pass.world,
          room: pass.room,
          fight_id: pass.fight ?? null,
        })
        if (rebuilt[character_id] === run_pass_id) owned_run_pass_ids = rebuilt
      } catch (error) {
        game_log('dungeon', 'owned RunPass resume map unavailable — retaining the selected pass only', error)
      }
      set({
        run_pass_id,
        owned_run_pass_ids,
        owned_team_entry_blocked: Object.keys(owned_run_pass_ids).length < expected_owned_ids.length,
        owned_team_settlement_blocked: false,
        dungeon_id: run_pass_id,
        world_id: pass.world,
        template_id: pass.world,
        run: pass,
        rooms,
        mob_names,
        mob_levels,
        mob_elements,
        fight_id: pass.fight ?? null,
        fight_fresh: false, // reload-RESUME — never the entry cinematic
        // a live latched fight is a LATE local observation — turns may already be live (partial, a floor only);
        // no live fight yet (roaming) captures nothing here, the next fresh ENGAGE will (start_when_ready).
        fight_started_at_ms: pass.fight ? Date.now() : null,
        fight_start_partial: !!pass.fight,
        phase: pass.fight ? 'playing' : 'waiting_for_party',
        in_session: true,
      })
      if (pass.fight)
        init_dungeon_fight({
          fight_id: pass.fight,
          character_id,
          address: me,
          run: pass,
          rooms_total: rooms.length,
          mob_names,
          mob_levels,
          mob_elements,
        })
      await get().refresh()
      if (!get().run_pass_id) return // refresh() can reset a dead session — never restart the poll on one
      get()._start_polling()
    } catch (error) {
      game_log('dungeon', 'resume_dungeon failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)), phase: 'idle', busy: false, in_session: false })
      return
    }
    set({ busy: false })
  },

  /** Stale-membership recovery (gone pass / not mine): local teardown + roster heal + one humanized toast. */
  _recover_stale_membership({ user = false } = {}) {
    game_log('dungeon', 'stale run membership (gone/unowned) — recovering to a fresh enter')
    get().reset_local()
    void load_roster().catch(() => {})
    push_event_toast({ state: 'info', title: i18n.t('dungeons.dungeon_gone') })
    if (user) context.dispatch('action/dungeons_modal', true)
  },

  /** Boot liveness gate: never publish a persisted RunPass fight reference whose Fight is absent/terminal. */
  _recover_dead_fight_reference({ character_id = get().character_id, state = 'absent' } = {}) {
    const { address } = use_auth.getState()
    game_log('dungeon', `resume rejected — persisted Fight is ${state}; returning to world before mount`)
    get().reset_local()
    if (address && character_id)
      void recover_character(use_dungeon, character_id)
        .catch(() => 'failed')
        .finally(() => void load_roster().catch(() => {}))
    else void load_roster().catch(() => {})
  },

  /**
   * TERMINAL-GHOST collapse: the live Fight read GONE ⇒ the fight resolved terminally and was settled+destroyed
   * elsewhere (a co-op peer's claim or a permissionless janitor sweep) BEFORE this client folded WON/FAILED. The
   * RunPass can SURVIVE with its latched fight until this seat's pending FightOutcome opens, so it is never a
   * liveness counter-signal. Collapse it behind the SAME presentation drain claim() uses, then auto-open the
   * settled FightResult (the destroyed Fight left a soulbound per-seat outcome).
   */
  _collapse_terminal_ghost(fight_id = get().fight_id) {
    if (!fight_id || get().fight_id !== fight_id) return // an older read may never collapse a replacement fight
    if (get()._claiming || get()._settling || get().phase === 'done') {
      set({ fight_id: null })
      return
    }
    game_log('dungeon', 'live Fight GONE — terminal resolution settled elsewhere; collapsing the ghost board')
    const { character_id } = get()
    set({ fight_id: null, _claiming: true })
    get()._stop_polling()
    // Even a settled-elsewhere ending owes the sequence: the final wave may still be replaying (paced beats / a
    // death clip) — hold the teardown + outcome auto-open behind the core's presentation drain.
    hold_until_presented(() => {
      if (get().phase === 'done') return // an earlier collapse already landed (in-flight refresh race)
      teardown()
      set(cleared_session('done'))
      if (character_id) void recover_character(use_dungeon, character_id).catch(() => 'failed')
    })
  },

  /**
   * Resolve a Fight's GROUP template identity (name / level / element) into mob_names/levels/elements when unknown
   * and push it into the core ctx. AWAITED by refresh BEFORE the snapshot so the mob rig loads with the REAL name
   * on first sight (the fight board creates a mob avatar ONCE at first-sight — a cold name bakes the hash fallback
   * for the whole fight). Key = the Fight's `group_template` (the REAL homogeneous MobTemplate id). Immutable
   * on-chain, so a resolved id (hit OR miss) is cached for the tab; only a cold reconnect / 2nd player pays the read.
   * @param {any} sdk @param {any} fight a decoded Fight
   */
  _resolve_mob_identities(sdk, fight) {
    const id = fight?.group_template
    if (!id || !fight?.mobs?.length) return // no group template / no mobs (PvP) — nothing to resolve
    const known = get().mob_names
    if (id in known || _mob_tmpl_cache.has(id) || _mob_tmpl_pending.has(id)) return
    _mob_tmpl_pending.add(id)
    return get_mob_template({ grpc_client: sdk.grpc_client })(id)
      .then((tpl) =>
        _mob_tmpl_cache.set(
          id,
          tpl ? { name: tpl.name || 'Mob', min_level: tpl.min_level || 1, element: tpl.element ?? 255 } : null
        )
      )
      .catch(() => _mob_tmpl_cache.set(id, null))
      .finally(() => {
        _mob_tmpl_pending.delete(id)
        const resolved = _mob_tmpl_cache.get(id)
        if (resolved) {
          set({
            mob_names: { ...get().mob_names, [id]: resolved.name },
            mob_levels: { ...get().mob_levels, [id]: resolved.min_level },
            mob_elements: { ...get().mob_elements, [id]: resolved.element },
          })
          fight_store.getState().input({
            type: 'ctx',
            ctx: { mob_names: get().mob_names, mob_levels: get().mob_levels, mob_elements: get().mob_elements },
          })
        }
      })
  },

  /**
   * Seed a world fight's group identity synchronously from an ALREADY-resolved template (the world-spawns group
   * card already showed this name) so the board renders the real name/skin from the FIRST frame. A no-op when
   * already known — never clobber a chain-resolved name with a stale card guess.
   * @param {string} template_id @param {string} name @param {number} [level] @param {number} [element]
   */
  note_group_identity(template_id, name, level, element) {
    if (!template_id || !name || template_id in get().mob_names) return
    set({
      mob_names: { ...get().mob_names, [template_id]: name },
      mob_levels: { ...get().mob_levels, [template_id]: Number(level) || 1 },
      mob_elements: { ...get().mob_elements, [template_id]: Number(element ?? 255) },
    })
    fight_store.getState().input({
      type: 'ctx',
      ctx: { mob_names: get().mob_names, mob_levels: get().mob_levels, mob_elements: get().mob_elements },
    })
  },

  /**
   * Re-read the live Fight (or the free RunPass) and feed it through the core's snapshot door. The core owns all
   * dedupe/floor/turn projection — this method only reads chain truth, resolves identity/offset ctx, and routes
   * the terminal/room-cleared status to settlement + the deadline liquidator.
   */
  async refresh() {
    const { fight_id, run_pass_id } = get()
    if (!fight_id && !run_pass_id) return
    try {
      const sdk = await get_sdk()
      const me = use_auth.getState().address
      // the pass first (cheap; reveals a mid-poll advance/latch) — tolerate gone (consumed on terminal).
      let { run } = get()
      if (run_pass_id) {
        try {
          run = decode_pass(await read_object(sdk, run_pass_id))
        } catch (error) {
          if (!is_gone_error(error)) throw error
          run = null
        }
        if (!run) {
          // pass CONSUMED on-chain (defeat / last-room settle / abandon elsewhere). Keep the session only while a
          // terminal card flow is in flight; otherwise clean exit.
          if (!get().fight_id && !get()._settling) {
            get()._stop_polling()
            set({ run: null, phase: 'done' })
            return
          }
        } else {
          set({ run })
          if (!get().fight_id && run.fight && !get()._claiming && !get()._settling) {
            set({
              fight_id: run.fight,
              fight_fresh: false, // co-op poll-ADOPT (not my gesture) — no cinematic
              fight_started_at_ms: Date.now(), // discovery moment only — turns may already be live (a floor)
              fight_start_partial: true,
            })
            init_dungeon_fight({
              fight_id: run.fight,
              character_id: get().character_id,
              address: me,
              run,
              rooms_total: get().rooms.length,
              mob_names: get().mob_names,
              mob_levels: get().mob_levels,
              mob_elements: get().mob_elements,
            })
          }
        }
      }
      const live_fight_id = get().fight_id
      if (live_fight_id) {
        let read = null
        let definitively_gone = false
        try {
          read = await read_object(sdk, live_fight_id)
        } catch (error) {
          if (!is_gone_error(error)) throw error
          definitively_gone = true
        }
        if (!read) {
          const receipt_owned = should_hold_receipt_fight(get(), live_fight_id)
          const fresh_receipt = receipt_owned && get().fight_fresh
          const retry_receipt_read = receipt_owned && (!definitively_gone || fresh_receipt)
          fight_state_trace('fight_adoption_exact_read_missing', {
            fight_id: live_fight_id,
            definitively_gone,
            receipt_owned,
            fresh_receipt,
            decision: retry_receipt_read ? 'retry' : 'drop',
          })
          // RECEIPT IS TRUTH: a just-executed create/join can beat the serving node's object availability — hold
          // the id + syncing chip and let the receipt backoff loop keep calling refresh. Otherwise the surviving
          // RunPass with a dead latched fight is a terminal ghost → collapse it to the outcome flow.
          if (retry_receipt_read) return
          get()._collapse_terminal_ghost(live_fight_id)
          return
        }
        if (get().fight_id !== live_fight_id) return
        // decode once → resolve the group identity (real first-frame name) → snapshot with the resolved maps +
        // the per-world offset. The core folds/dedupes/projects; a ≤-floor re-read is dropped INSIDE the core.
        const fight = decode_fight(read.json)
        // HOLD-NOT-DEGRADE (adoption seam, 07-18): a TORN read (BoardGeom missing → decode width/height 0) is
        // never presentable — the core's snapshot door refuses it too (fight_geometry_complete gate); holding
        // HERE keeps the syncing chip honest and skips the wasted identity/offset reads while the receipt/poll
        // loop re-reads until the record is whole. Traced, never silent.
        if (!fight_geometry_complete(fight)) {
          fight_state_trace('fight_adoption_degraded_read_held', {
            fight_id: live_fight_id,
            version: Number(read.version) || 0,
            width: fight?.width ?? null,
            height: fight?.height ?? null,
          })
          return
        }
        await get()._resolve_mob_identities(sdk, fight)
        if (get().fight_id !== live_fight_id) return
        const offset = await resolve_world_offset(sdk, get().world_id ?? fight.world)
        sync_dungeon_fight({
          read,
          run,
          rooms_total: get().rooms.length,
          ctx: {
            address: me,
            creator: me,
            my_entity_id: get().character_id,
            run,
            rooms_total: get().rooms.length,
            mob_names: get().mob_names,
            mob_levels: get().mob_levels,
            mob_elements: get().mob_elements,
            offset,
            beat_ctx: { grid_width: 20 },
          },
        })
      } else if (run) {
        // roam: a live run with no room fight — feed the OPEN view (versioned by the pass so a room advance
        // re-adopts) so the mirror keeps showing the plane and the next cluster stays clickable.
        const offset = await resolve_world_offset(sdk, get().world_id ?? run.world)
        sync_dungeon_fight({
          read: null,
          run,
          rooms_total: get().rooms.length,
          open_version: Number(run.version) || 0,
          ctx: {
            address: me,
            creator: me,
            my_entity_id: get().character_id,
            run,
            rooms_total: get().rooms.length,
            mob_names: get().mob_names,
            mob_levels: get().mob_levels,
            mob_elements: get().mob_elements,
            offset,
            beat_ctx: { grid_width: 20 },
          },
        })
      }
      const view = project.board_view(fight_store.getState())
      if (!view) return
      if (live_fight_id && get().fight_id !== live_fight_id) return
      set({ error: null, fight_syncing: false })
      if (view.status === STATUS_ACTIVE) mark_active_seat(view.id) // the abandon→defeat decision reads this latch

      if (view.status === STATUS_OPEN) {
        const { phase } = get()
        if (phase === 'waiting_for_party' || phase === 'entering') return
        set({ phase: 'waiting_for_party' }) // between rooms — the plane roams, the next cluster is clickable
        return
      }
      if (get().phase === 'waiting_for_party') set({ phase: 'playing' })

      // Room CLEARED (non-terminal victory): only chain terminal may close the board + advance the pass. The
      // optimistic killing fold can paint status/HP, but it never owns outcome teardown or settlement.
      if (view.chain_terminal === STATUS_ROOM_CLEARED) {
        note_victory(view.id, view.room_index, 'non_terminal')
        teardown()
        void route_settlement(
          use_dungeon,
          STATUS_ROOM_CLEARED,
          {},
          {
            on_settled: owned_settlement_callback({
              world_id: get().world_id,
              leader_character_id: get().character_id,
              run_pass_ids_by_character: { ...get().owned_run_pass_ids },
            }),
          }
        )
        return
      }
      // TERMINAL (WON/FAILED): the board publishes the terminal view; DungeonBoard's terminal effect owns claim()
      // (card + death-beat-gated teardown + settle). The killing wave rides the core's receipt wave.
      if (view.status === STATUS_WON || view.status === STATUS_FAILED) return

      // LIQUIDATION: every watching client auto-cranks a stalled deadline (jitter + single-flight + latch inside).
      maybe_liquidate(view, get)
    } catch (error) {
      if (is_gone_error(error)) return get()._recover_stale_membership({})
      game_log('dungeon', 'refresh failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
  },

  _start_polling() {
    get()._stop_polling()
    const timer = setInterval(() => get().refresh(), POLL_MS)
    set({ _poll_timer: timer })
  },

  _stop_polling() {
    const timer = get()._poll_timer
    if (timer) clearInterval(timer)
    set({ _poll_timer: null })
  },

  /** Dismiss the room-clear recap (RewardRecap.jsx timer / close). */
  dismiss_recap() {
    if (get().room_recap) set({ room_recap: null })
  },

  /**
   * PLACEMENT: sign `turns::place` for MY character on a chosen start cell (place + READY in one call; the LAST
   * ready auto-starts). The confirmed receipt folds through the core, then refresh reconciles.
   * @param {number} cell
   */
  async place_at_cell(cell) {
    if (get()._placing) {
      game_log('dungeon', 'place_at: already in flight — ignoring re-click')
      return
    }
    const { fight_id, character_id: session_character_id, busy, dungeon } = get()
    const character_id = transaction_character_id(fight_view(), session_character_id)
    if (!fight_id || !character_id) {
      game_log('dungeon', 'place_at ABORT: missing', { fight_id: !!fight_id, character_id: !!character_id })
      return
    }
    if (busy) game_log('dungeon', 'place_at: store busy (background poll/tx) — proceeding, a click is never dropped')
    set({ _placing: true, busy: true, error: null })
    try {
      const receipt = await tx_place(fight_id, character_id, to_fight_cell(cell, dungeon?.width ?? 0))
      const version = fight_change_version(receipt, fight_id)
      if (version != null)
        fight_store.getState().input({
          type: 'receipt',
          receipt,
          version,
          fight_id,
          trap_cells: project.engine_view(fight_store.getState()).my_traps,
        })
      await get().refresh()
    } catch (error) {
      game_log('dungeon', 'place_at failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false, _placing: false })
  },

  /**
   * TURN = ONE PTB: the staged actions map to the SDK batch — kind 0 (move) → act_move; kind 2 (weapon strike) →
   * act_weapon; kind 1 → act_cast with the staged spell object id — signed + the terminal act_pass as ONE atomic
   * tx. An illegal action reverts the WHOLE turn; a kill mid-batch commits. On the distinct overdue refusal (108,
   * at SIMULATION — zero gas) auto-fire ONE silent crank and retry ONCE. `background` (deadline auto-commit) signs
   * silently; an executed failure LATCHES (no auto-retry). The confirmed receipt folds through the core (which
   * paces the mob wave + projects the next turn); refresh reconciles.
   * @param {{ kind: number, target: number, spell_template_id?: string, spell_key?: string }[]} actions
   */
  async commit_turn(actions, { background = false } = {}) {
    const { fight_id, character_id: session_character_id, busy, dungeon } = get()
    const character_id = transaction_character_id(fight_view(), session_character_id)
    const turn_key = turn_commit_key({
      fight_id,
      entity_id: fight_view()?.active_entity_id,
      deadline_ms: dungeon?.turn_deadline_ms,
    })
    fight_state_trace('commit_requested', { turn_key, background, busy, action_count: actions?.length ?? 0 })
    if (background && auto_commit_blocked(get()._turn_commit_failure, turn_key)) {
      fight_state_trace('commit_auto_blocked', {
        turn_key,
        executed_digest: get()._turn_commit_failure?.digest ?? null,
      })
      return false
    }
    if (busy || !fight_id || !character_id) {
      game_log('dungeon', 'action dropped: busy/no-fight (loud-pipeline)', { busy, has_fight: !!fight_id })
      fight_state_trace('commit_rejected_locally', {
        turn_key,
        background,
        busy,
        has_fight: !!fight_id,
        has_character: !!character_id,
      })
      // HONEST SURFACE (the "turn couldn't be committed" wedge): a FOREGROUND End-Turn press that gets dropped
      // must say WHY — the dev-gated trace above is invisible in ordinary play, so a swallowed `return false` left
      // the player thinking the button did nothing. Only `busy` is reachable behind a mounted button (no-fight ⇒
      // no button, phase machine); it still logs above regardless.
      if (!background && busy) push_event_toast({ state: 'info', title: i18n.t('dungeons.commit_busy') })
      return false
    }
    set({ busy: true, error: null })
    let ok = false
    const width = dungeon?.width ?? 0
    // SOLO = one player seat. A solo commit can NEVER abort turns::ESomeoneOverdue (needs a second seat), so it
    // SKIPS the per-commit dry-run. MULTIPLAYER keeps the sim so the overdue auto-crank stays a ZERO-gas refusal.
    const solo = (dungeon?.escrow?.length ?? 0) === 1
    const { batch, dropped } = stage_to_batch(actions, (cell) => to_fight_cell(cell, width))
    for (const a of dropped)
      game_log('dungeon', 'commit_turn: cast staged WITHOUT a SpellTemplate id — skipped (staging bug)', a)
    const play = async () => {
      const receipt = await commit_with_overdue_retry({
        commit: () => commit_turn_batch(fight_id, character_id, batch, true, solo),
        // TX TRANSPARENCY ("every transaction should be visible as it happens"): the inner overdue crank is
        // its own signed tx — announce it through the one toast home the instant it fires.
        crank: () => {
          push_event_toast({ state: 'info', title: i18n.t('dungeons.auto_crank_fired') })
          return tx_crank(fight_id, true)
        },
        is_overdue: is_someone_overdue_abort,
      })
      fight_state_trace('commit_receipt', {
        turn_key,
        background,
        status: receipt?.effects?.status?.status ?? 'unknown',
      })
      return receipt
    }
    try {
      const receipt = background ? await play() : await as_one_toast(i18n.t('dungeons.action_commit_turn'), play)
      if (receipt?.effects?.status?.status !== 'success') throw tx_error(receipt?.effects?.status?.error)
      // Fold the confirmed receipt through the core NOW (event-driven): the turn boundary + the mob wave are live
      // the instant the tx lands; refresh below is pure reconciliation and may lag without ever starving play.
      // RECEIPT-THEN-REFRESH RACE — DEFUSED (register #51, bridge B6): the refresh's tactical snapshot is no
      // longer a competing provider — it enters the SAME reducer merge as an equal-version object, so it COMPARES
      // (keystone #3: adopt only on divergence, deferred under a masking wave) instead of clobbering the just-
      // folded receipt. The two reads reconcile through one door, not two clocks.
      const version = fight_change_version(receipt, fight_id)
      if (version != null)
        fight_store.getState().input({
          type: 'receipt',
          receipt,
          version,
          fight_id,
          trap_cells: project.engine_view(fight_store.getState()).my_traps,
        })
      await get().refresh()
      ok = true
    } catch (error) {
      // Execution failure is an INPUT, never a replacement snapshot: discard the optimistic turn through the
      // reducer before any refresh arrives. An executed digest remains latched below and is never retried.
      fight_store.getState().input({ type: 'rollback' })
      fight_state_trace('commit_failed', {
        turn_key,
        background,
        executed_digest: error_executed_digest(error),
        message: String(error?.message ?? error),
      })
      const reason = humanize_abort(error)
      const digest = error_executed_digest(error)
      if (digest && turn_key) set({ _turn_commit_failure: executed_turn_failure(turn_key, digest, Date.now()) })
      if (background) {
        game_log('dungeon', 'background auto-commit failed (latched — no auto-retry):', reason, error)
        push_event_toast({ state: 'error', title: i18n.t('dungeons.auto_commit_failed', { reason }) })
      } else game_log('dungeon', 'commit_turn failed', error)
      set({ error: reason })
      await get()
        .refresh()
        .catch(() => {})
    }
    set({ busy: false, ...(ok ? { _turn_commit_failure: null } : {}) })
    fight_state_trace('commit_finished', { turn_key, background, ok })
    return ok
  },

  /**
   * FIGHT FORFEIT (§7 — "abandon any fight = a death"): `actions::abandon`. Works on ANY live fight
   * (world OR dungeon room). The seat dies through the ordinary damage write; a SOLO fight is then terminal → this
   * FORFEIT owns its settlement DETERMINISTICALLY by driving the SAME terminal claim(). A co-op fight teammates
   * still hold is NOT terminal: its receipt still owns local defeat, but settlement waits for the terminal outcome.
   */
  async abandon_fight() {
    const { fight_id, character_id: session_character_id, busy } = get()
    const character_id = transaction_character_id(fight_view(), session_character_id)
    if (busy || !fight_id || !character_id) {
      game_log('dungeon', 'abandon_fight dropped: busy/no-fight (loud-pipeline)', { busy })
      return false
    }
    set({ busy: true, error: null })
    let receipt
    try {
      receipt = await tx_abandon_fight(fight_id, character_id)
    } catch (error) {
      game_log('dungeon', 'abandon_fight failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
      await get()
        .refresh()
        .catch(() => {})
      set({ busy: false })
      return false
    }
    // NO FABRICATED FLOOR (register #52): only a REAL chain version may raise the confirmed floor. A receipt with
    // no extractable version is NOT fed as `applied_version + 1` (that raised the confirmation floor without chain
    // proof) — the abandon's roster write + claim + the trailing refresh reconcile the defeat instead. Mirrors the
    // commit path's `if (version != null)` guard exactly.
    const version = fight_change_version(receipt, fight_id)
    if (version != null)
      fight_store.getState().input({
        type: 'receipt',
        receipt,
        version,
        fight_id,
        // engine_view() is null when the local core never mirrored this fight (a forfeit receipt can land on a
        // fight the client only knows through resume/poll, never fully armed locally) — no local traps to roll
        // back is the correct, harmless default, never a crash on the receipt-teardown path (#117).
        trap_cells: project.engine_view(fight_store.getState())?.my_traps ?? [],
      })
    const { characters } = context.get_state().sui
    const defeated = apply_fight_receipt_to_roster(characters, { character_id, final_hp: 0 })
    if (defeated !== characters) context.dispatch('action/sui_data', { characters: defeated })
    await get().claim({
      immediate: true,
      winner: 1,
      settle: project.settlement_request(fight_store.getState()) !== null,
    })
    set({ busy: false })
    return true
  },

  /** EMERGENCY EXIT: `dungeon::abandon` consumes the pass (state-independent, own flight guard, never waits). */
  async abandon() {
    if (get()._abandoning) {
      game_log('dungeon', 'abandon: already in flight — ignoring re-click')
      return
    }
    const { run_pass_id, busy, dungeon, character_id } = get()
    if (!run_pass_id) {
      game_log('dungeon', 'abandon ABORT: no run_pass_id — nothing to leave')
      return
    }
    if (busy) game_log('dungeon', 'abandon: store busy — PREEMPTING, the exit does not wait')
    set({ _abandoning: true, busy: true, error: null })
    try {
      await abandon_run(run_pass_id, character_id)
      get()._stop_polling()
      // abandoning DURING an active fight I fought = a DEFEAT card; leaving a cleared/open room = clean exit.
      const abandoned_active_fight = had_active_seat(dungeon?.id)
      if (abandoned_active_fight) open_fight_recap(get, 1, 0)
      teardown()
      set(cleared_session('done'))
      void load_roster().catch(() => {})
    } catch (error) {
      game_log('dungeon', 'abandon failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false, _abandoning: false })
  },

  /** STUCK-RUN EXIT: abandon a RunPass BY ID with no active session (the "already in a run" gate's way out). */
  async abandon_escrowed(run_pass_id) {
    if (get()._abandoning) {
      game_log('dungeon', 'abandon_escrowed: already in flight — ignoring re-click')
      return
    }
    if (!run_pass_id) {
      game_log('dungeon', 'abandon_escrowed ABORT: no run_pass_id')
      return
    }
    set({ _abandoning: true, busy: true, error: null })
    try {
      await abandon_run(run_pass_id)
      void load_roster().catch(() => {})
    } catch (error) {
      game_log('dungeon', 'abandon_escrowed failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ _abandoning: false, busy: false })
  },

  /** In-run potions died with the S-46 split (no consume door on a latched run) — honest refusal, never silent. */
  async consume_potion() {
    game_log('dungeon', 'consume_potion: no in-run consume door on the deployed package (declared gap)')
    push_event_toast({ state: 'error', title: i18n.t('dungeons.potion_unavailable') })
  },

  /** TERMINAL claim (WON/FAILED): confirmed outcome → killing-wave drain → card + teardown → background settle. */
  async claim({ immediate = false, winner: forced_winner = null, settle = true } = {}) {
    const { fight_id, busy, dungeon } = get()
    const chain_winner = project.outcome_winner(fight_store.getState())
    const winner = forced_winner ?? chain_winner
    const invalid_outcome = winner == null || (chain_winner != null && winner !== chain_winner)
    if ((!immediate && busy) || !fight_id || get()._claiming || invalid_outcome) {
      game_log('dungeon', 'claim dropped: busy/no-fight/already-claiming/unconfirmed-outcome (loud-pipeline)', { busy })
      return
    }
    set({ _claiming: true }) // single-flight: forfeit's abandon_fight AND the board terminal-effect both call claim()
    note_victory(dungeon?.id ?? fight_id, dungeon?.room_index ?? 0, 'terminal') // machine → VICTORY_RESOLVED at once
    get()._stop_polling()
    // SNAPSHOT the chain ids + the defeat xp pool BEFORE the presentation nulls the session (the background chain
    // still needs them). character_id rides along: results::open kiosk-borrows it, so the open leg derives ITS kiosk.
    const chain_ids = {
      fight_id,
      run_pass_id: get().run_pass_id,
      world_id: get().world_id,
      character_id: get().character_id,
      owned_run_pass_ids: { ...get().owned_run_pass_ids },
    }
    const session_pass = get().run_pass_id
    const xp_pool = dungeon?.party_xp_pool ?? 0
    // PRESENT after the killing wave drains ("the HIT, then the numbers, THEN the death... and ONLY THEN the card").
    // The defeat recap opens here; the win card opens from the core terminal winner through the game-core lane.
    const present = () => {
      if (get().run_pass_id !== session_pass) return set({ _claiming: false }) // a fresh session replaced this one
      // The terminal LIFECYCLE EVENT (sanctioned vocabulary, not a state write): player_experience's listener
      // opens the WIN card (awaiting_reward) — it MUST fire before route_settlement lands, or finish_result's
      // xp/loot resolve is dropped (the card would skeleton forever). Defeat additionally opens its recap.
      context.dispatch('action/fight/ended', { winner })
      open_fight_recap(get, winner, xp_pool) // BOTH outcomes — reads the LIVE fight slice, MUST precede teardown
      teardown()
      set(cleared_session('done'))
      // POST-DEFEAT HP STALE FIX: teardown() just killed the live fight-view HP mirror (SelfPlate's `me` source,
      // S2 mirror kill) SYNCHRONOUSLY, but the chain write-back only lands async below (route_settlement is
      // fire-and-forget). A defeat's HP outcome is CLIENT-KNOWABLE though (SPEC §17.23 "defeat exits at 0 HP" —
      // a constant, not a computation) — predict it into the roster NOW, same idiom as abandon_fight's own patch,
      // so the world HUD's projected_hp never reads the stale pre-fight current_hp in the settle window. The later
      // settlement receipt (finish_result → apply_receipt_character) re-applies the same final_hp=0 (idempotent).
      if (winner !== 0 && chain_ids.character_id) {
        const { characters } = context.get_state().sui
        const defeated = apply_fight_receipt_to_roster(characters, {
          character_id: chain_ids.character_id,
          final_hp: 0,
        })
        if (defeated !== characters) context.dispatch('action/sui_data', { characters: defeated })
      }
      // Receipt-driven settlement spends gas: executed failures latch; only transport/preflight refusals re-arm.
      if (settle)
        void route_settlement(
          use_dungeon,
          winner === 0 ? STATUS_WON : STATUS_FAILED,
          {
            fight_id: chain_ids.fight_id,
            run_pass_id: chain_ids.run_pass_id,
            world_id: chain_ids.world_id,
            character_id: chain_ids.character_id,
          },
          {
            on_settled: owned_settlement_callback({
              world_id: chain_ids.world_id,
              leader_character_id: chain_ids.character_id,
              run_pass_ids_by_character: chain_ids.owned_run_pass_ids,
            }),
          }
        )
    }
    if (immediate) present()
    else hold_until_presented(present)
  },

  /** Mint whatever my OPENED FightResult still owes (retry surface for a partial chain), then burn it. */
  async mint_loot() {
    const { result_id, busy } = get()
    if (busy || !result_id) {
      game_log('dungeon', 'mint_loot dropped: busy/no-result (loud-pipeline)', { busy })
      return
    }
    set({ busy: true, error: null })
    try {
      await mint_owed(use_dungeon)
    } catch (error) {
      game_log('dungeon', 'mint_loot failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false })
  },

  /** Storage-rebate burn of an emptied FightResult — routed through the ATOMIC mint+burn composer with EMPTY
   *  templates (the on-chain `rolled.is_empty()` assert gates it, killing the abort-105 staleness class). */
  async burn() {
    const { result_id, busy } = get()
    if (busy || !result_id) {
      game_log('dungeon', 'burn dropped: busy/no-result (loud-pipeline)', { busy })
      return
    }
    set({ busy: true, error: null })
    try {
      await mint_all_and_burn(result_id, [])
      set({ result_id: null })
    } catch (error) {
      game_log('dungeon', 'burn failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false })
  },

  /**
   * RECOVERY (P0 anti-brick): finish the settlement of a character stranded with an unopened terminal fight (its
   * fight_marker never cleared → abort 111 ECharacterMarked forever). The characters-panel affordance fires this.
   * REFUSES while any session is live. Returns the recovery outcome for the affordance.
   * @param {string} character_id
   * @returns {Promise<'clean' | 'recovered' | 'failed'>}
   */
  async recover_pending(character_id) {
    const state = get()
    const retryable_settlement =
      state.fight_id &&
      state.character_id === character_id &&
      [STATUS_ROOM_CLEARED, STATUS_WON, STATUS_FAILED].includes(state.dungeon?.status)
    // Loud chip fallback for an auto-claim latch: a user press may retry THIS terminal session once, carrying its
    // RunPass/world context. It bypasses only the auto latch (`manual:true`), never the transaction flight guard.
    if (!state.busy && retryable_settlement) {
      const landed = await route_settlement(
        use_dungeon,
        state.dungeon?.status,
        {
          fight_id: state.fight_id,
          run_pass_id: state.run_pass_id,
          world_id: state.world_id,
          character_id,
        },
        { manual: true }
      )
      return landed ? 'recovered' : 'failed'
    }
    if (state.busy || state.fight_id || state.run_pass_id) {
      game_log('dungeon', 'recover_pending refused — a session is live; finish it first')
      return 'failed'
    }
    return recover_character(use_dungeon, character_id)
  },

  /** Reset the local UI state without touching the chain. */
  reset_local() {
    get()._stop_polling()
    teardown()
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
      in_session: false,
      room_recap: null,
      _claiming: false,
      fight_syncing: false,
      _turn_commit_failure: null,
    })
  },
}))

// ── THE ONE PROJECTION MIRROR: the core's board view → the legacy `dungeon` field every consumer reads. This is
// the ONE sanctioned set() of fight-derived data — adopt-whole, zero logic. No dedupe/floor/turn decision lives
// here (the core owns them); this only copies the current projection out for the unchanged renderer/HUD contract.
fight_store.subscribe((s) => use_dungeon.setState({ dungeon: project.board_view(s) }))

// The run store owns tx flight; mirror busy + its executed-failure proof through one reducer input so a busy clear
// can never briefly re-arm automatic submit before the money-critical latch is visible to the tick fold.
let _mirrored_busy = false
let _mirrored_turn_commit_failure = null
use_dungeon.subscribe((s) => {
  if (s.busy === _mirrored_busy && s._turn_commit_failure === _mirrored_turn_commit_failure) return
  _mirrored_busy = s.busy
  _mirrored_turn_commit_failure = s._turn_commit_failure
  fight_store.getState().input({ type: 'busy', value: s.busy, latch: s._turn_commit_failure })
})

// ── 3-state fight/dungeon music (in_session drives the dungeon⇄world transition). ─────────────────────────────
let _dungeon_music_armed = false
use_dungeon.subscribe((state) => {
  if (state.in_session === _dungeon_music_armed) return
  _dungeon_music_armed = state.in_session
  if (state.in_session) set_zone_music('arctic')
  else stop_zone_music()
})

// ── UNOPENED-RESULTS WIRES: detection must not depend on a UI surface (a restore straight into the WORLD never
// mounts the roster/badge). BOOT — post-auth once per wallet. REFUSAL — every abort-111 throw. ────────────────
const _kick_pending_open = (/** @type {boolean} */ announce) => {
  const { address } = use_auth.getState()
  if (!address) return
  void auto_open_pending_outcomes(use_dungeon, address, { announce }).catch(() => {})
}
if (should_boot_open(use_auth.getState().address)) _kick_pending_open(false) // module loads post-auth (restore)
use_auth.subscribe((s) => {
  if (should_boot_open(s.address)) _kick_pending_open(false) // sign-in lands after module load (fresh boot)
})
on_marker_refusal(() => _kick_pending_open(true))
