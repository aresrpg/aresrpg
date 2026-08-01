// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/inputs.js — the ONE reducer for ALL fight contexts (world / dungeon / kolizeum).
//
// A classic tactical fight is an ordered action log; `state = fold(log)`; every view is a projection of it and
// nothing else is state (FIGHT_REWRITE_DESIGN §2). This module owns the pure action vocabulary:
// `normalize_intent`, `apply_action`, and `fold_log`. Raw receipt/journal/snapshot decoding lives only in
// core_inbox.js. There are NO viewer-context branches here.
//
// Chain events are the authoritative log entries (move/engine/sources/fight_events.move). The client NEVER
// re-guesses them by snapshot-diffing (the dead mess) — core_inbox decodes the exact ordered events once and this
// fold applies each event's declared delta. `@aresrpg/sim` is the PREDICTION source for my own intents; its events
// feed the SAME action vocabulary, so there is one fold and one home for canonical fight state.

import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'
import * as FX from '@aresrpg/sim/spell_effect'

import { fight_status_of } from './board_state.js'
import { INVISIBILITY_STATUS_KIND, MOB_FIGHTER_ID_BASE, decode_status_value } from './fight_status_snapshot.js'
import { decode, encode } from './los.js'
import { is_status_kind } from './statuses.js'

export const ACTION_EFFECT_EVENT = 'ActionEffect'

// ActionEffect is the only receipt row carrying the exact timed status descriptor. What makes a row foldable is
// the RECIPIENT PROOF below (a guaranteed point effect on the caster's own cell), not its kind: `cast.move`'s
// `record_timed` copies the envelope's Effect VERBATIM into the board for every kind that reaches it, so the
// client can restate exactly that row. The old three-kind allowlist (GIVE_POINTS · ALTER_STAT · INVISIBILITY)
// made a self-cast `Reflects 3% · 3 turns` fold nothing at all (#1049) — the kind was simply missing from a list.
// `is_status_kind` (statuses.js) is now the ONE membership test, minus the rows the envelope CANNOT prove:
//   · REMOVE_POINTS (7) / STEAL_POINTS (8) — `cast.move::resolve_drain` is DODGE-CONTESTED: the row exists only
//     if `removed > 0`, a number the envelope does not carry (the drain's own `Drain` event does).
//   · STEAL_STAT (10) — `apply_steal_stat` splits one authored line into two DERIVED rows, never this one.
//   · TIMED_PAYLOAD (34) / NAMED_DAMAGE_STACK (35) / STANCE (36) — `schedule_payload`, `record_named_stack` and
//     `retro_effects::apply_stance` each write their OWN derived record; the envelope's row is never the row.
// Chance-gated effects and rows aimed away from the caster fail the recipient proof and remain snapshot truth.
/** Status kinds whose chain arm does NOT record the envelope's Effect verbatim — contested, or derived. */
const DERIVED_STATUS_KINDS = new Set([
  FX.K_REMOVE_POINTS,
  FX.K_STEAL_POINTS,
  FX.K_STEAL_STAT,
  FX.K_TIMED_PAYLOAD,
  FX.K_NAMED_DAMAGE_STACK,
  FX.K_STANCE,
])
/** A GIVE/REMOVE_POINTS row's `stat` is the chain POINT id (`spell_effect` POINT_AP/POINT_MP) — the pool it moves. */
const POINT_POOL = { [FX.POINT_AP]: 'ap', [FX.POINT_MP]: 'mp' }

/** Canonical fighter key. idx-keyed events (turn/cast/hit/move/displace) all resolve here; `character`-keyed
 *  `Moved` uses the injected seat resolver (roster, S2) or falls back to a `c:<addr>` key until the alias lands. */
export const fighter_key = ({ is_mob, idx, character, resolve_seat }) => {
  if (character != null) {
    const seat = resolve_seat ? resolve_seat(character) : null
    if (seat == null) return `c:${character}`
    return `p${seat}`
  }
  return `${is_mob ? 'm' : 'p'}${Number(idx)}`
}

const empty_fighter = (key) => ({
  key,
  is_mob: key.startsWith('m'),
  cell: null,
  hp: null,
  ap: null, // turn-start budget: null until a TurnStarted predicts the begin_turn refill; project.js falls back to the snapshot
  mp: null,
  turn_number: 0,
  alive: true,
  invisible: false,
})

