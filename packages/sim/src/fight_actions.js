// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Immutable fight transitions. Shuffle and tackle use the single deterministic integer PRNG thread.

import { rng_int } from './prng.js'
import {
  find_entity,
  next_id,
  update_entity,
  effective_stats,
  effective_ap_max,
  effective_mp_max,
} from './fight_state.js'
import {
  erosion_amount,
  incoming_branch,
  punishment_bonuses,
  redirect_target,
  reflect_percent,
} from './fight_reactions.js'
import {
  find_adjacent_enemies,
  tackle_contest,
  tackle_losses,
} from './fight_tackle.js'

// ── Movement + tackle ───────────────────────────────────────────────────────────
// The contest math lives in fight_tackle.js (the Move-parity formula home, golden-pinned by
// test/tackle_golden.test.js); this path owns only the roll draw off the sim rng thread + the state writes.

/**
 * Contest the start-cell tackle ONCE: every living enemy adjacent to `entity_id`'s current cell locks the exit
 * as one exact product fraction (fight_tackle.js — the Move-parity math home). Returns the rng-advanced state
 * plus whether the mover ESCAPED; a failed escape applies the AP/MP penalty and denies the move. No adjacent
 * enemy ⇒ a free escape with NO roll (rng untouched). The single home shared by apply_move and the ordinary-move
 * trap walk (reduce.js) — both contest exactly once, before any cell is entered.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, escaped: boolean }}
 */
export const contest_tackle = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, escaped: true }
  const adjacent_enemies = find_adjacent_enemies(state, entity.cell, entity_id)
  if (adjacent_enemies.length === 0) return { state, escaped: true }
  // Combine every adjacent lock contest as one exact product fraction (fight_tackle.js — Move-parity math).
  const escape = tackle_contest(
    effective_stats(entity).agility ?? 0,
    adjacent_enemies.map(e => effective_stats(e).agility ?? 0),
  )
  const roll = rng_int(state.rng, escape.den)
  if (roll.value < escape.num)
    return { state: { ...state, rng: roll.state }, escaped: true }
  // A failed escape loses the failed fraction of both pools and denies movement.
  const { ap_lost, mp_lost } = tackle_losses(
    entity.ap,
    entity.mp,
    escape.num,
    escape.den,
  )
  const tackled_state = update_entity(
    { ...state, rng: roll.state },
    entity_id,
    e => ({
      ...e,
      ap: Math.max(0, e.ap - ap_lost),
      mp: Math.max(0, e.mp - mp_lost),
    }),
  )
  return { state: tackled_state, escaped: false }
}

/**
 * Apply a movement path with the exact multi-lock agility contest.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {import('./cell.js').Cell[]} path   inclusive of the start cell
 * @returns {{ state: import('./fight_state.js').FightState, success: boolean, error?: string, tackled?: boolean, cells_moved: number }}
 */
export const apply_move = (state, entity_id, path) => {
  if (!state.started)
    return {
      state,
      success: false,
      error: 'COMBAT_NOT_STARTED',
      cells_moved: 0,
    }
  const entity = find_entity(state, entity_id)
  if (!entity)
    return { state, success: false, error: 'ENTITY_NOT_FOUND', cells_moved: 0 }
  if (path.length === 0)
    return { state, success: false, error: 'EMPTY_PATH', cells_moved: 0 }

  const mp_cost = path.length - 1
  if (entity.mp < mp_cost)
    return { state, success: false, error: 'INSUFFICIENT_MP', cells_moved: 0 }

  const contest = contest_tackle(state, entity_id)
  if (!contest.escaped)
    return {
      state: contest.state,
      success: false,
      tackled: true,
      cells_moved: 0,
      error: 'TACKLED',
    }

  // Relocate along the path (skip the start cell), then deduct MP for the distance traveled.
  const destination = path[path.length - 1]
  const moved = update_entity(contest.state, entity_id, e => ({
    ...e,
    cell: destination,
    mp: Math.max(0, e.mp - mp_cost),
    mp_used: e.mp_used + mp_cost,
  }))
  return { state: moved, success: true, cells_moved: mp_cost }
}

