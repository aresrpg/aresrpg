// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure snapshot-base helpers shared by the presentation fold and the headless core fold.

import { mob_entity_index, participant_entity_id } from './fight_control.js'
import { empty_state } from './inputs.js'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_WON } from './board_state.js'
import { INVISIBILITY_STATUS_KIND } from './fight_status_snapshot.js'

// TURN-START BUDGET resolver (advisor pass-19): a seat index → its begin_turn refill {ap, mp} = the base pool from
// the current view's escrow. The TurnStarted event omits ap/mp (fight_events.move:24), so core_fold enriches it
// before this fold predicts the refill — else the projected budget is the stale pre-refill snapshot (0) and the
// whole turn's move/cast range reads empty (the dead opening click).
export const base_budget = (view) => (idx) => {
  const p = (view?.escrow ?? [])[idx]
  return p ? { ap: p.base_ap ?? null, mp: p.base_mp ?? null } : null
}

export const last_action_of = (fight, fallback = 0) => {
  const value = Number(fight?.last_action_ms ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

/** Thin fold base derived from the adopted rich view — the snapshot half of snapshot+tail. */
export const base_from_view = (view, fight_id) => {
  const base = empty_state(fight_id ?? view?.id ?? null)
  if (!view) return base
  // SeatTurnKey is a dynamic field and is absent from the Fight object. An ACTIVE bootstrap is at least round one;
  // every later accepted TurnStarted advances the exact canonical counter in apply_action.
  const base_turn_number = view.status === STATUS_ACTIVE ? 1 : 0
  const fighters = {}
  for (const p of view.escrow ?? []) {
    const key = `p${p.seat}`
    fighters[key] = {
      key,
      is_mob: false,
      cell: p.cell,
      hp: p.hp,
      alive: p.alive,
      invisible: false,
      ap: p.ap,
      mp: p.mp,
      turn_number: base_turn_number,
    }
  }
  ;(view.mobs ?? []).forEach((m, idx) => {
    const key = `m${idx}`
    fighters[key] = {
      key,
      is_mob: true,
      cell: m.cell,
      hp: m.hp,
      alive: m.alive,
      invisible: false,
      ap: m.ap,
      mp: m.mp,
      turn_number: base_turn_number,
    }
  })
  // Snapshot status rows are entity-mapped OBJECTS { entity_id, kind, remaining_turns, element, value, stat, chance }
  // (fight_status_snapshot.status_snapshot_entities) — was invisibility-only, now every kind. Register #53: map by
  // entity_id, matching a seat via participant_entity_id (its inverse). GROUP them PER FIGHTER as `statuses` (the
  // HUD's effect badges read the whole set via engine_view.effects), and DERIVE `invisible` from a kind-27 row —
  // ONE home, never a second boolean channel duplicating the truth.
  const status_rows = {}
  for (const status of view.invisibility_statuses ?? []) {
    const id = status?.entity_id == null ? '' : String(status.entity_id)
    if (!id) continue
    const seat = (view.escrow ?? []).findIndex((p) => participant_entity_id(p) === id)
    const mob_idx = mob_entity_index(id)
    const key = seat >= 0 ? `p${seat}` : mob_idx == null ? null : `m${mob_idx}`
    if (key && fighters[key])
      status_rows[key] = [
        ...(status_rows[key] ?? []),
        {
          kind: Number(status.kind) || 0,
          remaining_turns: Number(status.remaining_turns) || 0,
          element: status.element ?? null,
          value: status.value ?? null,
          stat: status.stat ?? null,
          chance: status.chance ?? null,
          source: status.source ?? null,
          ...(status.flags != null ? { flags: status.flags } : {}),
        },
      ]
  }
  for (const [key, rows] of Object.entries(status_rows))
    fighters[key] = {
      ...fighters[key],
      statuses: rows,
      invisible: rows.some((row) => row.kind === INVISIBILITY_STATUS_KIND),
    }
  const actor = view.status === STATUS_ACTIVE ? view.turn_queue?.[view.turn_ptr] : null
  const observed_deadline = Number(view.turn_deadline_ms ?? 0)
  const actor_key = actor ? `${actor.is_mob ? 'm' : 'p'}${Number(actor.idx)}` : null
  return {
    ...base,
    fighters,
    active: actor_key,
    turn_ordinal:
      actor_key == null
        ? null
        : observed_deadline > 0
          ? String(observed_deadline)
          : `${Number(view.version ?? 0)}:${Number(view.turn_ptr ?? 0)}`,
    turn_deadline_ms: observed_deadline > 0 ? observed_deadline : null,
    // The seed is a TurnStarted-only fact (a Move dynamic field the snapshot cannot carry): the base opens null and
    // the folded TurnStarted (apply_action) stamps it. Never derived from the decoded view.
    turn_seed_inputs: null,
    turn_deadline_fresh: actor != null && observed_deadline > 0,
    phase: view.status === STATUS_WON ? 'victory' : view.status === STATUS_FAILED ? 'defeat' : 'active',
    winner: view.status === STATUS_WON ? 0 : view.status === STATUS_FAILED ? 1 : -1,
  }
}
