// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_tick.js — pure clock and wave-watchdog transitions for the single fight-store door.

import { project_board } from './core_project.js'
import { auto_commit_fire_at } from './draft_budget.js'
import { presented_state, recompute, turn_is_playable } from './fold.js'
import { MIN_ACTION_MS, min_turn_ready_at, WAVE_ACK_GRACE_MS } from './store_state.js'
import { auto_commit_decision, turn_commit_key, turn_submit_epoch } from './turn_commit.js'

export const reduce_tick_state = (state, msg, next_core, now) => {
  const canonical = project_board(next_core)
  const deadline = Number(state.turn_deadline_ms ?? 0)
  const deadline_fresh = state.turn_deadline_fresh === true && deadline > 0
  const tick_last_action = Number(msg.last_action_ms ?? state.last_action_ms ?? 0)
  const last_action_ms = Math.max(
    state.last_action_ms,
    Number.isFinite(tick_last_action) ? tick_last_action : state.last_action_ms
  )
  const draft_count = Number(msg.draft_count ?? state.staged.length)
  const commit_latch = msg.latch === undefined ? state.commit_latch : msg.latch
  const submit_epoch = turn_submit_epoch(state)
  const turn_key = turn_commit_key({
    fight_id: state.fight_id,
    entity_id: state.ctx?.my_entity_id ?? state.my_key,
    deadline_ms: deadline,
  })
  const decision = auto_commit_decision({
    enabled:
      msg.enabled !== false &&
      deadline_fresh &&
      canonical.active != null &&
      canonical.active === (next_core.my_seat ?? state.my_key) &&
      canonical.winner === -1 &&
      canonical.phase === 'active',
    busy: state.busy,
    now_ms: now,
    deadline_ms: deadline,
    latch: commit_latch,
    turn_key,
  })

  const deadline_due = deadline_fresh && now >= auto_commit_fire_at(deadline, state.view?.turn_ms)
  const local_mobs = Object.values(presented_state(state).fighters ?? {}).filter((fighter) => fighter.is_mob)
  // The SAME min-turn anchor the button and the intent door read (#1484): the kill auto-commit fires a real
  // act_pass, so it is subject to `actions::assert_min_turn` exactly like a manual press.
  const min_turn_at = min_turn_ready_at(state)
  const kill_due =
    deadline_fresh &&
    local_mobs.length > 0 &&
    local_mobs.every((fighter) => !fighter.alive) &&
    (state.wave ?? []).length === 0 &&
    min_turn_at != null &&
    now >= min_turn_at &&
    now >= last_action_ms + MIN_ACTION_MS
  const epoch_burned = submit_epoch != null && submit_epoch === state.commit_attempt_epoch && !state.busy
  const expired = deadline_fresh && now >= deadline
  const lost_reason =
    draft_count > 0 && state.turn_lost?.key !== turn_key
      ? decision === 'latched'
        ? 'latched'
        : expired && decision === 'missed'
          ? 'missed'
          : expired && decision === 'fire' && epoch_burned
            ? 'burned'
            : null
      : null

  const ticked = {
    ...state,
    commit_due:
      submit_epoch != null &&
      submit_epoch !== state.commit_attempt_epoch &&
      decision === 'fire' &&
      (deadline_due || kill_due),
    commit_latch,
    last_action_ms,
    turn_lost: lost_reason ? { key: turn_key, reason: lost_reason } : state.turn_lost,
  }
  // THE TURN HANDOVER (#1808) — the ONE transition that is driven by the clock alone: the chain finishes
  // spending this turn's mob-resolution budget while no input arrives. Every other fold trigger is a message.
  // Asking the fold's own predicate (never a second copy of the boundary) keeps this to one re-fold per turn,
  // on the rising edge, through the same reducer door — no timer of its own, no callback write.
  const handover =
    !state.turn_playable &&
    turn_is_playable(
      {
        active: canonical.active,
        my_key: next_core.my_seat ?? state.my_key,
        wave: state.wave,
        deadline_ms: state.turn_deadline_ms,
        turn_ms: state.view?.turn_ms,
        chain_offset_ms: state.chain_offset_ms,
      },
      now
    )
  // The fold reads the SAME core the guard just measured (`canonical`), so the two can never disagree about
  // whose turn it is. On this path they are already the one object — `input`'s `next_core` defaults to the live
  // core and the tick has no core of its own to adopt — so this is identity today and coherent if that changes.
  return handover ? recompute({ ...ticked, core: next_core }, now) : ticked
}

export const reduce_wave_head = (state, head, now) => ({
  ...state,
  wave_head: head ? (state.wave_head?.seq === head.seq ? state.wave_head : { seq: head.seq, at: now }) : null,
})

export const expired_wave_seq = (state, now) => {
  const head = (state.wave ?? [])[0] ?? null
  const watch = state.wave_head
  return head && watch && watch.seq === head.seq && now > watch.at + (head.duration || 0) + WAVE_ACK_GRACE_MS
    ? head.seq
    : null
}
