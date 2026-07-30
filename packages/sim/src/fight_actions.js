// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Immutable fight transitions. Shuffle and tackle use the single deterministic integer PRNG thread.

import { rng_int, rng_next, rng_seed } from './prng.js'
import { turn_rng_of, with_turn_rng } from './combat_clock.js'
import { tackle_seed, turn_seed } from './turn_seed.js'
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
  flat_reflect,
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
// test/tackle_golden.test.js); this path owns only the roll DRAW + the state writes. Two draws, exactly as the
// chain has them (actions.move:49-63): a PLAYER move reads the public turn clock — previewable, so the board's
// `next_move_tackle` gate and this resolver decide the SAME contest — while a mob move draws the crank thread.

/**
 * Contest the start-cell tackle ONCE: every living enemy adjacent to `entity_id`'s current cell locks the exit
 * as one exact product fraction (fight_tackle.js — the Move-parity math home). Returns the state plus whether
 * the mover ESCAPED; a failed escape applies the AP/MP penalty and denies the move. No adjacent enemy ⇒ a free
 * escape with NO roll (no draw at all). The single home shared by apply_move and the ordinary-move trap walk
 * (reduce.js) — both contest exactly once, before any cell is entered.
 *
 * A PLAYER move with a turn clock draws `rng_next(tackle_seed(turn_seed(clock), slot, live mp))` and leaves the
 * crank thread ALONE (#1207) — the twin of spell_formula::tackle_seed, so the client previews the exact escape
 * the resolver will roll. Moves never advance the slot; the runner's MP reprices every re-attempt. Everything
 * else (mob moves, standalone fixtures) keeps the crank draw off `turn_rng`.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {import('./reduce.js').ReduceContext['turn_context']|null} [turn_context] the public clock at this
 *   move's action position; ignored for a non-player mover.
 * @returns {{ state: import('./fight_state.js').FightState, escaped: boolean }}
 */
export const contest_tackle = (state, entity_id, turn_context = null) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, escaped: true }
  const adjacent_enemies = find_adjacent_enemies(state, entity.cell, entity_id)
  if (adjacent_enemies.length === 0) return { state, escaped: true }
  // Combine every adjacent lock contest as one exact product fraction (fight_tackle.js — Move-parity math).
  const escape = tackle_contest(
    effective_stats(entity).agility ?? 0,
    adjacent_enemies.map(e => effective_stats(e).agility ?? 0),
  )
  // Same gate the cast path uses for its damage/crit rolls (fight_spells.js): clock + player + a stamped slot.
  const clocked =
    !!turn_context && !!entity.is_player && turn_context.slot != null
  const crank = clocked ? null : rng_int(turn_rng_of(state), escape.den)
  const roll = clocked
    ? rng_next(
        rng_seed(
          tackle_seed(turn_seed(turn_context), turn_context.slot, entity.mp),
        ),
      ).value % escape.den
    : crank.value
  // A clocked draw is scratch: it never advances the fight's crank thread.
  const threaded = clocked ? state : with_turn_rng(state, crank.state)
  if (roll < escape.num) return { state: threaded, escaped: true }
  // A failed escape loses the failed fraction of both pools and denies movement.
  const { ap_lost, mp_lost } = tackle_losses(
    entity.ap,
    entity.mp,
    escape.num,
    escape.den,
  )
  const tackled_state = update_entity(threaded, entity_id, e => ({
    ...e,
    ap: Math.max(0, e.ap - ap_lost),
    mp: Math.max(0, e.mp - mp_lost),
  }))
  return { state: tackled_state, escaped: false }
}

/**
 * Apply a movement path with the exact multi-lock agility contest.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {import('./cell.js').Cell[]} path   inclusive of the start cell
 * @param {import('./reduce.js').ReduceContext['turn_context']|null} [turn_context]
 * @returns {{ state: import('./fight_state.js').FightState, success: boolean, error?: string, tackled?: boolean, cells_moved: number }}
 */
export const apply_move = (state, entity_id, path, turn_context = null) => {
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

  const contest = contest_tackle(state, entity_id, turn_context)
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
 * Spend each kind-40 pool by the amount it absorbed. Kind-24 SHIELD rows are immutable per-hit flats.
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
        effect.type === 'POOL_SHIELD' && absorbed_by_id.has(effect.id)
          ? {
              ...effect,
              value: effect.value - (absorbed_by_id.get(effect.id) ?? 0),
            }
          : effect,
      )
      .filter(effect => !(effect.type === 'POOL_SHIELD' && effect.value <= 0)),
  }))
}

/**
 * Stat ids 5 (Vitality) and 10 (MAX_HP) have no field in either twin's stat block (`spell::add_stat` skips both
 * on chain; `effective_stats` excludes `max_hp` here), so an ALTER_STAT row naming either of them is an
 * HP-CAPACITY fact and nothing else. This predicate is the ONE home for that question — the Move twin is
 * `retro_effects::is_max_hp_alter`. Every mint of such a row moves capacity through `apply_max_hp_delta` and
 * every departure (expiry, dispel) moves it back, so the two directions are exact inverses (#1628).
 * @param {string | undefined} stat
 */
export const is_max_hp_stat = stat => stat === 'vitality' || stat === 'max_hp'