// ── Damage / heal ─────────────────────────────────────────────────────────────

/**
 * Apply raw damage, clamp to 0, run victory check on a kill. Donor apply_damage (actions.ts:200).
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {number} amount
 * @returns {{ state: import('./fight_state.js').FightState, damage_dealt: number, killed: boolean }}
 */
export const apply_damage = (state, target_id, amount) => {
  const entity = find_entity(state, target_id)
  if (!entity) return { state, damage_dealt: 0, killed: false }
  const new_health = Math.max(0, entity.health - amount)
  const killed = new_health === 0
  const updated = update_entity(state, target_id, e => ({
    ...e,
    health: new_health,
  }))
  const victory = killed ? check_victory(updated) : null
  const final_state =
    victory !== null ? { ...updated, winner: victory } : updated
  return {
    state: final_state,
    damage_dealt: Math.min(amount, entity.health),
    killed,
  }
}

/**
 * Spend each shield by the amount it absorbed.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {{ id: number, absorbed: number }[]} shields_consumed
 * @returns {import('./fight_state.js').FightState}
 */
export const consume_shields = (state, target_id, shields_consumed) => {
  if (!shields_consumed.length) return state
  const absorbed_by_id = new Map(shields_consumed.map(s => [s.id, s.absorbed]))
  return update_entity(state, target_id, e => ({
    ...e,
    effects: e.effects
      .map(effect =>
        effect.type === 'SHIELD' && absorbed_by_id.has(effect.id)
          ? {
              ...effect,
              value: effect.value - (absorbed_by_id.get(effect.id) ?? 0),
            }
          : effect,
      )
      .filter(effect => !(effect.type === 'SHIELD' && effect.value <= 0)),
  }))
}

/**
 * Apply healing, clamped to health_max. Donor apply_heal (actions.ts:227).
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {number} amount
 * @returns {import('./fight_state.js').FightState}
 */
export const apply_heal = (state, target_id, amount) => {
  const entity = find_entity(state, target_id)
  if (!entity) return state
  const new_health = Math.min(entity.health_max, entity.health + amount)
  return update_entity(state, target_id, e => ({ ...e, health: new_health }))
}

/**
 * Resolve one already-calculated incoming hit through the wave-12 status pipeline. Reflected/redirection damage
 * uses raw apply_damage and therefore cannot recurse. `amount` is post-formula/post-shield damage.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {number} amount
 * @param {string} [attacker_id]
 */
