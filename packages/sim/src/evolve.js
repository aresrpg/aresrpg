// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EVOLVE — the sim twin's exported canonical-event door (Fight V2 build step 0).
//
// The sim evolves state ONE way today: `reduce(state, command, ctx) -> { state, events }` folds a COMMAND and
// EMITS the observable-delta events (fight_moved / fight_cast / fight_turn_start / …). This module surfaces the
// OTHER direction as a pure, versioned seam the V2 core needs: given the sim's OWN emitted event, evolve the
// PRESENTATION-OBSERVABLE state and hand back the frame facts of that event. It is the leaf-side twin of the
// fight core's chain-event fold (`@aresrpg/fight` inputs.js `apply_action`, which folds the chain's decoded
// journal into committed truth) — SAME relationship as `produce_predicted_render_events` (sim) ↔
// `produce_receipt_render_turns` (chain). It invents no math: every delta it applies is a value the sim event
// ALREADY carries (a hit's `new_health`, a push's `cell`), and where an event does not carry enough to
// reconstruct the observable state that is a FINDING the coherence property surfaces, never a value we fabricate.
//
// PURE: no I/O, no throw. A shape it cannot evolve is returned as DATA (`sim_failure`), never an exception.
//
// SCOPE — the OBSERVABLE state (positions · health · liveness · whose turn · winner): the fields the chain's
// sparse journal can express and the presentation layer consumes. The sim's FULL FightState (rng, decks, hands,
// trap/glyph internals) is NOT reconstructable from a sparse event log by design — the coherence property below
// compares the OBSERVABLE PROJECTION of `reduce`'s result, exactly as the chain fold reconstructs only committed
// truth, not the reducer's private machinery.

import { digest } from './timeline.js'

// The seam version — bumped when the observable shape or the event coverage changes (capsule checkpoints and the
// CI coherence gate pin it, so a silent shape drift becomes a loud version mismatch).
export const EVOLVE_VERSION = 1

/**
 * The presentation-observable state — the twin-shared board both `reduce` (predicted) and the chain fold
 * (authoritative) must agree on, and nothing more. Fighters keyed by their sim id.
 * @typedef {{ id: string, cell: import('./cell.js').Cell | null, health: number, alive: boolean }} ObservableFighter
 * @typedef {{ fighters: Record<string, ObservableFighter>, active_id: string | null, winner: number }} ObservableState
 */

/**
 * One presentation-consumable fact derived from an event (positions walked, damage/heal applied, a death, a turn
 * boundary, the winner). Exactly what the source event already states — no new fact class is invented.
 * @typedef {{ kind: string, id?: string } & Record<string, unknown>} FrameFact
 */

/**
 * A door refusal, as DATA. Returned (never thrown) when an event cannot evolve the observable state.
 * @typedef {{ kind: 'sim_failure', event: Record<string, unknown>, reason: string }} SimFailure
 */

/**
 * @typedef {{ state: ObservableState, frame_facts: FrameFact[] }} EvolveResult
 */

/**
 * Project a full sim `FightState` onto the observable state — the ONLY lossy step, and the same projection the
 * coherence property holds `reduce` to. `active_id` is the turn-SLOT holder (`turn_order[current_turn_idx]`), the
 * exact notion the emitted `fight_turn_start` / `fight_turn_end` events track — NOT the acting-gated
 * `get_current_turn_entity`, which nulls on a dead holder (a terminal self-kill leaves the fight over with its
 * slot still on the fallen fighter, and the event stream emits no turn_end there, so the slot is the coherent read).
 * @param {import('./fight_state.js').FightState} state
 * @returns {ObservableState}
 */
export const project_observable = state => {
  /** @type {Record<string, ObservableFighter>} */
  const fighters = {}
  for (const entity of [...state.team0, ...state.team1])
    fighters[entity.id] = {
      id: entity.id,
      cell: entity.cell,
      health: entity.health,
      alive: entity.health > 0,
    }
  return {
    fighters,
    active_id: state.turn_order[state.current_turn_idx] ?? null,
    winner: state.winner,
  }
}