/**
 * Move `retro_effects::apply_max_hp_alter` / `revert_expired_max_hp`, one signed home. A GAIN is capacity only —
 * current HP does not ride it up (`participant::add_max_hp_bonus`); a LOSS floors capacity at 1 and clamps
 * current HP down to it (`participant::remove_max_hp_bonus`), and the clamp is never a heal on the way back.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {number} delta
 * @returns {import('./fight_state.js').FightState}
 */
export const apply_max_hp_delta = (state, target_id, delta) =>
  delta === 0
    ? state
    : update_entity(state, target_id, entity => {
        const health_max = Math.max(1, entity.health_max + delta)
        return {
          ...entity,
          health_max,
          health: Math.min(entity.health, health_max),
        }
      })

/**
 * The RECEIPT riders every capacity move owes. A max-HP change is observable twice over — the new ceiling, and
 * the current HP a LOSS clamps down to — and the receipt is the only channel a consumer that folds events has
 * for either (the chain carries them on the object read; the simulator has no object read). Without these a
 * capacity clamp was an HP change no emitted event described, which is exactly what the twin-coherence property
 * (`test/evolve_coherence.test.js`) refuses.
 * @param {import('./fight_state.js').FightState} state  the state AFTER the capacity move
 * @param {string} id
 */
export const max_hp_riders = (state, id) => {
  const entity = find_entity(state, id)
  return entity ? { max_hp: entity.health_max, new_health: entity.health } : {}
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
  const incoming = Math.max(0, Math.floor(amount))
  if (incoming === 0)
    return {
      state,
      damage_dealt: 0,
      heal_dealt: 0,
      killed: false,
      recipient_id: target_id,
      effects: [],
    }
  const branch = incoming_branch(state, original, incoming)
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
      // Erosion is a capacity move like any other — same riders, same reason (`max_hp_riders`).
      ...max_hp_riders(next, recipient_id),
    })
  }

  for (const bonus of hit.killed
    ? []
    : punishment_bonuses(recipient, hit.damage_dealt)) {
    const allocated = next_id(next)
    const vitality = is_max_hp_stat(bonus.stat)
    next = add_effect(allocated.state, recipient_id, {
      id: allocated.id,
      type: 'STAT_BUFF',
      timing: 'TURN_START',
      source_id: bonus.source_id,
      stat: vitality ? 'max_hp' : bonus.stat,
      value: bonus.value,
      turns_remaining: bonus.turns_remaining,
    })
    if (vitality) next = apply_max_hp_delta(next, recipient_id, bonus.value)
    extra_effects.push({
      target_id: recipient_id,
      status: 'PUNISHMENT_TRIGGER',
      stat: bonus.stat,
      value: bonus.value,
      ...(vitality ? max_hp_riders(next, recipient_id) : {}),
    })
  }

  // The two reflect legs, in the chain's order (retro_effects.move `hit_after_inversion`): the FLAT
  // K_REFLECT_DAMAGE rows return min(their sum, the incoming line), then every positive DAMAGE_REDIRECT row
  // returns its percentage of the ACTUAL HP loss. Both fire only when a distinct attacker is known and the
  // victim really lost HP, and both ride the raw sink so a reflect can never recurse into another reaction.
  // The flat leg used to be missing entirely — the row landed, was rendered, and reflected nothing.
  const reflected_amounts =
    attacker_id && attacker_id !== target_id && hit.damage_dealt > 0
      ? [
          flat_reflect(original, branch.amount),
          Math.floor((hit.damage_dealt * reflect_percent(original)) / 100),
        ].filter(amount => amount > 0)
      : []
  for (const reflected of reflected_amounts) {
    const attacker = find_entity(next, attacker_id)
    if (!attacker?.health) break
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
 * Apply pre-rolled turn-start effects. Status counters age separately at the owner's turn end, matching
 * `cast::tick_turn_start` / `cast::tick_turn_end` rather than disappearing as the next turn begins.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const process_turn_effects = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, effects: [] }
  return entity.effects
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
}

/**
 * Decrement and expire one fighter's timed rows at that fighter's turn end. Mirrors
 * `cast::tick_turn_end` -> `spell_board::decrement_fighter_statuses`.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const expire_turn_effects = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, effects: [] }
  const expired_stances = entity.effects.filter(
    effect => effect.type === 'STANCE' && effect.turns_remaining <= 1,
  )
  // CAPACITY EXPIRY — the exact inverse of every max-hp row that dies on this tick, SIGNED: a departing buff
  // gives its capacity back, a departing debuff returns what it shaved (Move `revert_expired_max_hp`, whose own
  // sign comes from the row's centered value). Keyed on `max_hp` alone because every mint normalizes the
  // vitality id onto it (`is_max_hp_stat`).
  const max_hp_expiry = entity.effects.reduce(
    (sum, effect) =>
      sum +
      (effect.stat === 'max_hp' && effect.turns_remaining <= 1
        ? effect.type === 'STAT_BUFF'
          ? -effect.value
          : effect.type === 'STAT_DEBUFF'
            ? effect.value
            : 0
        : 0),
    0,
  )
  const decayed = update_entity(
    apply_max_hp_delta(state, entity_id, max_hp_expiry),
    entity_id,
    e => ({
      ...e,
      effects: e.effects
        .map(eff =>
          eff.type === 'TIMED_PAYLOAD'
            ? eff
            : { ...eff, turns_remaining: eff.turns_remaining - 1 },
        )
        .filter(eff => eff.turns_remaining > 0),
    }),
  )
  return {
    state: decayed,
    effects: expired_stances.map(() => ({
      target_id: entity_id,
      status: 'STANCE_END',
    })),
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
