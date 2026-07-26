// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// oracle/laws.js — the L1 invariants over ONE reducer transition (issue #930).
//
// The ladder's bottom rung needs no oracle: these hold for every correct fight, whatever the
// numbers are. They are checked after EVERY folded command, legal or not — a refusal must be
// refusal-as-data (the state comes back unchanged), never a partial mutation.
//
// ONE HOME PER FACT. Four of the nine laws already have a home in timeline.js PHYSICS_INVARIANTS
// and are surfaced from there rather than re-stated here (generator.js merges both lists):
//   law 1 HP in [0, health_max]      -> `hp_bounds`         law 5 winner is monotone -> `winner_terminal`
//   corpse stays a corpse            -> `dead_stays_dead`   one body per cell        -> `occupancy_exclusive`
// This file adds the three that had none. Laws 6-8 (determinism, fold-replay, capsule round-trip)
// are relations BETWEEN runs, not properties of one step, so they live in the runners.
//
// PURE + TOTAL: a breach is DATA in the tripwire's own `{ rule, entities, message }` shape.

/** @param {object} state @returns {object[]} */
const all_entities = state => [...state.team0, ...state.team1]

/** @param {object} state @param {string} id */
const entity_at = (state, id) =>
  all_entities(state).find(entity => entity.id === id)

/** Commands that make a fighter ACT. `end_turn` / `ai_turn` merely pass a turn, `abandon` forfeits;
 *  those three stay legal for a corpse (reduce.js c156: a dead actor's turn must still be cleared). */
const ACTING = new Set(['move', 'cast', 'use_ap_reserve'])

/** The fields a command may never touch on a fighter that was already dead when it arrived. */
const CORPSE_FIELDS = ['health', 'ap', 'mp', 'ap_used', 'mp_used']

/** @type {{ id:string, check:(prev:object, next:object, command:object) => { message:string, entities:string[] } | null }[]} */
export const LAWS = [
  {
    // LAW 2 — dead entities never act: an acting command from a corpse returns the state untouched,
    // and a turn-passing one may pass its turn but never move, hurt or bill the corpse itself.
    id: 'dead_never_acts',
    check: (prev, next, command) => {
      const before =
        command.entity_id == null ? null : entity_at(prev, command.entity_id)
      if (!before || before.health > 0) return null
      if (ACTING.has(command.type))
        return next === prev
          ? null
          : {
              message: `dead ${before.id} changed the fight with a ${command.type}`,
              entities: [before.id],
            }
      const after = entity_at(next, before.id)
      if (!after) return null
      const moved =
        after.cell.x !== before.cell.x || after.cell.y !== before.cell.y
      const billed = CORPSE_FIELDS.find(field => after[field] !== before[field])
      if (!moved && billed == null) return null
      return {
        message: `dead ${before.id} ${moved ? 'was relocated' : `had ${billed} changed`} by a ${command.type}`,
        entities: [before.id],
      }
    },
  },
  {
    // LAW 3 — pools stay inside their budget: never negative, never above the fighter's own max,
    // and a single turn can never spend more than the max it was refilled to.
    id: 'budgets_bounded',
    check: (_prev, next) => {
      const bad = all_entities(next).find(
        entity =>
          entity.ap < 0 ||
          entity.mp < 0 ||
          entity.ap > entity.ap_max ||
          entity.mp > entity.mp_max ||
          entity.ap_used > entity.ap_max ||
          entity.mp_used > entity.mp_max,
      )
      return bad
        ? {
            message: `${bad.id} pools out of budget: ap ${bad.ap}/${bad.ap_max} (used ${bad.ap_used}), mp ${bad.mp}/${bad.mp_max} (used ${bad.mp_used})`,
            entities: [bad.id],
          }
        : null
    },
  },
  {
    // LAW 4 — the turn order is frozen once combat starts, and current_turn_idx always addresses it.
    id: 'turn_order_stable',
    check: (prev, next) => {
      const order = next.turn_order ?? []
      if (prev.started && (prev.turn_order ?? []).join('|') !== order.join('|'))
        return {
          message: `turn_order changed mid-fight: [${(prev.turn_order ?? []).join(', ')}] -> [${order.join(', ')}]`,
          entities: order,
        }
      if (!next.started) return null
      const addressable =
        order.length > 0 &&
        Number.isInteger(next.current_turn_idx) &&
        next.current_turn_idx >= 0 &&
        next.current_turn_idx < order.length
      return addressable
        ? null
        : {
            message: `current_turn_idx ${next.current_turn_idx} does not address a ${order.length}-seat order`,
            entities: order,
          }
    },
  },
]

/**
 * Run the added laws over one transition. Same return shape as timeline.js `check_tripwires`, so a
 * caller keeps ONE violation list.
 * @param {object} prev
 * @param {object} next
 * @param {object} command
 * @param {object[]} [events]
 * @returns {{ rule:string, entities:string[], message:string, evidence:string }[]}
 */
export const check_laws = (prev, next, command, events = []) =>
  LAWS.flatMap(law => {
    const hit = law.check(prev, next, command)
    return hit === null
      ? []
      : [
          {
            rule: law.id,
            entities: hit.entities,
            message: hit.message,
            evidence: JSON.stringify({ command, events: events.length }),
          },
        ]
  })