/** The committed fight state — the ONLY thing the parity hash and every projection read. Plain data. */
export const empty_state = (fight_id = null) => ({
  fight_id,
  phase: 'active',
  fighters: {},
  active: null,
  // Chain-owned turn identity. A positive TurnStarted deadline is shared verbatim by the event and Fight object;
  // zero-deadline turns fall back to the event coordinate. Never incremented from local receipt order.
  turn_ordinal: null,
  turn_deadline_ms: null,
  // The CHAIN turn-seed inputs (fight.move::turn_seed), stamped ONLY by a folded TurnStarted (they are a Move
  // dynamic field the decoded Fight object never carries). A nested pair so the two are atomically present-or-null
  // and never collide with the `turn_ordinal` ANCHOR token above — a different fact under a colliding name. Kept
  // in their decoded u64 form (BigInt/decimal string), never narrowed through Number before the 32-bit mix.
  turn_seed_inputs: null,
  // Provenance bit folded with the current turn. The numeric clock may be held monotonically by store.js across
  // a torn read, but only a positive deadline observed on THIS folded TurnStarted/snapshot may drive an action.
  turn_deadline_fresh: false,
  winner: -1,
  action_contexts: {},
  // The authored half of the drain currently resolving — see `drain_descriptor`. Null between actions.
  pending_drain: null,
})

const terminal_source_priority = { receipt: 1, poll: 1, p2p: 1, snapshot: 2, settlement_snapshot: 3 }

export const empty_settlement = () => ({ chain_terminal: null, attempt: null })

export const pending_settlement = (value) =>
  value?.chain_terminal && !['opened', 'executed_failure'].includes(value.attempt?.verdict) ? value : empty_settlement()

export const is_settlement_input = (type) =>
  ['terminal_confirmation', 'settlement_attempt', 'settlement_outcome', 'settlement_request_consumed'].includes(type)

/** Extract terminal chain truth without consulting optimistic intents. */
export const chain_confirmation = ({ actions = [], fight = null, phase = null, source, version, last_room = true }) => {
  const terminal_action = actions.reduce(
    (found, action) => (action.kind === 'Victory' || action.kind === 'Defeat' ? action : found),
    null
  )
  const action_phase = terminal_action?.kind === 'Victory' ? 'victory' : terminal_action ? 'defeat' : null
  // The ONE lifecycle read (#1277): a record with no status yields null and claims NOTHING — never a defaulted
  // scalar that a `Number()` coercion could turn into a terminal phase.
  const fight_status = fight_status_of(fight)
  const fight_phase =
    fight_status === 3 ? 'defeat' : fight_status != null && fight_status !== 0 && fight_status !== 1 ? 'victory' : null
  const terminal_phase = phase ?? action_phase ?? fight_phase
  if (terminal_phase !== 'victory' && terminal_phase !== 'defeat') return null
  return {
    type: 'terminal_confirmation',
    phase: terminal_phase,
    last_room: terminal_phase === 'defeat' || !!last_room,
    source,
    version: Number(version ?? 0),
  }
}

/** Pure settlement request machine: one attempt per newer confirmation; executed failures latch forever. */
export const reduce_settlement = (value, msg) => {
  const state = value ?? empty_settlement()
  if (msg.type === 'terminal_confirmation') {
    const priority = terminal_source_priority[msg.source] ?? 0
    const signal = `${Number(msg.version ?? 0)}:${priority}:${msg.phase}`
    const current = state.chain_terminal
    if (
      current &&
      (Number(msg.version ?? 0) < current.version ||
        (Number(msg.version ?? 0) === current.version && priority <= current.priority))
    )
      return state
    return {
      ...state,
      chain_terminal: {
        phase: msg.phase,
        last_room: !!msg.last_room,
        source: msg.source,
        version: Number(msg.version ?? 0),
        priority,
        signal,
      },
    }
  }
  if (msg.type === 'settlement_attempt') {
    const terminal = state.chain_terminal
    const retryable = !state.attempt || (state.attempt.verdict === 'transient' && state.attempt.signal !== msg.signal)
    return terminal?.signal === msg.signal && retryable
      ? { ...state, attempt: { signal: msg.signal, verdict: 'inflight' } }
      : state
  }
  if (msg.type === 'settlement_request_consumed') {
    const terminal = state.chain_terminal
    return terminal?.signal === msg.signal && !terminal.consumed
      ? { ...state, chain_terminal: { ...terminal, consumed: true } }
      : state
  }
  if (msg.type === 'settlement_outcome') {
    if (state.attempt?.signal !== msg.signal || state.attempt.verdict !== 'inflight') return state
    const verdict = ['opened', 'transient', 'executed_failure'].includes(msg.verdict) ? msg.verdict : 'executed_failure'
    return { ...state, attempt: { signal: msg.signal, verdict } }
  }
  return state
}

/** Reconcile chain terminal evidence already present in the snapshot + authoritative event tail. */
export const reconcile_settlement = (value, base, log = [], draft = {}) => {
  const terminal = log.reduce(
    (found, action) => (action.kind === 'Victory' || action.kind === 'Defeat' ? action : found),
    null
  )
  const phase = terminal?.kind === 'Victory' ? 'victory' : terminal?.kind === 'Defeat' ? 'defeat' : base?.phase
  if (phase !== 'victory' && phase !== 'defeat') return value
  const ctx = draft.ctx ?? {}
  const last_room = !(ctx.run && Number(ctx.rooms_total) > 0 && Number(ctx.run.room ?? 1) < Number(ctx.rooms_total))
  const confirmation = chain_confirmation({
    phase,
    source: terminal?.source ?? 'snapshot',
    version: terminal?.version ?? draft.core?.inbox?.base_version ?? -1,
    last_room,
  })
  return reduce_settlement(value, confirmation)
}