export const apply_incoming_damage = (
  state,
  target_id,
  amount,
  attacker_id,
) => {
  const original = find_entity(state, target_id)
  if (!original)
    return {
      state,
      damage_dealt: 0,
      heal_dealt: 0,
      killed: false,
      recipient_id: target_id,
      effects: [],
    }
  const branch = incoming_branch(
    state,
    original,
    Math.max(0, Math.floor(amount)),
  )
  if (branch.mode === 'HEAL') {
    const healed = Math.min(
      branch.amount,
      original.health_max - original.health,
    )
    return {
      state: apply_heal(branch.state, target_id, branch.amount),
      damage_dealt: 0,
      heal_dealt: healed,
      killed: false,
      recipient_id: target_id,
      effects: [],
    }
  }

  const recipient_id = redirect_target(branch.state, original)
  const recipient = find_entity(branch.state, recipient_id)
  if (!recipient)
    return {
      state: branch.state,
      damage_dealt: 0,
      heal_dealt: 0,
      killed: false,
      recipient_id,
      effects: [],
    }
  if (recipient_id !== target_id) {
    const redirected = apply_damage(branch.state, recipient_id, branch.amount)
    return {
      state: redirected.state,
      damage_dealt: redirected.damage_dealt,
      heal_dealt: 0,
      killed: redirected.killed,
      recipient_id,
      effects: [{ target_id: recipient_id, status: 'DAMAGE_REDIRECT' }],
    }
  }
  const hit = apply_damage(branch.state, recipient_id, branch.amount)
  let next = hit.state
  const extra_effects = []

  const erosion = erosion_amount(recipient, hit.damage_dealt)
  if (erosion > 0) {
    next = update_entity(next, recipient_id, entity => {
      const health_max = Math.max(1, entity.health_max - erosion)
      return {
        ...entity,
        health_max,
        health: Math.min(entity.health, health_max),
      }
    })
    extra_effects.push({
      target_id: recipient_id,
      status: 'EROSION',
      damage: erosion,
    })
  }

  for (const bonus of hit.killed
    ? []
    : punishment_bonuses(recipient, hit.damage_dealt)) {
    const allocated = next_id(next)
    const vitality = bonus.stat === 'vitality' || bonus.stat === 'max_hp'
    next = add_effect(allocated.state, recipient_id, {
      id: allocated.id,
      type: 'STAT_BUFF',
      timing: 'TURN_START',
      source_id: bonus.source_id,
      stat: vitality ? 'max_hp' : bonus.stat,
      value: bonus.value,
      turns_remaining: bonus.turns_remaining,
    })
    if (vitality)
      next = update_entity(next, recipient_id, entity => ({
        ...entity,
        health_max: entity.health_max + bonus.value,
      }))
    extra_effects.push({
      target_id: recipient_id,
      status: 'PUNISHMENT_TRIGGER',
      stat: bonus.stat,
      value: bonus.value,
    })
  }

  const reflected =
    attacker_id && attacker_id !== target_id
      ? Math.floor((hit.damage_dealt * reflect_percent(original)) / 100)
      : 0
  if (attacker_id && reflected > 0) {
    const attacker = find_entity(next, attacker_id)
    if (attacker?.health) {
      const reflected_hit = apply_damage(next, attacker_id, reflected)
      next = reflected_hit.state
      extra_effects.push({
        target_id: attacker_id,
        damage: reflected_hit.damage_dealt,
        new_health: Math.max(0, attacker.health - reflected_hit.damage_dealt),
        killed: reflected_hit.killed,
        status: 'DAMAGE_REFLECT',
      })
    }
  }

  return {
    state: next,
    damage_dealt: hit.damage_dealt,
    heal_dealt: 0,
    killed: hit.killed,
    recipient_id,
    effects: extra_effects,
  }
}

// ── AP / effects ──────────────────────────────────────────────────────────────

/** Deduct AP and track usage (for PER_AP effects). Donor deduct_ap (actions.ts:246). */
export const deduct_ap = (state, entity_id, amount) =>
  update_entity(state, entity_id, e => ({
    ...e,
    ap: Math.max(0, e.ap - amount),
    ap_used: e.ap_used + amount,
  }))

/** Append an active effect to an entity. Donor add_effect (actions.ts:261). */
export const add_effect = (state, target_id, effect) =>
  update_entity(state, target_id, e => ({
    ...e,
    effects: [...e.effects, effect],
  }))

/** Whether the entity carries a live turn-skipping stun. */
export const is_stunned = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  return !!entity && entity.effects.some(e => e.type === 'STUN')
}

