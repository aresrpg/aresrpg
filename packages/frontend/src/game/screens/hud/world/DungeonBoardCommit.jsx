// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's staged-turn validation, composition, and auto-commit subscriptions. Split out of
// DungeonBoard.jsx (issue #2069); the section is unchanged.
import { useEffect } from 'react'

import { push_event_toast } from '../../../core/toast.js'
import { emit_hit_correction } from '../../../core/modules/fight_log_correction.js'
import { context } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import {
  compose_staged_turn,
  staged_turn_paths,
  subscribe_commit_due,
  subscribe_divergence,
  subscribe_turn_lost,
} from '@aresrpg/fight/txs'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'
import { CAST_DROP_STALE_TARGET } from '@aresrpg/fight/turn_commit'
import { game_log } from '../../../../core/log.js'
import { fight_state_trace } from '../../../../world-shell/fight_state_trace.js'
import { emit_local_cast_drop_toast } from './cast_drop_toast.js'
import { validate_commit_casts } from './dungeon-board-commit-casts.js'

// The two facts a history correction reads, both LIVE (#2151): the chat rows it may address, and the fighters
// map its names resolve through — the same pair every combat-log emitter is handed, assembled here because this
// module holds the divergence edge rather than the render adapter's own scoped reader.
const correction_state = () => ({ ...context.get_state(), fight: fight_view() })

// Dungeon.status machine (dungeon.move). ROOM_CLEARED is handled in dungeon_store (board unmounts → plane).
const STATUS_ACTIVE = 1 // live fire-time guard for the reducer-derived commit edge
// (STATUS_PLACEMENT removed — the placement chrome gate is now the phase machine's is_placement, not a raw read)

/**
 * Install the commit-edge subscriptions and return the shared manual/background turn flusher.
 */