const ensure = (state, key) =>
  state.fighters[key] ? state : { ...state, fighters: { ...state.fighters, [key]: empty_fighter(key) } }

const positive_deadline = (value) => {
  const deadline = Number(value)
  return deadline > 0 ? deadline : null
}

const action_context_key = (action) =>
  `${action.caster_is_mob ? 'm' : 'p'}${Number(action.caster_idx)}:${String(action.turn_ordinal)}:${String(
    action.action_ordinal
  )}`

const fields_of = (value) => value?.fields ?? value ?? {}

/** Is the CASTER's own cell inside the effect's zone? The chain's own recipient test, restated (#1172): every
 * effect is applied to the fighters standing in `combat_grid::zone_cells(shape, size, target_cell, caster_cell)`
 * (cast.move:987 → `zone.contains(&pcell)`), and `get_aoe_cells` is the sim twin of that enumeration — the same
 * function the targeting overlay already paints the zone with. A POINT zone is the ONE-CELL case, so this single
 * question replaces the old point-only triple (`shape == POINT && size == 0 && target_cell == caster.cell`) that
 * made every AoE self-buff unprovable. A shape the sim does not enumerate collapses to `[target]` — conservative
 * by construction: the row simply stays snapshot truth rather than being invented. */
const zone_hits_caster = (effect, target_cell, caster_cell) =>
  get_aoe_cells(
    { area_shape: Number(effect.area_shape) || 0, area_size: Number(effect.area_size) || 0 },
    decode(target_cell),
    decode(caster_cell)
  ).some((cell) => encode(cell.x, cell.y) === caster_cell)

/** A guaranteed effect whose zone covers the caster is the one action-envelope shape that proves its exact
 * recipient and status row without replaying spell resolution. ActionStarted supplies the missing target cell;
 * both rows use the stable caster/turn/action key, so a page boundary is harmless when the retained log re-folds.
 *
 * THE SECOND WIRE DOOR (#983). `ActionEffect.effect` is the chain `Effect` struct VERBATIM (cast.move record_timed
 * copies it), so a signed kind arrives 32768-CENTERED exactly like the snapshot's Fight.fx row — and lands in the
 * SAME per-fighter status home. Writing it raw made the two doors speak two dialects: an authored `+1 Range` chip
 * read `32769` while every signed reader (statuses.sim_effects_of → range_bonus_of, the effect badges) was 32768
 * off. `decode_status_value` is the ONE decoder for both doors; downstream speaks signed and never sees 32768. */
const self_status_from_effect = (state, action) => {
  const context = state.action_contexts?.[action_context_key(action)]
  const key = fighter_key({ is_mob: action.caster_is_mob, idx: action.caster_idx })
  const caster = state.fighters[key]
  const effect = fields_of(action.effect)
  const kind = Number(effect.kind)
  const target_filter = Number(effect.target_filter) || 0
  const hits_caster =
    (target_filter & FX.TF_ONLY_CASTER) === FX.TF_ONLY_CASTER ||
    ((target_filter & FX.TF_NOT_SELF) === 0 && (target_filter & FX.TF_NOT_TEAM) === 0)
  const remaining_turns = Number(effect.turns) || 0
  if (
    !context ||
    caster?.cell == null ||
    !zone_hits_caster(effect, Number(context.target_cell), Number(caster.cell)) ||
    Number(effect.chance) < 100 ||
    remaining_turns <= 0 ||
    !hits_caster ||
    !is_status_kind(kind) ||
    DERIVED_STATUS_KINDS.has(kind)
  )
    return null
  return {
    key,
    status: {
      kind,
      remaining_turns,
      element: effect.element == null ? null : Number(effect.element),
      value: effect.value == null ? null : decode_status_value(kind, Number(effect.value)),
      stat: effect.stat == null ? null : Number(effect.stat),
      chance: effect.chance == null ? null : Number(effect.chance),
      // A self-landing row's SOURCE is the caster — the chain's own `fid_of(caster_side, caster_idx)`
      // (cast.move) restated, so the one projection states attribution from this door too.
      source: (action.caster_is_mob ? MOB_FIGHTER_ID_BASE : 0) + Number(action.caster_idx),
      flags: effect.flags == null ? null : Number(effect.flags),
    },
  }
}

const patch_fighter = (state, key, delta) => {
  const base = ensure(state, key)
  return { ...base, fighters: { ...base.fighters, [key]: { ...base.fighters[key], ...delta } } }
}

/** Append ONE timed row to a fighter's status home and re-derive `invisible` from the survivors — the single
 *  shape every mint door (authoritative envelope, optimistic prediction, the drain join) writes through. */
