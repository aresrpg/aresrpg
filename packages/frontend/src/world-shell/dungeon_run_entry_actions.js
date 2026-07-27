// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon run ENTRY + RESUME effects. This is one action fragment of dungeon_run_store's single Zustand
// domain: it owns run activation, room-fight entry, and persisted-session adoption, but creates no store.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { context } from '../game/store.js'
import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { get_owned_items } from '../chain/read_staking'
import { get_dungeon_runs } from '../rpc/client'
import { T62_WORLDS, DEMO_NETWORK } from '../chain/deployment'
import { push_event_toast } from '../game/core/toast.js'
import i18n from '../i18n'
import { load_roster } from '../roster/load_roster'
import { note_player_advance, is_ending, fight_end_state } from '../fight-engine/fight_end_machine.js'
import { humanize_abort } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'

import { next_room_fight, join_room_fight } from './dungeon_actions'
import { activate_owned_dungeon_runs, join_owned_dungeon_room_fight } from './owned_team_actions.js'
import { derive_team_entry_plan, select_owned_run_pass_ids } from './team_entry.js'
import { read_object, decode_pass, load_world_meta, resolve_entry_key, is_gone_error } from './run_reads.js'
import { read_fight_liveness } from './fight_liveness.js'
import { key_candidates } from './key_pick.js'
import { recover_character } from './dungeon_settlement.js'
import { error_executed_digest } from './tx_digest_error.js'
import { init_dungeon_fight } from './dungeon_fight_shim.js'

// #654 — a `busy` latch that outlives its own action (a cancelled/hung resume, mid-flight) bricks that
// character's switch forever ("another character action is still in progress"). resume_dungeon stamps
// `busy_since` when IT acquires the lock; past this ceiling the guard treats it as abandoned rather than live.
const STALE_BUSY_MS = 45_000

const key_units = (items) => items.reduce((total, item) => total + Math.max(1, Math.floor(Number(item.amount ?? 1))), 0)

// The items package scope for the /v1 owner-items refetch that backstops a stale/empty bag at ENTER.
const PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

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

/**
 * The entry/resume methods mixed into dungeon_run_store's ONE state domain.
 * `get_store` is lazy because recovery helpers need the finished Zustand API after create() returns.
 */
export const create_dungeon_entry_actions = ({ set, get, get_store }) => ({
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
   * any), then publish the session exactly once — live+mine runs only (no optimistic flip on resume). The typed
   * result is consumed by CharacterSwitcher; promise settlement alone cannot distinguish success from a busy or
   * recovered refusal.
   * @param {string} run_pass_id @param {string} character_id
   * @param {{user?:boolean,is_current?:()=>boolean}} [options]
   * @returns {Promise<{status:'done'}|{status:'refused',reason:'busy'|'cancelled'}|{status:'failed',error:unknown}>}
   */
  async resume_dungeon(run_pass_id, character_id, { user = false, is_current = () => true } = {}) {
    const cancelled = () => !is_current()
    const cancelled_outcome = () => ({ status: 'refused', reason: 'cancelled' })
    if (cancelled()) return cancelled_outcome()
    if (get().busy) {
      // #654 STALENESS CEILING: a busy holder THIS door itself stamped (busy_since) past the ceiling is an
      // abandoned lock (a cancelled/hung resume that never hit its own release), not a live one — clear it,
      // surface one honest toast, and fall through to acquire fresh instead of refusing the switch forever. A
      // holder this door never stamped (busy_since null — some other in-flight action, e.g. a turn commit) is
      // always treated as fresh: never auto-cleared, so a genuinely different live action still wins the refusal.
      const age_ms = get().busy_since != null ? Date.now() - get().busy_since : 0
      if (age_ms <= STALE_BUSY_MS) {
        game_log('dungeon', 'resume ignored — store busy')
        return { status: 'refused', reason: 'busy' }
      }
      game_log('dungeon', 'resume: clearing a stale busy latch — an earlier action never released it', { age_ms })
      push_event_toast({ state: 'info', title: i18n.t('dungeons.stuck_action_cleared') })
    }
    set({
      busy: true,
      busy_since: Date.now(),
      error: null,
      phase: 'entering',
      character_id,
      session_address: use_auth.getState().address,
    })
    try {
      const sdk = await get_sdk()
      if (cancelled()) return cancelled_outcome()
      let pass
      try {
        pass = decode_pass(await read_object(sdk, run_pass_id))
      } catch (error) {
        if (cancelled()) return cancelled_outcome()
        if (is_gone_error(error)) {
          get()._recover_stale_membership({ user })
          return { status: 'failed', error }
        }
        throw error
      }
      if (cancelled()) return cancelled_outcome()
      const me = use_auth.getState().address
      if (!pass || pass.owner !== me) {
        get()._recover_stale_membership({ user })
        return { status: 'failed', error: new Error('Dungeon run is no longer owned by this account') }
      }
      // Validate the latched Fight itself before any session field flips (a durable-but-dead reference remounts a
      // ghost board otherwise). A transport failure throws to the retryable resume path; only absent/terminal
      // truth clears locally and starts the pending-outcome recovery.
      if (pass.fight) {
        const liveness = await read_fight_liveness(sdk, pass.fight)
        if (cancelled()) return cancelled_outcome()
        if (liveness.state !== 'live') {
          get()._recover_dead_fight_reference({ character_id, state: liveness.state })
          return { status: 'failed', error: new Error(`Dungeon fight is ${liveness.state}`) }
        }
      }
      const { rooms, mob_names, mob_levels, mob_elements } = await load_world_meta(sdk, pass.world)
      if (cancelled()) return cancelled_outcome()
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
        if (cancelled()) return cancelled_outcome()
        game_log('dungeon', 'owned RunPass resume map unavailable — retaining the selected pass only', error)
      }
      if (cancelled()) return cancelled_outcome()
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
      if (cancelled()) return cancelled_outcome()
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
      await get().refresh({ is_current })
      if (cancelled()) return cancelled_outcome()
      // refresh() can reset a dead session — never restart the poll on one, and report that recovery to a
      // user-initiated character switch instead of resolving with an indistinguishable `undefined`.
      if (!get().run_pass_id)
        return { status: 'failed', error: new Error('Dungeon run became unavailable while resuming') }
      get()._start_polling()
    } catch (error) {
      if (cancelled()) return cancelled_outcome()
      game_log('dungeon', 'resume_dungeon failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)), phase: 'idle', in_session: false })
      return { status: 'failed', error }
    } finally {
      // #654 — EVERY exit releases the lock (a cancelled()/gone-pass/dead-fight/refresh-raced early `return`
      // above, the catch, or the plain success fallthrough): a rejected/aborted resume must never outlive itself.
      set({ busy: false, busy_since: null })
    }
    return { status: 'done' }
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
      void recover_character(get_store(), character_id)
        .catch(() => 'failed')
        .finally(() => void load_roster().catch(() => {}))
    else void load_roster().catch(() => {})
  },
})