/** The empty observable state — a fresh fold seed (no fighters, no turn, ongoing). */
export const empty_observable = () => ({
  fighters: {},
  active_id: null,
  winner: -1,
})

// ── Internal fold helpers (pure; every returned value is fresh) ────────────────────

/** Guarantee an observable fighter row exists (an event may name a fighter the seed never listed). */
const ensure_fighter = (state, id) =>
  state.fighters[id]
    ? state
    : {
        ...state,
        fighters: {
          ...state.fighters,
          [id]: { id, cell: null, health: 0, alive: false },
        },
      }

/** Patch one observable fighter with a partial delta, returning a fresh state. */
const patch_fighter = (state, id, delta) => {
  const base = ensure_fighter(state, id)
  return {
    ...base,
    fighters: { ...base.fighters, [id]: { ...base.fighters[id], ...delta } },
  }
}

/**
 * Apply one sim `SpellCastEffect`-shaped row (the shared row of fight_cast / fight_trap_triggered /
 * fight_turn_effects) to the observable state. Only the OBSERVABLE fields the row carries are applied:
 * `new_health` (absolute post-value → health + liveness) and `cell` (a PUSH/PULL/TELEPORT relocation). Status /
 * stat / stance riders are presentation facts, not observable-board fields, so they surface in `frame_facts`
 * only. Returns the next state + the fact rows this effect states.
 * @param {ObservableState} state
 * @param {Record<string, any>} effect
 * @returns {{ state: ObservableState, facts: FrameFact[] }}
 */
const apply_effect_row = (state, effect) => {
  const id = effect.target_id
  if (id == null) return { state, facts: [] }
  /** @type {Record<string, unknown>} */
  let delta = {}
  /** @type {FrameFact[]} */
  const facts = []
  if (effect.new_health != null) {
    const health = Number(effect.new_health)
    delta = { ...delta, health, alive: health > 0 }
    facts.push({
      kind: effect.heal != null ? 'heal' : 'hit',
      id,
      new_health: health,
      ...(effect.damage != null ? { damage: Number(effect.damage) } : {}),
      ...(effect.heal != null ? { heal: Number(effect.heal) } : {}),
      ...(effect.killed ? { killed: true } : {}),
    })
  }
  if (effect.cell != null) {
    delta = { ...delta, cell: effect.cell }
    facts.push({ kind: 'displaced', id, to: effect.cell })
  }
  if (effect.status != null)
    facts.push({ kind: 'status', id, status: effect.status })
  return {
    state: Object.keys(delta).length ? patch_fighter(state, id, delta) : state,
    facts,
  }
}

/** Fold a whole effect array through `apply_effect_row`, threading state and collecting facts. */
const apply_effects = (state, effects) =>
  (effects ?? []).reduce(
    (acc, effect) => {
      const next = apply_effect_row(acc.state, effect)
      return { state: next.state, facts: [...acc.facts, ...next.facts] }
    },
    { state, facts: /** @type {FrameFact[]} */ ([]) },
  )

/** The destination cell of a fight_moved path (last step; the path excludes the start cell). */
const path_destination = path =>
  Array.isArray(path) && path.length > 0 ? path[path.length - 1] : null

// ── The door ───────────────────────────────────────────────────────────────────

/**
 * Evolve the observable state by ONE canonical (sim-emitted) event, returning the next state + that event's
 * frame facts — or a `sim_failure` for an unrecognized event. Pure and total. The event vocabulary is the sim's
 * own emission set (`reduce`'s `type` field), the leaf-side twin of the chain's journal.
 * @param {ObservableState} state
 * @param {Record<string, any>} event
 * @returns {EvolveResult | SimFailure}
 */