const append_status_row = (state, key, status) => {
  const base = ensure(state, key)
  const statuses = [...(base.fighters[key].statuses ?? []), status]
  return patch_fighter(base, key, {
    statuses,
    invisible: statuses.some((row) => row.kind === INVISIBILITY_STATUS_KIND),
  })
}

/** THE DRAIN JOIN, authored half. A point removal is the one timed row whose VALUE the envelope cannot state:
 *  `cast::resolve_drain` is dodge-contested, so the row exists only for the count it actually removed — which is
 *  why REMOVE_POINTS/STEAL_POINTS sit in `DERIVED_STATUS_KINDS` above. The chain still records that row next to
 *  the pool shave (`spell_board::add_status(.., spell_effect::drain_row(point_kind, removed, dur))`), and the
 *  client needs it: `pool_grant` reads it as the next refill's DEBT and `project_views.effects_of` renders it as
 *  the turn-card chip. So the two halves are joined here — the authored duration off this ActionEffect, the
 *  contested count off the `Drain` event that follows it. The join is positional and exactly as tight as the
 *  chain's own emission order: `emit_effect` fires immediately before `apply_effect` for that ordinal
 *  (cast.move:250/620), and every `emit_drain` the effect produces — one per target for an AoE — happens inside
 *  it, before the next ordinal's ActionEffect. A non-drain ordinal clears the descriptor, so a stale one can
 *  never be read by a later event. */
const drain_descriptor = (action) => {
  const effect = fields_of(action.effect)
  const kind = Number(effect.kind)
  if (kind !== FX.K_REMOVE_POINTS && kind !== FX.K_STEAL_POINTS) return null
  return {
    // `resolve_drain` floors the duration at 1 — a removal always denies the next turn.
    remaining_turns: Math.max(1, Number(effect.turns) || 0),
    source: (action.caster_is_mob ? MOB_FIGHTER_ID_BASE : 0) + Number(action.caster_idx),
  }
}

/** Move decrements every fighter row at that fighter's turn end. Rows survive with one fewer turn or disappear at
 * one; invisibility is always re-derived from the surviving rows. A legacy boolean-only fold has no duration proof,
 * so leave it untouched until its explicit StanceChanged/Revealed event. */
const decrement_statuses = (state, key) => {
  const rows = state.fighters[key]?.statuses
  if (!rows) return state
  const statuses = rows.flatMap((row) => {
    const remaining_turns = Number(row.remaining_turns) || 0
    return remaining_turns > 1 ? [{ ...row, remaining_turns: remaining_turns - 1 }] : []
  })
  return patch_fighter(state, key, {
    statuses,
    invisible: statuses.some((row) => row.kind === INVISIBILITY_STATUS_KIND),
  })
}

/** The pool a fighter's ACTIVE timed point rows move the turn-start refill by — the client twin of the chain's ONE
 * refill law (`participant::net_refill`, `base + credit − debt` floored at 0, called from `begin_turn`) and of
 * `sim/fight_state.active_pool_modifier`: a `+1 MP · 3 turns` buff refills to base+1 for every turn inside its
 * window, a REMOVE_POINTS row subtracts (summing both into one signed net is the same floor the chain takes).
 * Duration needs no predicate of its own here — a row only reaches a TurnStarted if it survived the PRIOR
 * turn-end `decrement_statuses`, which is exactly the chain's tick scope (cast.move:1585 ages the ENDING actor's
 * rows), so presence IS activity. Kinds other than the two point ones never touch a pool: an ALTER_STAT row moves
 * a STAT, and the snapshot owns those.
 * @param {Array<{kind?:number, stat?:number, value?:number, remaining_turns?:number}>} statuses
 * @param {'ap'|'mp'} pool
 */
const pool_grant = (statuses, pool) =>
  (statuses ?? []).reduce((sum, row) => {
    if (POINT_POOL[Number(row?.stat)] !== pool || (Number(row?.remaining_turns) || 0) <= 0) return sum
    const kind = Number(row?.kind)
    const value = Number(row?.value) || 0
    if (kind === FX.K_GIVE_POINTS) return sum + value
    return kind === FX.K_REMOVE_POINTS ? sum - value : sum
  }, 0)

/** Apply an MP delta without discarding temporary debt below zero. The visible pool stays clamped, but a later
 * undo/refund composes with the raw balance if an earlier speculative grant disappears during a re-fold. Ordinary
 * chain deltas only start tracking when a Moved prediction already did (or `track` explicitly requests it). */
const patch_mp_delta = (state, key, delta, track = false) => {
  const base = ensure(state, key)
  const fighter = base.fighters[key]
  if (fighter.mp == null) return state
  const tracked = fighter.mp_unclamped != null
  const value = Number(tracked ? fighter.mp_unclamped : fighter.mp) + (Number(delta) || 0)
  return patch_fighter(base, key, {
    mp: Math.max(0, Math.floor(value)),
    ...(track || tracked ? { mp_unclamped: value } : {}),
  })
}