/**
 * Apply pre-rolled turn-start effects, then decrement every status counter.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const process_turn_effects = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, effects: [] }
  const tick = entity.effects
    .filter(effect => effect.timing === 'TURN_START')
    .reduce(
      (acc, effect) => {
        const here = find_entity(acc.state, entity_id)
        if (!here || here.health <= 0) return acc
        if (effect.type === 'DAMAGE') {
          const after = apply_incoming_damage(
            acc.state,
            entity_id,
            effect.value,
            effect.source_id,
          )
          const recipient = find_entity(after.state, after.recipient_id)
          return {
            state: after.state,
            effects: [
              ...acc.effects,
              ...(after.heal_dealt > 0
                ? [
                    {
                      target_id: entity_id,
                      heal: after.heal_dealt,
                      new_health:
                        find_entity(after.state, entity_id)?.health ??
                        here.health,
                    },
                  ]
                : [
                    {
                      target_id: after.recipient_id,
                      damage: after.damage_dealt,
                      new_health: recipient?.health ?? 0,
                      killed: after.killed,
                    },
                  ]),
              ...after.effects,
            ],
          }
        }
        if (effect.type === 'HEAL') {
          const healed = apply_heal(acc.state, entity_id, effect.value)
          return {
            state: healed,
            effects: [
              ...acc.effects,
              {
                target_id: entity_id,
                heal: effect.value,
                new_health: Math.min(
                  here.health_max,
                  here.health + effect.value,
                ),
              },
            ],
          }
        }
        return acc
      },
      {
        state,
        effects:
          /** @type {import('./fight_spells.js').SpellCastEffect[]} */ ([]),
      },
    )
  const post_tick = find_entity(tick.state, entity_id) ?? entity
  const expired_stances = post_tick.effects.filter(
    effect => effect.type === 'STANCE' && effect.turns_remaining <= 1,
  )
  const max_hp_expiry = post_tick.effects.reduce(
    (sum, effect) =>
      sum +
      (effect.type === 'STAT_BUFF' &&
      effect.stat === 'max_hp' &&
      effect.turns_remaining <= 1
        ? effect.value
        : 0),
    0,
  )
  const decayed = update_entity(tick.state, entity_id, e => {
    const health_max = Math.max(1, e.health_max - max_hp_expiry)
    return {
      ...e,
      health_max,
      health: Math.min(e.health, health_max),
      effects: e.effects
        .map(eff => ({ ...eff, turns_remaining: eff.turns_remaining - 1 }))
        .filter(eff => eff.turns_remaining > 0),
    }
  })
  return {
    state: decayed,
    effects: [
      ...tick.effects,
      ...expired_stances.map(() => ({
        target_id: entity_id,
        status: 'STANCE_END',
      })),
    ],
  }
}

// ── Turn advance ──────────────────────────────────────────────────────────────

/** Step to the next actor and refill its effective pools. */
export const advance_turn = state => {
  if (!state.started) return state
  const { turn_order } = state
  if (turn_order.length === 0) return state

  const next_idx = (state.current_turn_idx + 1) % turn_order.length
  const turn_number = next_idx === 0 ? state.turn_number + 1 : state.turn_number
  const base_state = { ...state, current_turn_idx: next_idx, turn_number }

  const next_entity_id = turn_order[next_idx]
  if (next_entity_id === undefined) return base_state
  const entity = find_entity(base_state, next_entity_id)
  if (!entity) return base_state

  return update_entity(base_state, next_entity_id, e => ({
    ...e,
    // Refill to the EFFECTIVE pool max so an active ap/mp buff/debuff persists across this actor's turns
    // (a no-op = e.ap_max / e.mp_max when the actor carries no ap/mp modifier).
    ap: effective_ap_max(e),
    mp: effective_mp_max(e),
    ap_used: 0,
    mp_used: 0,
  }))
}

/**
 * Which team has won (the other is fully dead), or null if both still have a survivor. Donor actions.ts:371.
 * @param {import('./fight_state.js').FightState} state
 * @returns {0 | 1 | null}
 */
export const check_victory = state => {
  const team0_alive = state.team0.some(e => e.health > 0)
  const team1_alive = state.team1.some(e => e.health > 0)
  if (!team0_alive) return 1
  if (!team1_alive) return 0
  return null
}

/** Pour the AP reserve into the current turn's AP. Donor use_ap_reserve (actions.ts:485). */
export const use_ap_reserve = (state, entity_id) =>
  update_entity(state, entity_id, entity => ({
    ...entity,
    ap: entity.ap + entity.ap_reserve,
    ap_reserve: 0,
  }))
