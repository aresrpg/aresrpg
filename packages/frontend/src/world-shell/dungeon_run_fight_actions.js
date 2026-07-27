// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon run FIGHT + SETTLEMENT effects. This is one action fragment of dungeon_run_store's single Zustand
// domain: it owns gameplay transactions and terminal settlement, but creates no store.

import { fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { fight_view } from '@aresrpg/fight/project'
import { STATUS_ROOM_CLEARED, STATUS_WON, STATUS_FAILED, to_fight_cell } from '@aresrpg/fight/board_state'
import { auto_commit_blocked, executed_turn_failure, stage_to_batch, turn_commit_key } from '@aresrpg/fight/turn_commit'
import { transaction_character_id } from '@aresrpg/fight/fight_control'
import { apply_fight_receipt_to_roster } from '@aresrpg/inventory/fight_receipt_roster'

import { context } from '../game/store.js'
import { use_auth } from '../auth'
import { push_event_toast } from '../game/core/toast.js'
import i18n from '../i18n'
import { load_roster } from '../roster/load_roster'
import { note_victory, fight_end_reset } from '../fight-engine/fight_end_machine.js'
import { humanize_abort, parse_move_abort, tx_error } from '../game/core/abort_copy.js'
import { had_active_seat, session_reset } from '../fight-engine/phase.js'
import { game_log } from '../core/log.js'

import {
  as_one_toast,
  abandon_run,
  abandon_fight as tx_abandon_fight,
  place as tx_place,
  commit_turn_batch,
  crank as tx_crank,
  mint_all_and_burn,
} from './dungeon_actions'
import { settle_owned_dungeon_companions } from './owned_dungeon_settlement.js'
import { fight_recap_payload } from './fight_recap.js'
import { commit_with_overdue_retry } from './overdue_retry.js'
import { mint_owed, recover_character } from './dungeon_settlement.js'
import { reset_liquidation } from './fight-liquidation.js'
import { error_executed_digest } from './tx_digest_error.js'
import { fight_state_trace } from './fight_state_trace.js'
import { hold_until_presented, route_settlement } from './dungeon_fight_shim.js'

const is_someone_overdue_abort = (/** @type {any} */ error) => {
  const a = parse_move_abort(error)
  return a?.module === 'turns' && a?.code === 108
}

const fight_change_version = (/** @type {any} */ receipt, /** @type {string} */ fight_id) => {
  const change = (receipt?.objectChanges ?? []).find(
    (c) => String(c?.objectId) === String(fight_id) && c?.version != null
  )
  return change ? Number(change.version) : null
}

export const owned_settlement_callback = (get_store, { world_id, leader_character_id, run_pass_ids_by_character }) => {
  if (Object.keys(run_pass_ids_by_character ?? {}).length <= 1) return undefined
  return async ({ receipt }) => {
    try {
      const result_ids = await settle_owned_dungeon_companions({
        leader_receipt: receipt,
        world_id,
        leader_character_id,
        run_pass_ids_by_character,
      })
      get_store().setState((state) => ({
        owned_result_ids: { ...state.owned_result_ids, ...result_ids },
        owned_team_settlement_blocked: false,
      }))
    } catch (error) {
      const landed = error?.opened_result_ids ?? {}
      get_store().setState((state) => ({
        owned_result_ids: { ...state.owned_result_ids, ...landed },
        owned_team_settlement_blocked: true,
        error: i18n.t('errors.fight_result_latched'),
      }))
      push_event_toast({ state: 'error', title: i18n.t('errors.fight_result_latched') })
      throw error
    }
  }
}

function open_fight_recap(get, winner, xp = 0) {
  const { fight_id, fight_started_at_ms, fight_start_partial } = get()
  const started_at = fight_started_at_ms ?? (fight_id ? fight_store.trace_tap.fight_opened_at(fight_id) : null)
  context.dispatch(
    'action/fight_summary/open',
    fight_recap_payload({
      fighters: fight_view()?.fighters,
      my_addr: use_auth.getState().address,
      winner,
      xp,
      duration_ms: started_at ? Date.now() - started_at : 0,
      duration_partial: fight_start_partial,
    })
  )
}

export function teardown_dungeon_fight() {
  fight_store.getState().input({ type: 'init', fight_id: null })
  fight_end_reset()
  session_reset()
  reset_liquidation()
}

export const cleared_dungeon_session = (/** @type {string} */ phase) => ({
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
  spectating: false,
  _turn_commit_failure: null,
})

export const create_dungeon_fight_actions = ({ set, get, get_store }) => ({
  claim_settling: () => {
    if (get()._settling) return false
    set({ _settling: true })
    return true
  },

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
      if (!background && busy) push_event_toast({ state: 'info', title: i18n.t('dungeons.commit_busy') })
      return false
    }
    set({ busy: true, error: null })
    let ok = false
    const width = dungeon?.width ?? 0
    const solo = (dungeon?.escrow?.length ?? 0) === 1
    const { batch, dropped } = stage_to_batch(actions, (cell) => to_fight_cell(cell, width))
    for (const a of dropped)
      game_log('dungeon', 'commit_turn: cast staged WITHOUT a SpellTemplate id — skipped (staging bug)', a)
    const play = async () => {
      const receipt = await commit_with_overdue_retry({
        commit: () => commit_turn_batch(fight_id, character_id, batch, true, solo),
        crank: () => tx_crank(fight_id, true),
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
    const version = fight_change_version(receipt, fight_id)
    if (version != null)
      fight_store.getState().input({
        type: 'receipt',
        receipt,
        version,
        fight_id,
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
      const abandoned_active_fight = had_active_seat(dungeon?.id)
      if (abandoned_active_fight) open_fight_recap(get, 1, 0)
      teardown_dungeon_fight()
      set(cleared_dungeon_session('done'))
      void load_roster().catch(() => {})
    } catch (error) {
      game_log('dungeon', 'abandon failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false, _abandoning: false })
  },

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

  async consume_potion() {
    game_log('dungeon', 'consume_potion: no in-run consume door on the deployed package (declared gap)')
    push_event_toast({ state: 'error', title: i18n.t('dungeons.potion_unavailable') })
  },

  async claim({ immediate = false, winner: forced_winner = null, settle = true } = {}) {
    const { fight_id, busy, dungeon } = get()
    const chain_winner = project.outcome_winner(fight_store.getState())
    const winner = forced_winner ?? chain_winner
    const invalid_outcome = winner == null || (chain_winner != null && winner !== chain_winner)
    if ((!immediate && busy) || !fight_id || get()._claiming || invalid_outcome) {
      game_log('dungeon', 'claim dropped: busy/no-fight/already-claiming/unconfirmed-outcome (loud-pipeline)', { busy })
      return
    }
    set({ _claiming: true })
    note_victory(dungeon?.id ?? fight_id, dungeon?.room_index ?? 0, 'terminal')
    get()._stop_polling()
    const chain_ids = {
      fight_id,
      run_pass_id: get().run_pass_id,
      world_id: get().world_id,
      character_id: get().character_id,
      owned_run_pass_ids: { ...get().owned_run_pass_ids },
    }
    const session_pass = get().run_pass_id
    const xp_pool = dungeon?.party_xp_pool ?? 0
    const present = () => {
      if (get().run_pass_id !== session_pass) return set({ _claiming: false })
      context.dispatch('action/fight/ended', { winner })
      open_fight_recap(get, winner, xp_pool)
      teardown_dungeon_fight()
      set(cleared_dungeon_session('done'))
      if (winner !== 0 && chain_ids.character_id) {
        const { characters } = context.get_state().sui
        const defeated = apply_fight_receipt_to_roster(characters, {
          character_id: chain_ids.character_id,
          final_hp: 0,
        })
        if (defeated !== characters) context.dispatch('action/sui_data', { characters: defeated })
      }
      if (settle)
        void route_settlement(
          get_store(),
          winner === 0 ? STATUS_WON : STATUS_FAILED,
          {
            fight_id: chain_ids.fight_id,
            run_pass_id: chain_ids.run_pass_id,
            world_id: chain_ids.world_id,
            character_id: chain_ids.character_id,
          },
          {
            on_settled: owned_settlement_callback(get_store, {
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

  async mint_loot() {
    const { result_id, busy } = get()
    if (busy || !result_id) {
      game_log('dungeon', 'mint_loot dropped: busy/no-result (loud-pipeline)', { busy })
      return
    }
    set({ busy: true, error: null })
    try {
      await mint_owed(get_store())
    } catch (error) {
      game_log('dungeon', 'mint_loot failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
    set({ busy: false })
  },

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

  async recover_pending(character_id) {
    const state = get()
    const retryable_settlement =
      state.fight_id &&
      state.character_id === character_id &&
      [STATUS_ROOM_CLEARED, STATUS_WON, STATUS_FAILED].includes(state.dungeon?.status)
    if (!state.busy && retryable_settlement) {
      const landed = await route_settlement(
        get_store(),
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
    return recover_character(get_store(), character_id)
  },
})