// REVEAL — clear invisibility the SAME way the sim's `statuses::reveal` does: strip every kind-27 status ROW, the
// ONE source both the effect badge (engine_view.effects) and the derived `invisible` read. Flipping only the
// boolean left the invisibility BADGE lingering on a revealed fighter (#13 — a second-channel divergence from the
// one-home law). A fighter carrying no rows just clears the flag (empty_fighter, pre-status folds) — no regression.
const reveal_fighter = (state, key) => {
  const f = ensure(state, key).fighters[key]
  const rows = f.statuses ?? []
  const kept = rows.filter((row) => row.kind !== INVISIBILITY_STATUS_KIND)
  return patch_fighter(state, key, { invisible: false, ...(kept.length !== rows.length ? { statuses: kept } : {}) })
}

/**
 * Fold ONE action into the committed state. Pure: `apply_action(state, action)` is byte-deterministic. Every
 * arm mirrors a `fight_events.move` struct; `Displaced`/`Hit`/`Moved` set the AUTHORITATIVE post-event value
 * (never a re-simulated guess). Invisibility: a DAMAGING `Cast` reveals its caster with NO chain event —
 * `aresrpg_spells::statuses::reveal` fires inside cast resolution (cast.move:164/291/372/414), so the reducer
 * mirrors it here (optimistic on my own cast; applied from the receipt for peers — the chain emits no StanceChanged).
 * @param {ReturnType<typeof empty_state>} state
 * @param {Record<string, any>} action
 */
