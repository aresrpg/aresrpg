// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_prediction.js — pure optimistic intent and prediction transitions for the single store door.

import { prediction_identity } from './budget_claims.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'
import { merge_entries, presented_state, recompute } from './fold.js'
import { actor_from_key, apply_action, fighter_key, normalize_intent, seat_resolver } from './inputs.js'
import { reconcile_predictions } from './reconcile_action.js'
import { PLAYER_TURN_FLOOR_MS } from './store_state.js'

const actor_key = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${Number(idx)}`

const budget_target = (action) => {
  if (action?.kind === 'Granted') return actor_key(action.target_is_mob, action.target_idx)
  if (action?.kind === 'Moved') return fighter_key({ character: action.character, resolve_seat: action.resolve_seat })
  return null
}

/** Store the signed budget delta contributed by a speculative move so undo composes with prior grants/moves. */
const with_move_budget_delta = (state, action) => {
  if (action?.kind !== 'Moved' || action.mp_left == null) return action
  const target = budget_target(action)
  const fighter = target == null ? null : presented_state(state).fighters?.[target]
  const before = fighter?.mp_unclamped ?? fighter?.mp
  const after = Number(action.mp_left)
  if (before == null || !Number.isFinite(Number(before)) || !Number.isFinite(after)) return action
  return { ...action, mp_delta: after - Number(before) }
}

const boundary_target = (action) => {
  if (action?.kind === 'TurnEnded') return actor_key(action.is_mob, action.idx)
  if (action?.kind === 'Hit' && Number(action.remaining_hp) <= 0)
    return actor_key(action.victim_is_mob, action.victim_idx)
  if (action?.kind === 'Abandoned') return actor_key(false, action.seat)
  return null
}

/** Merge newly proven non-canonical budget facts, then let a target's own turn-end/death boundary win. */
export const update_claimed_budget = (current, claimed, boundaries) => {
  const rows = new Map((current ?? []).map((row) => [row.key, row]))
  for (const row of claimed ?? []) rows.set(row.key, row)
  const ends = (boundaries ?? [])
    .map((action) => ({
      key: boundary_target(action),
      version: Number(action.version),
      event_idx: Number(action.event_idx),
    }))
    .filter((row) => row.key && Number.isFinite(row.version))
  for (const [key, row] of rows) {
    const target = budget_target(row.action)
    const version = Number(row.claimed_at?.version ?? row.action.version)
    const event_idx = Number(row.claimed_at?.event_idx ?? row.action.event_idx)
    if (
      ends.some(
        (end) =>
          end.key === target && (end.version > version || (end.version === version && end.event_idx >= event_idx))
      )
    )
      rows.delete(key)
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.claimed_at?.version ?? a.action.version) - Number(b.claimed_at?.version ?? b.action.version) ||
      Number(a.claimed_at?.event_idx ?? a.action.event_idx) - Number(b.claimed_at?.event_idx ?? b.action.event_idx) ||
      a.key.localeCompare(b.key)
  )
}

const merge_budget_predictions = (current, incoming) => {
  const rows = new Map((current ?? []).map((row) => [row.key, row]))
  for (const row of incoming ?? []) rows.set(row.key, row)
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.action.version) - Number(b.action.version) ||
      Number(a.action.event_idx) - Number(b.action.event_idx) ||
      a.key.localeCompare(b.key)
  )
}

export const retain_budget_predictions = (rows, reconcile) => {
  if (!reconcile) return rows
  return (rows ?? []).filter(({ action }) => {
    const retired_key = reconcile.retire.has(`${action.version}:${action.event_idx}`)
    const retired_intent = action.intent_id != null && reconcile.retired_intents.has(action.intent_id)
    return !retired_key && !retired_intent
  })
}

const preceding_action = (entries, actions) => {
  const first = actions?.[0]
  if (first?.event_idx == null) return null
  return (
    Object.values(entries ?? {}).find(
      (entry) => entry.source !== 'intent' && Number(entry.event_idx) === Number(first.event_idx) - 1
    ) ?? null
  )
}

/** Match authoritative actions against pending predictions without depending on their transport. */
export const claim_predictions = (state, authoritative, now) => {
  const pending = Object.values(state.entries).filter((entry) => entry.source === 'intent')
  const seen = new Set(pending.map(prediction_identity))
  for (const { action } of state.budget_predictions ?? []) {
    const key = prediction_identity(action)
    if (!seen.has(key)) {
      pending.push(action)
      seen.add(key)
    }
  }
  pending.sort((a, b) => Number(a.version) - Number(b.version) || Number(a.event_idx) - Number(b.event_idx))
  if (!pending.length || !authoritative?.length) return null
  const oldest = Math.min(...pending.map((entry) => Number(entry.version)))
  const actions = authoritative.filter((action) => Number(action.version) >= oldest)
  if (!actions.length) return null
  const ceiling = Math.max(...actions.map((action) => Number(action.version)))
  const eligible = pending.filter((entry) => Number(entry.version) <= ceiling)
  if (!eligible.length) return null
  const my_actor = actor_from_key(state.my_key)
  const ended_my_turn =
    !!my_actor &&
    actions.some(
      (action) =>
        action.kind === 'TurnEnded' &&
        !!action.is_mob === !!my_actor.is_mob &&
        Number(action.idx) === Number(my_actor.idx)
    )
  return {
    ended_my_turn,
    result: reconcile_predictions(eligible, actions, {
      version: ceiling,
      at: now,
      ended_my_turn,
      preceding: preceding_action(state.entries, actions),
    }),
  }
}

/** Reduce one local intent. The function is pure; store.js remains the sole state-write door. */
export const reduce_intent = (state, msg, now) => {
  if (msg.intent?.kind === 'end_turn' && state.turn_started_at != null) {
    const ready_at = state.turn_started_at + PLAYER_TURN_FLOOR_MS
    const deadline = Number(state.turn_deadline_ms ?? 0)
    if (now < ready_at && !(deadline > 0 && deadline - now <= PLAYER_TURN_FLOOR_MS))
      return { ...state, pending_end_turn: { ready_at, intent: msg } }
  }

  const action = with_move_budget_delta(
    state,
    normalize_intent(msg.intent, {
      version: msg.version ?? Math.max(1, state.applied_version + 1),
      event_idx: msg.event_idx ?? state.intent_seq,
      actor: actor_from_key(state.my_key),
      resolve_seat: msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view),
    })
  )
  const beats = Array.isArray(msg.beats) ? msg.beats : []
  const walk_window = action.kind === 'Moved' ? { from_idx: action.event_idx, until_idx: action.event_idx } : {}
  const wave = beats.length
    ? [
        ...state.wave,
        {
          seq: state.wave_seq + 1,
          version: action.version,
          final: false,
          source_id: state.ctx?.my_entity_id ?? state.my_key,
          is_local: true,
          duration: beats.reduce((sum, beat) => sum + (beat.duration || 0), 0),
          beats,
          ...walk_window,
        },
      ]
    : state.wave
  const budget_predictions =
    action.kind === 'Moved' && action.mp_left != null
      ? merge_budget_predictions(state.budget_predictions, [{ key: prediction_identity(action), action }])
      : state.budget_predictions

  return recompute(
    {
      ...state,
      entries: merge_entries(state.entries, [action]),
      budget_predictions,
      intent_seq: state.intent_seq + 1,
      staged: action.kind === 'TurnEnded' ? [] : state.staged,
      pending_end_turn: null,
      armed_spell_id: action.kind === 'Cast' ? null : state.armed_spell_id,
      wave,
      wave_seq: wave.length ? wave[wave.length - 1].seq : state.wave_seq,
    },
    now
  )
}

/** Reduce one composite cast prediction atomically. */
export const reduce_predicted = (state, msg, now) => {
  const base_version = Math.max(1, Number(msg.basis_version ?? state.applied_version + 1))
  const actor = actor_from_key(state.my_key)
  const resolve_seat = msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view)
  let projected = presented_state(state)
  const actions = (msg.actions ?? []).map((raw, index) => {
    const action = normalize_intent(raw, {
      version: raw.version ?? base_version,
      event_idx: raw.event_idx ?? state.intent_seq + index,
      actor,
      resolve_seat,
    })
    let tagged = msg.intent_id != null ? { ...action, intent_id: msg.intent_id } : action
    if (tagged.kind === 'Cast' && tagged.target_cell != null) {
      const caster = actor_key(tagged.caster_is_mob, tagged.caster_idx)
      const caster_cell = projected.fighters?.[caster]?.cell
      if (caster_cell != null && Number(tagged.target_cell) === Number(caster_cell))
        tagged = { ...tagged, self_targeted: true }
    }
    projected = apply_action(projected, tagged)
    return tagged
  })
  const grant_intents = new Set(
    actions.filter((action) => action.kind === 'Granted' && action.intent_id != null).map((action) => action.intent_id)
  )
  const predicted_budget = actions
    .filter((action) => grant_intents.has(action.intent_id) && (action.kind === 'Cast' || action.kind === 'Granted'))
    .map((action) => ({ key: prediction_identity(action), action }))
  const beats = Array.isArray(msg.beats) ? msg.beats : []
  const displaced_idxs = actions
    .filter((action) => action.kind === 'Displaced' && action.effect_kind !== DISPLACE_TELEPORT)
    .map((action) => action.event_idx)
  const window = displaced_idxs.length
    ? { from_idx: Math.min(...displaced_idxs), until_idx: Math.max(...displaced_idxs) }
    : {}
  const wave = beats.length
    ? [
        ...state.wave,
        {
          seq: state.wave_seq + 1,
          version: base_version,
          final: false,
          source_id: state.ctx?.my_entity_id ?? state.my_key,
          is_local: true,
          duration: beats.reduce((sum, beat) => sum + (beat.duration || 0), 0),
          beats,
          ...window,
        },
      ]
    : state.wave

  const place_traps = Array.isArray(msg.place_traps) ? msg.place_traps : []
  const trap_cells = [
    ...new Set(
      place_traps
        .map((entry) => (entry != null && typeof entry === 'object' ? entry.cell : entry))
        .map(Number)
        .filter(Number.isFinite)
    ),
  ]
  const trap_payload =
    place_traps
      .map((entry) => (entry != null && typeof entry === 'object' ? entry.payload : null))
      .find((payload) => payload?.length) ?? []
  const trap_cell_set = new Set(trap_cells)
  const placement_cast = [...actions]
    .reverse()
    .find((action) => action.kind === 'Cast' && trap_cell_set.has(Number(action.target_cell)))
  const anchor_value = Number(msg.trap_anchor ?? placement_cast?.target_cell)
  const anchor = Number.isFinite(anchor_value) ? anchor_value : null
  const placed_at_input = msg.placed_at ?? placement_cast
  const placed_at = {
    version: Number(placed_at_input?.version ?? base_version),
    event_idx: Number(placed_at_input?.event_idx ?? Number.MAX_SAFE_INTEGER),
  }
  const my_traps = trap_cells.length
    ? [
        ...state.my_traps,
        {
          draft_id: msg.intent_id ?? null,
          basis_version: base_version,
          cells: trap_cells,
          gone: false,
          payload: trap_payload,
          anchor,
          placed_at,
        },
      ]
    : state.my_traps

  const place_glyphs = Array.isArray(msg.place_glyphs) ? msg.place_glyphs : []
  const my_glyphs = place_glyphs.length
    ? [
        ...state.my_glyphs,
        ...place_glyphs.map((glyph) => ({
          draft_id: msg.intent_id ?? null,
          cells: Array.isArray(glyph?.cells) ? glyph.cells : [],
          turns_remaining: Number(glyph?.turns ?? glyph?.turns_remaining ?? 1),
          gone: false,
        })),
      ]
    : state.my_glyphs

  return recompute(
    {
      ...state,
      entries: merge_entries(state.entries, actions),
      budget_predictions: merge_budget_predictions(state.budget_predictions, predicted_budget),
      intent_seq: state.intent_seq + actions.length,
      pending_end_turn: null,
      armed_spell_id: actions.some((action) => action.kind === 'Cast') ? null : state.armed_spell_id,
      wave,
      wave_seq: wave.length ? wave[wave.length - 1].seq : state.wave_seq,
      my_traps,
      my_glyphs,
    },
    now
  )
}