export function useDungeonBoardCommit(state, t) {
  const {
    auto_submit_ref,
    entity_id,
    me,
    my_spells,
    resolve_ref,
    dungeon,
    level_row,
    cast_params,
    active_fighter,
    occupied,
    obstacles,
    fight,
    commit_turn,
    my_turn_no,
    record_cast_turns,
    clear_picks,
  } = state

  // ── AUTO-COMMIT (D36 deadline + D37a kill) — the reducer derives one due edge; this function remains the
  //    shared manual/background batch builder and revalidates the live fire conditions before submit. ──
  const flush_commit = async (draft_actions, background = false) => {
    // LOUD-PIPELINE (qa D89 flag: a sequential commit dropped SILENTLY): the last mute guard on the END TURN
    // path now NAMES itself instead of vanishing.
    // Read `busy` LIVE at the derived edge; a render closure is never transaction authority.
    const busy_now = use_dungeon.getState().busy
    // TERMINAL-RACE guard (regression: the deadline auto-commit fired begin_action into a fight the
    // killing blow already ENDED → SimulationError abort 101, then a scary "failed on-chain" toast). Only an
    // ACTIVE fight on MY still-live turn takes a commit. Re-read the fire conditions LIVE at FIRE time — status
    // from the store AND my-turn/winner from the live fight slice (the `my_turn` closure can be stale by the time
    // an async edge runs) — so a moot commit is SKIPPED silently (nothing to commit, no toast). The
    // benign-101 swallow in commit_turn is the backstop for the case only the CHAIN yet knows is terminal.
    const status_now = use_dungeon.getState().dungeon?.status
    const live_fight = fight_view() // synchronous core view (S2 mirror kill) — fire-time truth, never a stale copy
    const my_turn_now = !!live_fight && live_fight.active_entity_id === entity_id && live_fight.winner === -1
    if (!my_turn_now || busy_now || status_now !== STATUS_ACTIVE) {
      fight_state_trace('flush_skipped', {
        background,
        my_turn: my_turn_now,
        busy: busy_now,
        status: status_now,
      })
      game_log('board', 'flush_commit skipped — not an active commit at fire time', {
        my_turn_now,
        busy: busy_now,
        status: status_now,
        background,
      })
      return
    }
    // D254 (1.29 cumulative move): EACH drafted step ships as its OWN {kind:0} move — commit_turn_core's loop
    // charges bfs_path_cost PER segment from the running cell (a single direct move under-charges a bent path).
    const move_actions = (draft_actions ?? [])
      .filter((action) => action.kind === 0)
      .map((action) => ({ kind: 0, target: action.target }))
    // S-12 §17.27 STACKED CASTS: the ordered validator keeps rejected casts in empty slots, so later survivors
    // never slide ahead of an intervening move. It also returns the trap/drop records consumed below.
    const { cast_actions, trap_placed, trap_dropped, dropped, cast_drops } = validate_commit_casts({
      draft_actions,
      my_spells,
      me,
      fight,
      entity_id,
      resolve_ref,
      occupied,
      obstacles,
      dungeon,
      level_row,
      cast_params,
      active_fighter,
      background,
      t,
    })
    // ROLLBACK LAW (regression: "mobs regain health"): predictions now retire through the ONE receipt ingress by
    // claim identity; the receipt's TurnEnded expires any local cast prediction the committed batch omitted. An
    // unrelated receipt never purges it, and object snapshots never re-adopt over the fold (M6 + M2b).
    // ARRAY ORDER (#398): validated casts return to their original staged slots; moves stay exactly where drafted.
    const actions = compose_staged_turn(draft_actions, cast_actions)
    const resolved_casts = cast_actions.filter(Boolean)
    fight_state_trace('flush_started', {
      background,
      move_count: move_actions.length,
      cast_count: resolved_casts.length,
      dropped,
    })
    const ok = await commit_turn(actions, { background }) // reconciles to committed chain (crit lands here)
    // ④+⑦b: the store's durable my_traps is the ONE trap home — a trap whose cast never reached the chain (dropped,
    // or a failed commit) is taken back by cell through drop_traps; render + cast-legality read the same fold.
    const store_dropped = ok ? trap_dropped : [...trap_placed, ...trap_dropped]
    if (fight?.fight_id && store_dropped.length)
      fight_store.getState().input({ type: 'drop_traps', cells: store_dropped })
    fight_state_trace('flush_finished', { background, ok })
    // NO SILENT FAILURE (#922): a refused commit throws the whole drafted turn away, and until now the ONLY tell
    // was this trace line's `ok:false` — which is off unless fight-state tracing is armed. The simulator's silent
    // END-TURN loop is exactly what that costs. One honest log per refusal, on every composition; the store door
    // that refused (chain tx or sim shim) still owns the WHY and its own toast.
    if (!ok)
      game_log('board', 'commit refused — the drafted turn was rolled back', {
        background,
        move_count: move_actions.length,
        cast_count: resolved_casts.length,
      })
    // FIX 4: stamp each committed SPELL cast (kind:1) onto the cooldown clock at the turn it cast (my_turn_no) —
    // mirrors enforce_and_record_cast recording only casts that LANDED (a dropped/weapon action records nothing).
    if (ok) {
      const cast_turns = /** @type {Record<string, number>} */ ({})
      for (const a of resolved_casts) if (a.kind === 1 && a.spell_key) cast_turns[a.spell_key] = my_turn_no
      if (entity_id && Object.keys(cast_turns).length) record_cast_turns(entity_id, cast_turns)
    }
    clear_picks()
    // FIX 2 (overrules D97 silence): a flush-time cast DROP surfaces ONE honest event toast — the moves
    // committed, the spell did not (its target went stale). Only on a SUCCESSFUL commit; a FAILED commit already
    // surfaces its own single toast (manual via tx_commit_turn, background via commit_turn's catch below).
    // The named out-of-reach toast has exactly one input: a genuine local cast-drop record from drop_entry above,
    // consumed only after the surviving batch commits. Accepted events and claim retirement stay state-only.
    emit_local_cast_drop_toast({
      commit_succeeded: ok,
      drops: cast_drops,
      local_actor_id: entity_id,
      t,
      emit: push_event_toast,
    })
    const stale_spell_names = cast_drops
      .filter((drop) => drop.reason === CAST_DROP_STALE_TARGET)
      .map((drop) => drop.spell_name)
    if (ok && stale_spell_names.length > 0)
      push_event_toast({
        state: 'info',
        title: t('dungeons.cast_dropped_stale', { spell: stale_spell_names.join(', ') }),
      })
    fight_store.getState().input({ type: 'clear_staged' })
    return ok
  }
  // The reducer owns deadline/kill/busy/latch decisions. This is the ONE remaining effect: claim the derived
  // false→true edge once for the playable turn, read the draft live, and submit the existing background commit.
  // #605: an idle (zero-draft) due commit is NEVER a no-op — an empty batch is the exact legal bare pass
  // on_end_turn already sends with nothing staged (turn_commit.js's auto_commit_decision docblock: "a ZERO-draft
  // turn still fires ... to trigger mob actions"); skipping it left an armed turn timer hanging past its
  // deadline until the player clicked End Turn themselves — the one path this edge exists to replace.
  auto_submit_ref.current = () => {
    const { draft_actions, move_path: mp, cast_path: cq } = staged_turn_paths(fight_store)
    fight_state_trace('auto_flush_fired', { move_count: mp.length, cast_count: cq.length })
    return flush_commit(draft_actions, true)
  }
  useEffect(
    () =>
      subscribe_commit_due(fight_store, {
        submit: () => auto_submit_ref.current?.(),
        on_error: (error) => {
          fight_state_trace('auto_flush_edge_error', { message: String(error?.message ?? error) })
          game_log('board', 'auto-commit edge failed', error)
        },
      }),
    []
  )
  useEffect(
    () =>
      subscribe_divergence(fight_store, {
        on_divergence: (divergence) => {
          game_log('board', 'fight prediction diverged; authoritative action adopted', divergence)
          // ADOPTION CORRECTS THE HISTORY IT SUPERSEDED (#2151). Everything else in the client already
          // reconciled — the fold, the HP bar, the board — while the combat log kept the number the click
          // predicted, because my own authoritative rows never become a wave turn to re-emit from. The store
          // priced the correction; spending it here rewrites that one line in place, at the same subscriber
          // that owns the divergence's one existing log family (it consumes the edge — there is only ever one).
          // Read live, never off this effect's `[]` closure: the corrector must address the line the CURRENT
          // seat wrote, and a remount that changed characters would otherwise correct someone else's history.
          emit_hit_correction(correction_state, context.dispatch, {
            entity_id: fight_store.getState().ctx?.my_entity_id,
            correction: divergence.correction,
          })
        },
      }),
    []
  )
  // The reducer surfaces a drafted turn that expired uncommitted as `turn_lost`; consume and trace that edge
  // exactly once per turn (reducer-owned `shown` consumption — remount-safe), without announcing an auto-pass.
  useEffect(
    () =>
      subscribe_turn_lost(fight_store, {
        on_lost: ({ reason }) => {
          fight_state_trace('turn_lost_toast', { reason })
        },
      }),
    []
  )

  return flush_commit
}