export const apply_action = (state, action) => {
  const rs = action.resolve_seat
  switch (action.kind) {
    case 'ActionStarted': {
      const key = action_context_key(action)
      return {
        ...state,
        pending_drain: null,
        action_contexts: {
          ...state.action_contexts,
          [key]: { target_cell: action.target_cell },
        },
      }
    }
    case ACTION_EFFECT_EVENT: {
      // The authored half of a drain rides THIS row; every other kind clears the descriptor (see the join's doc).
      const carried = { ...state, pending_drain: drain_descriptor(action) }
      const applied = self_status_from_effect(carried, action)
      return applied ? append_status_row(carried, applied.key, applied.status) : carried
    }
    case 'StatusAdded': {
      // Prediction-only twin of the authoritative ActionEffect arm. predict_cast has already run deterministic
      // resolution and supplies the exact recipient; the matching Cast receipt retires this whole optimistic batch
      // before its authoritative ActionEffect is re-folded, so the row never double-applies.
      if (!action.status || Number(action.status.remaining_turns) <= 0) return state
      const key = fighter_key({ is_mob: action.target_is_mob, idx: action.target_idx, resolve_seat: rs })
      return append_status_row(state, key, action.status)
    }
    case 'ActionResolved': {
      const key = action_context_key(action)
      const closed = state.pending_drain ? { ...state, pending_drain: null } : state
      if (!closed.action_contexts?.[key]) return closed
      const action_contexts = { ...closed.action_contexts }
      delete action_contexts[key]
      return { ...closed, action_contexts }
    }
    case 'TurnStarted': {
      const key = fighter_key({ is_mob: action.is_mob, idx: action.idx, resolve_seat: rs })
      const next = ensure(state, key)
      const turn_number = Number(next.fighters[key].turn_number ?? 0) + 1
      const observed_deadline = positive_deadline(action.deadline_ms)
      const withturn = {
        ...next,
        active: key,
        turn_ordinal:
          observed_deadline != null
            ? String(observed_deadline)
            : `${Number(action.version ?? 0)}:${Number(action.event_idx ?? 0)}`,
        turn_deadline_ms: observed_deadline,
        turn_deadline_fresh: observed_deadline != null,
        // The authoritative turn-seed boundary. Both inputs travel on THIS wire (fight_events.move) as decoded
        // u64 (BigInt/string) — kept verbatim, never narrowed. An older/partial TurnStarted that omits either
        // must CLEAR the seed (null) rather than reuse the preceding turn's entropy — a stale seed previews the
        // wrong roll; a null one previews nothing (the honest refusal `crit_clock_of` already enforces).
        turn_seed_inputs:
          action.turn_entropy != null && action.turn_ordinal != null
            ? { turn_entropy: action.turn_entropy, turn_ordinal: action.turn_ordinal }
            : null,
      }
      // CLIENT-INDEPENDENCE turn-start budget: the TurnStarted event carries NO ap/mp (fight_events.move:24), so
      // predict the deterministic begin_turn refill — base_ap/base_mp injected at the normalize door below. Without
      // it the projected budget stays the stale pre-refill snapshot (0) → a live turn with a dead move/cast range
      // (the v1.12.28 dead opening click). The snapshot reconciles for FREE: a post-refill object read prunes this
      // overlay entry, `f.ap/mp` go null, and project.js falls back to the authoritative row.ap/mp (drained-safe).
      //
      // THE POOL A TIMED GRANT REFILLS TO (#973, driven round 2). `base_ap`/`base_mp` are the seat's IMMUTABLE
      // snapshot pools, so a `+1 MP · 3 turns` buff was granted once and then ROLLED BACK by the very next
      // TurnStarted — the pool the player watched revert while the chip still counted down. The refill target is
      // base + the fighter's ACTIVE point rows, exactly as `effective_mp_max` computes it sim-side and
      // `participant::net_refill` on chain; the rows are already in this fold's status home.
      const grant = (base, pool) =>
        base == null ? base : Math.max(0, Number(base) + pool_grant(withturn.fighters[key].statuses, pool))
      return action.ap == null && action.mp == null
        ? patch_fighter(withturn, key, { turn_number, mp_unclamped: null })
        : patch_fighter(withturn, key, {
            turn_number,
            ap: grant(action.ap, 'ap'),
            mp: grant(action.mp, 'mp'),
            mp_unclamped: null,
          })
    }
    case 'TurnEnded': {
      const key = fighter_key({ is_mob: action.is_mob, idx: action.idx, resolve_seat: rs })
      const ended = state.active === key ? { ...state, active: null, turn_deadline_fresh: false } : state
      return decrement_statuses(ended, key)
    }
    case 'MobMoved':
      return patch_fighter(state, fighter_key({ is_mob: true, idx: action.idx }), { cell: action.to_cell })
    case 'Moved': {
      const key = fighter_key({ character: action.character, resolve_seat: rs })
      const moved = patch_fighter(state, key, { cell: action.to_cell })
      // AP-PAINT TRUTH twin (MP): only MY optimistic intent carries budget evidence (chain Moved events never do).
      // The store derives this row's signed mp_delta from the board's absolute whole-draft mp_left, so an append
      // spends and an undo refunds, while either still rebases if an earlier speculative grant disappears. Direct
      // legacy folds without that derivation retain the absolute fallback.
      if (action.mp_delta != null) return patch_mp_delta(moved, key, action.mp_delta, true)
      return action.mp_left != null ? patch_fighter(moved, key, { mp: action.mp_left, mp_unclamped: null }) : moved
    }
    case 'Placed':
      // Placement commit (turns.move: participant::set_cell + emit Placed{character, cell}, fight_events.move:22).
      // The AUTHORITATIVE placed cell — character-keyed, so it consumes resolve_seat exactly like Moved. Without
      // this case the event was silently DROPPED (Ready only sets ready:true), so me.cell never reflected the
      // placed cell — the v1.12.28-class dropped fold flagged at DungeonBoard.jsx:897-898.
      return patch_fighter(state, fighter_key({ character: action.character, resolve_seat: rs }), {
        cell: action.cell,
      })
    case 'Displaced':
      return patch_fighter(
        state,
        fighter_key({ is_mob: action.target_is_mob, idx: action.target_idx, resolve_seat: rs }),
        { cell: action.to_cell }
      )
    case 'Cast': {
      const key = fighter_key({ is_mob: action.caster_is_mob, idx: action.caster_idx, resolve_seat: rs })
      const next = ensure(state, key)
      // AP-PAINT TRUTH: MY optimistic cast intent carries
      // ap_cost — debit the projected budget in the SAME fold every HUD surface reads. Receipt/poll Cast events
      // carry no ap_cost (the chain debits server-side; the object read reconciles row.ap), so this arm only
      // ever fires for the prediction — purged by the receipt like every intent.
      const ap = next.fighters[key]?.ap
      const spent =
        action.ap_cost != null && ap != null ? patch_fighter(next, key, { ap: Math.max(0, ap - action.ap_cost) }) : next
      // Reveal on a damaging cast — mirror of statuses::reveal (no chain event exists to carry it): strip the
      // invisibility ROW, not just the flag, so the effect badge clears WITH the reveal (#13).
      return action.damaging ? reveal_fighter(spent, key) : spent
    }
    case 'Hit': {
      const key = fighter_key({ is_mob: action.victim_is_mob, idx: action.victim_idx, resolve_seat: rs })
      return patch_fighter(state, key, {
        hp: action.remaining_hp,
        alive: Number(action.remaining_hp) > 0,
      })
    }
    case 'Tackled': {
      // The escape-contest bite (tackle.move resolve → fight_events emit_tackled): the chain emits the DELTAS
      // it stripped from BOTH pools. Adopt them onto the runner's OVERLAY pools only when they exist (the
      // TurnStarted refill seeded them — the Cast ap_cost arm's exact pattern): a delta on a null base would
      // invent a number; absent overlays reconcile through the object read's row.ap/mp instead. u64 fields
      // ride as strings off Sui JSON — coerce here. Entries fold once (version:event_idx), so the delta is
      // idempotent by identity.
      const key = fighter_key({ is_mob: action.runner_is_mob, idx: Number(action.runner_idx) })
      const f = state.fighters[key]
      if (f?.ap == null || f?.mp == null) return state
      const with_ap = patch_fighter(state, key, {
        ap: Math.max(0, Math.floor(f.ap) - (Number(action.ap_lost) || 0)),
      })
      return patch_mp_delta(with_ap, key, -(Number(action.mp_lost) || 0))
    }
    case 'StanceChanged': {
      // Chain shape: StanceChanged{ fighter_is_mob, fighter_idx, stance, active } — the register #13 fix reads
      // fighter_* (the chain names, NOT the obsolete target_*) and maps ONLY the invisibility stance (kind 27) to
      // `invisible` via `active` (on/off); every other stance is a no-op (most reveals ride the damaging-cast rule).
      // BRIDGE B-STANCE (expiry INC-4/P1): the client's optimistic fan-out (DungeonBoard predict_cast) still
      // dispatches the LEGACY { target_is_mob, target_idx, invisible } intent shape. Chain events never carry
      // `invisible`, so the shapes never collide — accept both until predict_cast unifies through spell_effect.js
      // and the .jsx fan-out is deleted, so my-cast optimistic invisibility does not regress in the interim.
      const chain = action.stance != null
      if (chain && Number(action.stance) !== INVISIBILITY_STATUS_KIND) return state
      const invisible = chain ? !!action.active : action.invisible
      if (invisible == null) return state
      const is_mob = chain ? action.fighter_is_mob : action.target_is_mob
      const idx = chain ? action.fighter_idx : action.target_idx
      return patch_fighter(state, fighter_key({ is_mob, idx, resolve_seat: rs }), { invisible: !!invisible })
    }
    case 'Revealed':
      // A fighter is un-hidden (fight_events Revealed{ is_mob, idx } — statuses::reveal's explicit event, distinct
      // from the damaging-cast mirror). Idx-keyed like TurnStarted; strips the invisibility row (badge + flag, #13).
      return reveal_fighter(state, fighter_key({ is_mob: action.is_mob, idx: action.idx }))
    case 'Drain': {
      // A resource drain (fight_events Drain{ target_is_mob, target_idx, point_kind, removed }). point_kind 0 = AP,
      // else MP (mob.move give/drain_points). Adopt onto the OVERLAY pool only when it exists — a delta on a null
      // base would invent a number (the Cast/Tackled pattern); an absent overlay reconciles through the object
      // read's row.ap/mp. u64/u8 fields ride as strings off Sui JSON — coerce here.
      const key = fighter_key({ is_mob: action.target_is_mob, idx: action.target_idx, resolve_seat: rs })
      const removed = Number(action.removed) || 0
      const point_kind = Number(action.point_kind)
      const pool = point_kind === FX.POINT_AP ? 'ap' : 'mp'
      // THE DEBT ROW, the drain's OTHER half (#1168). `resolve_drain` shaves the live pool AND records a timed
      // row `if (removed > 0)` — the client folded only the shave, so the drain vanished from every reader that
      // hangs off `statuses`: the next turn's refill (`pool_grant` → the movement paint) and the turn-card chip
      // (`project_views.effects_of`). Minted here and nowhere else, because this is the only door that carries
      // the contested count; the authored duration comes from the ActionEffect this Drain resolves under.
      const debt =
        removed > 0 && state.pending_drain
          ? append_status_row(state, key, {
              kind: FX.K_REMOVE_POINTS, // the chain's own row kind for BOTH remove and steal (spell_effect::drain_row)
              remaining_turns: state.pending_drain.remaining_turns,
              element: 255,
              value: removed,
              stat: point_kind,
              chance: 100,
              source: state.pending_drain.source,
              flags: 0,
            })
          : state
      // Adopt onto the OVERLAY pool only when it exists — a delta on a null base would invent a number.
      const f = debt.fighters[key]
      if (f?.[pool] == null) return debt
      if (pool === 'mp') return patch_mp_delta(debt, key, -removed)
      return patch_fighter(debt, key, { [pool]: Math.max(0, Math.floor(f[pool]) - removed) })
    }
    case 'Granted': {
      // The SYMMETRIC TWIN of Drain — a resource GRANT (give_points: +n to a pool). point_kind 0 = AP else MP.
      // WHY its own kind, not a signed Drain: the chain's Drain carries `removed: u64`
      // (fight_events.move:128) which can NEVER be negative, so a grant can neither ride it truthfully nor ever
      // ARRIVE as one — the honest name is the only expressible shape. THE ONE HOME both grant doors fold through:
      //  · the PREDICTION (predict_cast.changed_actions emits it on a pool INCREASE), and
      //  · any AUTHORITATIVE grant. Note give_points emits NO chain event (cast.move:997-1001 → participant.move
      //    give_points mutates the pool silently), so the DURABLE chain truth rides base_from_view's already-granted
      //    row.mp — this arm carries the OPTIMISTIC grant so the HUD number + MP blob reflect it the instant it's
      //    cast, before the snapshot round-trips. Overlay-only (a delta on a null base would invent a number — the
      //    Drain/Cast/Tackled pattern); an absent overlay reconciles through row.ap/mp. u64 rides as a string — coerce.
      const key = fighter_key({ is_mob: action.target_is_mob, idx: action.target_idx, resolve_seat: rs })
      const f = state.fighters[key]
      const pool = Number(action.point_kind) === FX.POINT_AP ? 'ap' : 'mp'
      if (f?.[pool] == null) return state
      if (pool === 'mp') return patch_mp_delta(state, key, Number(action.granted) || 0)
      return patch_fighter(state, key, { [pool]: Math.max(0, Math.floor(f[pool]) + (Number(action.granted) || 0)) })
    }
    case 'Abandoned':
      // A seat forfeited the fight (actions::abandon → fight_events Abandoned{ character, seat }) — the character
      // dies through the ordinary liveness write. Seat-keyed (a forfeit is always a player), so no resolver needed.
      return patch_fighter(state, fighter_key({ is_mob: false, idx: Number(action.seat) }), { hp: 0, alive: false })
    case 'CriticalFailure':
      // A fumbled cast (fight_events CriticalFailure{ caster_is_mob, caster_idx }) — the AP was already debited by
      // the Cast and no Hit follows, so there is NO fold delta. Recognized (not dropped) so the render producer's
      // pending-effect ordering stays correct (#27); the object read reconciles the spent AP.
      return state
    case 'Ready': {
      // Placement: a seat placed + readied (turns.move place). Keyed by `character` (the receipt's own seat).
      const key = fighter_key({ character: action.character, resolve_seat: rs })
      return patch_fighter(state, key, { ready: true })
    }
    case 'Victory':
      return { ...state, phase: 'victory', winner: 0, turn_deadline_fresh: false }
    case 'Defeat':
      return { ...state, phase: 'defeat', winner: 1, turn_deadline_fresh: false }
    default:
      return state
  }
}