export const apply_canonical_event = (state, event) => {
  if (!event || typeof event.type !== 'string')
    return { kind: 'sim_failure', event, reason: 'event has no string `type`' }
  switch (event.type) {
    // ── placement phase ──
    case 'fight_placed':
    case 'fight_joined':
      return {
        state: patch_fighter(state, event.entity_id, { cell: event.cell }),
        frame_facts: [{ kind: 'placed', id: event.entity_id, to: event.cell }],
      }
    case 'fight_ready':
      return { state, frame_facts: [{ kind: 'ready', id: event.entity_id }] }
    case 'fight_started':
      // Turn order + decks are private machinery; the observable turn opens on the fight_turn_start that follows.
      return { state, frame_facts: [{ kind: 'started' }] }

    // ── movement ──
    case 'fight_moved': {
      const to = path_destination(event.path)
      return {
        state: to ? patch_fighter(state, event.entity_id, { cell: to }) : state,
        frame_facts: [
          {
            kind: 'moved',
            id: event.entity_id,
            to,
            path: event.path,
            ...(event.tackled ? { tackled: true } : {}),
          },
        ],
      }
    }

    // ── effect-bearing events (shared SpellCastEffect rows) ──
    case 'fight_cast': {
      const applied = apply_effects(state, event.effects)
      return {
        state: applied.state,
        frame_facts: [
          {
            kind: 'cast',
            id: event.entity_id,
            ...(event.target != null ? { target: event.target } : {}),
          },
          ...applied.facts,
        ],
      }
    }
    case 'fight_trap_triggered': {
      const applied = apply_effects(state, event.effects)
      return {
        state: applied.state,
        frame_facts: [
          { kind: 'trap', id: event.entity_id, cell: event.cell },
          ...applied.facts,
        ],
      }
    }
    case 'fight_turn_effects': {
      const applied = apply_effects(state, event.effects)
      return { state: applied.state, frame_facts: applied.facts }
    }
    // A forfeit: the seat's own death, carried by the ordinary damage row (reduce.js `handle_abandon`, the
    // twin of the chain's `emit_abandoned`) — so the board evolves through the SAME door as any killing hit.
    case 'fight_abandoned': {
      const applied = apply_effects(state, event.effects)
      return {
        state: applied.state,
        frame_facts: [
          { kind: 'abandoned', id: event.entity_id },
          ...applied.facts,
        ],
      }
    }

    // ── turn machine ──
    case 'fight_turn_start':
      return {
        state: { ...state, active_id: event.entity_id },
        frame_facts: [{ kind: 'turn_start', id: event.entity_id }],
      }
    case 'fight_turn_end':
      return {
        state:
          state.active_id === event.entity_id
            ? { ...state, active_id: null }
            : state,
        frame_facts: [{ kind: 'turn_end', id: event.entity_id }],
      }
    case 'fight_turn_skipped':
      return {
        state,
        frame_facts: [{ kind: 'turn_skipped', id: event.entity_id }],
      }

    // ── resource bookkeeping (no observable-board delta) ──
    case 'ap_reserve_used':
      return { state, frame_facts: [] }

    // ── terminal ──
    case 'fight_ended':
      return {
        state: { ...state, winner: Number(event.winner) },
        frame_facts: [{ kind: 'ended', winner: Number(event.winner) }],
      }

    default:
      return {
        kind: 'sim_failure',
        event,
        reason: `unrecognized event type '${event.type}'`,
      }
  }
}

/**
 * A deterministic content hash of a sim state — stable key order, cheap. THE single home is the timeline capsule
 * digest (`digest` over `stable_stringify`): re-exported here as the V2 seam name so capsule checkpoints and the
 * CI coherence gate share one hash with the replay gate. Works on a full `FightState` (capsule terminal digest)
 * OR an `ObservableState` (fold checkpoint) — any plain value, keys sorted recursively before hashing.
 * @param {unknown} state
 * @returns {string}
 */
export const hash_state = state => digest(state)