/** Fold a whole (sorted) action log into committed state. `state = fold(log)` — the design's core identity. */
export const fold_log = (log, fight_id = null) => log.reduce(apply_action, empty_state(fight_id))

/** My fighter identity from my key: `p0` → { is_mob:false, idx:0 }, `m2` → { is_mob:true, idx:2 }. */
export const actor_from_key = (key) =>
  key && (key[0] === 'p' || key[0] === 'm') ? { is_mob: key[0] === 'm', idx: Number(key.slice(1)) } : null

/** D-resolve_seat: character id → its seat INDEX in the view's escrow roster (fighter_key prepends 'p');
 *  null when unresolvable. Every input door defaults its resolve_seat to this — without it, character-keyed
 *  events orphan onto `c:<id>` and the `p<idx>`-reading projection never sees them. */
export const seat_resolver = (view) => (character) => {
  if (character == null) return null
  const idx = (view?.escrow ?? []).findIndex((p) => String(p.character ?? '') === String(character))
  return idx >= 0 ? idx : null
}

/**
 * Normalize a local intent (my click) into ONE canonical chain-event action, so the whole log folds through the
 * single `apply_action` (no second reducer). `end_turn`→TurnEnded, `cast`→Cast, `move`→Moved — all keyed to MY
 * seat (`actor`). A damaging cast carries `damaging:true` so the invisibility reveal fires THIS frame (prediction),
 * before any receipt. `version`/`event_idx` place it deterministically in the ordered log.
 */
export const normalize_intent = (intent, { version, event_idx = 0, actor = null, resolve_seat = null } = {}) => {
  const base = { version, event_idx, source: 'intent', resolve_seat }
  const is_mob = actor?.is_mob ?? false
  const idx = actor?.idx ?? 0
  switch (intent.kind) {
    case 'end_turn':
      return { ...base, kind: 'TurnEnded', is_mob, idx }
    case 'cast':
      return {
        ...base,
        kind: 'Cast',
        caster_is_mob: is_mob,
        caster_idx: idx,
        target_cell: intent.target_cell ?? null,
        damaging: !!intent.damaging,
        // AP-PAINT TRUTH: MY drafted cast carries its cost so the ONE fold debits the
        // projected budget the same tick (chain-parity safe: receipt Cast events never carry it — the object
        // read's row.ap is the authority the purge reconciles to).
        ...(intent.ap_cost != null ? { ap_cost: Number(intent.ap_cost) } : {}),
      }
    case 'move':
      return {
        ...base,
        kind: 'Moved',
        character: intent.character ?? actor?.character ?? null,
        to_cell: intent.to_cell ?? null,
        // the MP twin of ap_cost above — ABSOLUTE remaining MP after the whole draft (the board's own draft
        // math), so an undone step re-raises the projected budget honestly. Chain Moved events never carry it.
        ...(intent.mp_left != null ? { mp_left: Number(intent.mp_left) } : {}),
      }
    default:
      return { ...base, ...intent } // already-canonical action passthrough
  }
}
