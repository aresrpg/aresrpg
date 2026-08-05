// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { rng_int, rng_range } from './prng.js'
import { turn_rng_of, with_turn_rng } from './combat_clock.js'
import {
  next_id,
  find_entity,
  find_entity_at,
  team_of,
  update_entity,
  effective_stats,
} from './fight_state.js'
import {
  deduct_ap,
  apply_damage,
  apply_incoming_damage,
  apply_heal,
  add_effect,
  consume_shields,
} from './fight_actions.js'
import {
  board_zone_cells,
  get_aoe_cells,
  can_target,
  effect_hits,
} from './spell_targeting.js'
import {
  check_cast_limits,
  check_spell_cast_limits,
  record_cast,
} from './fight_cast_limits.js'
import {
  handle_displacement,
  get_direction,
  zone_edge_distance,
} from './fight_displacement.js'
import { check_traps, place_trap, place_glyph } from './fight_traps.js'
import {
  apply_shields,
  calculate_final_damage,
  calculate_heal,
  effect_triggers,
  is_critical,
  punishment_base,
} from './spell_calculator.js'
import {
  crit_at,
  dodge_seed,
  slot_crit_roll,
  slot_damage_roll,
  crank_damage_roll,
  roll_in_range,
  turn_seed,
} from './turn_seed.js'
import {
  apply_invisibility,
  clear_fighter_state,
  fighter_has_state,
  invisible_enemy_at,
  is_direct_effect_list,
  returning_enemy_at,
  reveal,
} from './fight_statuses.js'
import {
  FLAG_DISPELLABLE,
  FLAG_LIFE_LOST,
  has_flag,
  K_CASTER_DAMAGE,
  K_DAMAGE,
  K_PUNISHMENT_DAMAGE,
  rolls_own_magnitude,
  row_flags,
  SHAPE_POINT,
  TF_NONE,
  TF_ONLY_CASTER,
} from './spell_effect.js'
import {
  apply_retro_effect,
  named_damage_bonus,
  roll_fumble,
} from './fight_retro_effects.js'
import { apply_stat_effect } from './fight_stat_effects.js'

export { check_cast_limits, record_cast } from './fight_cast_limits.js'

/**
 * Per-target event summary.
 * @typedef {object} SpellCastEffect
 * @property {string} target_id
 * @property {number} [damage]
 * @property {number} [heal]
 * @property {number} [new_health]
 * @property {boolean} [killed]
 * @property {string} [status]   sim addition: e.g. 'STUN' / 'SHIELD' applied
 * @property {string} [stat]
 * @property {number} [value]
 * @property {number} [stance]
 * @property {import('./cell.js').Cell} [cell]   sim addition: the target's NEW cell after a PUSH/PULL/TELEPORT (so the client re-syncs the board position)
 * @property {boolean} [has_cell]
 */

/**
 * @typedef {object} SpellCastResult
 * @property {boolean} success
 * @property {string} [error]
 * @property {import('./fight_state.js').FightState} state
 * @property {SpellCastEffect[]} effects
 * @property {number} caster_ap_remaining
 * @property {boolean} is_critical
 * @property {boolean} [fumbled]
 */

/**
 * The per-hit rows a damage-class branch (DAMAGE / STEAL / PERCENT_LIFE_DAMAGE) emits — a heal row if the hit
 * inverted to healing, else the damage row, plus riders. ONE home for the shape (twin of `hazard_hit`).
 * @param {import('./fight_state.js').FightState} final_state  post-hit state new_health reads from
 * @param {{ heal_dealt:number, damage_dealt:number, recipient_id:string, killed:boolean, effects:SpellCastEffect[] }} hit
 * @param {string} target_id
 * @returns {SpellCastEffect[]}
 */
const hit_result_effects = (final_state, hit, target_id) => {
  const id = hit.heal_dealt > 0 ? target_id : hit.recipient_id
  const new_health = find_entity(final_state, id)?.health ?? 0
  return [
    hit.heal_dealt > 0
      ? { target_id, heal: hit.heal_dealt, new_health }
      : {
          target_id: hit.recipient_id,
          damage: hit.damage_dealt,
          new_health,
          killed: hit.killed,
        },
    ...hit.effects,
  ]
}

/**
 * THE SPELL-RETURN RESOLUTION — the twin of `cast::try_return_spell` (cast.move:905-970). Returns null when the
 * cast passes through the door untouched, else the redirected outcome. Only the cast's K_DAMAGE lines resolve,
 * onto the CASTER, priced with the caster's own stats on BOTH sides (attacker and defender) exactly as the chain
 * prices them, and written through the RAW hp sink so no reaction fires on a returned hit (depth one). The roll
 * is the cast's own per-cast `damage_roll` rather than the chain's dedicated return stream — the resolved value
 * lands in the same authored band; the stream identity itself is a separate parity axis.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} caster
 * @param {import('./spell_templates.js').SpellEffect[]} effect_list
 * @param {import('./cell.js').Cell} target
 * @param {number} damage_roll
 * @returns {{ state: import('./fight_state.js').FightState, effects: SpellCastEffect[] } | null}
 */
const try_return_spell = (state, caster, effect_list, target, damage_roll) => {
  if (effect_list.some(e => (e.area_shape ?? SHAPE_POINT) !== SHAPE_POINT))
    return null
  const row = returning_enemy_at(state, caster.id, target)
  if (!row) return null
  // The row's own redirect chance, drawn at the door — the DAMAGE_TO_HEAL idiom (fight_reactions.js).
  const chance = Math.max(0, Math.min(100, Math.floor(row.chance ?? 100)))
  if (chance < 100) {
    const draw = rng_int(turn_rng_of(state), 100)
    state = with_turn_rng(state, draw.state)
    if (draw.value >= chance) return null
  }

  const stats = effective_stats(caster)
  return effect_list
    .filter(effect => effect.kind === K_DAMAGE)
    .reduce(
      (acc, effect) => {
        const victim = find_entity(acc.state, caster.id)
        if (!victim || victim.health <= 0) return acc
        const { damage } = calculate_final_damage(
          /** @type {any} */ (effect),
          stats,
          stats,
          damage_roll,
        )
        const hit = apply_damage(acc.state, caster.id, damage)
        return {
          state: hit.state,
          effects: [
            ...acc.effects,
            {
              target_id: caster.id,
              damage: hit.damage_dealt,
              new_health: find_entity(hit.state, caster.id)?.health ?? 0,
              killed: hit.killed,
            },
          ],
        }
      },
      {
        state,
        effects: /** @type {SpellCastEffect[]} */ ([
          { target_id: caster.id, status: 'RETURN_SPELL_REDIRECT' },
        ]),
      },
    )
}

/**
 * Validate phase, caster, level, AP, target, and trap anchor.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} caster_id
 * @param {import('./spell_templates.js').SpellTemplate} spell
 * @param {number} level   1-based
 * @param {import('./cell.js').Cell} target
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {{ valid: boolean, error?: string, spell_level?: import('./spell_templates.js').SpellLevel, caster?: import('./fight_state.js').FightEntity }}
 */
const validate_cast = (state, caster_id, spell, level, target, context) => {
  if (!state.started) return { valid: false, error: 'COMBAT_NOT_STARTED' }
  const caster = find_entity(state, caster_id)
  if (!caster) return { valid: false, error: 'CASTER_NOT_FOUND' }
  const spell_level = spell.levels[level - 1]
  if (!spell_level) return { valid: false, error: 'INVALID_SPELL_LEVEL' }
  if (caster.ap < spell_level.cost)
    return { valid: false, error: 'INSUFFICIENT_AP' }
  // THE STATE GATE — the twin of cast.move:363-372. A K_APPLY_STATE row is not decoration: a level may REQUIRE
  // states the caster must hold and FORBID states that lock the spell out. Same order as the chain (required
  // first), same verdict, so a prediction can never offer a cast the chain will abort.
  if (
    (spell_level.required_states ?? []).some(
      state_id => !fighter_has_state(state, caster_id, state_id),
    )
  )
    return { valid: false, error: 'MISSING_REQUIRED_STATE' }
  if (
    (spell_level.forbidden_states ?? []).some(state_id =>
      fighter_has_state(state, caster_id, state_id),
    )
  )
    return { valid: false, error: 'FORBIDDEN_STATE_PRESENT' }
  const places_trap = spell_level.base_effects.some(
    e => e.type === 'PLACE_TRAP',
  )
  const trap_anchor_occupied =
    places_trap &&
    (context.is_trapped?.(target) ||
      state.traps.some(
        t => t.anchor && t.anchor.x === target.x && t.anchor.y === target.y,
      ))
  const target_capped =
    check_cast_limits(state, caster_id, spell.id, spell_level, target).error ===
    'CASTS_PER_TARGET'
  const targeting_context = {
    ...context,
    is_trapped: cell =>
      context.is_trapped?.(cell) ||
      state.traps.some(
        t => t.anchor && t.anchor.x === cell.x && t.anchor.y === cell.y,
      ),
    target_cap_reached: cell =>
      context.target_cap_reached?.(cell) ||
      check_cast_limits(state, caster_id, spell.id, spell_level, cell).error ===
        'CASTS_PER_TARGET',
  }
  const range_bonus = effective_stats(caster).range ?? 0
  if (
    !can_target(
      spell_level,
      caster.cell,
      target,
      targeting_context,
      range_bonus,
    )
  ) {
    if (trap_anchor_occupied) return { valid: false, error: 'CELL_TRAPPED' }
    if (target_capped) return { valid: false, error: 'CASTS_PER_TARGET' }
    return { valid: false, error: 'INVALID_TARGET' }
  }
  return { valid: true, spell_level, caster }
}

/**
 * Apply one effect to one target, threading rng and sim-local ids.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./spell_templates.js').SpellEffect} effect
 * @param {import('./fight_state.js').FightEntity} caster
 * @param {string} target_id
 * @param {import('./cell.js').Cell} spell_target_cell
 * @param {(cell: import('./cell.js').Cell) => boolean} terrain_walkable  terrain-only walkability (for PUSH/PULL collisions)
 * @param {{ spell_id:string, stack_target_id?:string }} retro_context
 * @returns {{ state: import('./fight_state.js').FightState, effects: SpellCastEffect[], direct_damage?: number }}
 */
export const apply_spell_effect = (
  state,
  effect,
  caster,
  target_id,
  spell_target_cell,
  terrain_walkable,
  retro_context,
  damage_roll = 0, // #577 — the per-cast turn-seed (player) / crank (mob) roll fraction; each damage/heal effect maps it onto its [min,max]
) => {
  const trigger = effect_triggers(turn_rng_of(state), effect)
  state = with_turn_rng(state, trigger.rng)
  if (!trigger.value) return { state, effects: [] }

  const target = find_entity(state, target_id)
  if (!target) return { state, effects: [] }
  const retro = apply_retro_effect(
    state,
    effect,
    caster,
    target_id,
    retro_context,
  )
  if (retro.handled) return retro
  const stat = apply_stat_effect(state, effect, caster, target)
  if (stat.handled) return stat
  if (effect.type === 'DAMAGE') {
    const named_bonus = named_damage_bonus(
      target,
      caster.id,
      retro_context.spell_id,
    )
    // ROLL, then adjust, then amplify — the chain's own order (`final_damage(rolled + damage_bonus, …)`), so a
    // MULTIPLICATIVE adjustment lands on the same integer the chain rolled. A punishment line scales with the
    // caster's missing life here; every other damage line passes its rolled base through untouched.
    const rolled = roll_in_range(
      effect.min ?? 0,
      effect.max ?? effect.min ?? 0,
      damage_roll,
    )
    const base =
      (effect.kind === K_PUNISHMENT_DAMAGE
        ? punishment_base(rolled, caster)
        : rolled) + named_bonus
    const damage_effect = { ...effect, min: base, max: base }
    const shields = target.effects.filter(
      e => e.type === 'SHIELD' || e.type === 'POOL_SHIELD',
    )
    const dmg = calculate_final_damage(
      /** @type {any} */ (damage_effect),
      effective_stats(caster),
      effective_stats(target),
      damage_roll,
      shields,
    )
    const after = apply_incoming_damage(state, target_id, dmg.damage, caster.id)
    const after_shields = consume_shields(
      after.state,
      target_id,
      dmg.shields_consumed,
    )
    return {
      state: after_shields,
      direct_damage: after.damage_dealt,
      effects: hit_result_effects(after_shields, after, target_id),
    }
  }
  if (effect.type === 'PERCENT_LIFE_DAMAGE') {
    // A fraction of the HP POOL (current, or missing under FLAG_LIFE_LOST); deterministic — no amp/variance/resist. cast.move:564-570.
    const pool = has_flag(effect, FLAG_LIFE_LOST)
      ? target.health_max - target.health
      : target.health
    const damage = Math.floor((pool * (effect.value ?? 0)) / 100)
    const mitigated = apply_shields(
      damage,
      effect.element,
      target.effects.filter(
        e => e.type === 'SHIELD' || e.type === 'POOL_SHIELD',
      ),
    )
    const after = apply_incoming_damage(
      state,
      target_id,
      mitigated.damage,
      caster.id,
    )
    const after_shields = consume_shields(
      after.state,
      target_id,
      mitigated.shields_consumed,
    )
    return {
      state: after_shields,
      direct_damage: after.damage_dealt,
      effects: hit_result_effects(after_shields, after, target_id),
    }
  }
  if (effect.type === 'HEAL') {
    const h = calculate_heal(
      /** @type {any} */ (effect),
      effective_stats(caster),
      damage_roll,
    )
    const after = apply_heal(state, target_id, h.value)
    return {
      state: after,
      effects: [
        {
          target_id,
          heal: h.value,
          new_health: Math.min(target.health_max, target.health + h.value),
        },
      ],
    }
  }
  if (effect.type === 'STEAL') {
    const named_bonus = named_damage_bonus(
      target,
      caster.id,
      retro_context.spell_id,
    )
    const dmg = calculate_final_damage(
      /** @type {any} */ ({
        ...effect,
        type: 'DAMAGE',
        min: (effect.min ?? 0) + named_bonus,
        max: (effect.max ?? 0) + named_bonus,
      }),
      effective_stats(caster),
      effective_stats(target),
      damage_roll,
      target.effects.filter(
        e => e.type === 'SHIELD' || e.type === 'POOL_SHIELD',
      ),
    )
    const after_dmg = apply_incoming_damage(
      state,
      target_id,
      dmg.damage,
      caster.id,
    )
    const after_shields = consume_shields(
      after_dmg.state,
      target_id,
      dmg.shields_consumed,
    )
    // THE STEAL-BACK, chain-exact (cast.move:1385 `heal_caster` + the `actual` it is fed, retro_effects.move:266).
    // Two conditions the sim used to ignore: the chain heals ONLY a PLAYER_SIDE caster (a mob's life-steal heals
    // nobody), and it heals half the damage the victim ACTUALLY took — a full redirect returns 0, so a redirected
    // steal steals nothing back. The heal then rides its OWN effect row (#755): the fold inside the state was
    // invisible to every consumer, so no encoder/timeline/projection could carry the caster's hp change.
    const stolen =
      caster.is_player && after_dmg.recipient_id === target_id
        ? Math.floor(after_dmg.damage_dealt / 2)
        : 0
    const healed = apply_heal(after_shields, caster.id, stolen)
    return {
      state: healed,
      direct_damage: after_dmg.damage_dealt,
      effects: [
        ...hit_result_effects(healed, after_dmg, target_id),
        ...(stolen > 0
          ? [
              {
                target_id: caster.id,
                heal: stolen,
                new_health: find_entity(healed, caster.id)?.health ?? 0,
              },
            ]
          : []),
      ],
    }
  }
  if (effect.type === 'SHIELD' || effect.type === 'POOL_SHIELD') {
    if (effect.min === undefined || effect.max === undefined)
      return { state, effects: [] }
    const { state: s2, id } = next_id(state)
    // FLAT for a chain row (`rolls_own_magnitude`): the chain stores the shield through `record_timed` and reads
    // `effect.value()` back at consumption (retro_effects.move:334/353) — `value_max` is ignored for a non-range
    // kind (spell_effect.move:241), and no magnitude entropy domain exists to mirror a roll.
    const draw = rolls_own_magnitude(effect)
      ? rng_range(turn_rng_of(s2), effect.min, effect.max)
      : { state: turn_rng_of(s2), value: effect.min }
    const shielded = add_effect(with_turn_rng(s2, draw.state), target_id, {
      id,
      type: effect.type,
      timing: 'TURN_START',
      source_id: caster.id,
      element: effect.element,
      value: draw.value,
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return {
      state: shielded,
      effects: [{ target_id, status: effect.type }],
    }
  }
  if (effect.type === 'STUN') {
    const { state: s2, id } = next_id(state)
    const stunned = add_effect(s2, target_id, {
      id,
      type: 'STUN',
      timing: 'TURN_START',
      source_id: caster.id,
      value: 0,
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return { state: stunned, effects: [{ target_id, status: 'STUN' }] }
  }
  if (effect.type === 'APPLY_STATE') {
    // A NAMED STATE — a pure flag row carrying the state id (effect.value), no delta; it decrements + expires
    // like a STUN row (process_turn_effects no-ops its non-DAMAGE/HEAL tick, then decays it). Stored so a
    // required/forbidden-states cast gate reads it by (type 'APPLY_STATE', value === state_id) — the sim twin of
    // Move's spell_board::fighter_has_state (kind == k_apply_state && value == state_id). One home for the state.
    const { state: s2, id } = next_id(state)
    const stated = add_effect(s2, target_id, {
      id,
      type: 'APPLY_STATE',
      timing: 'TURN_START',
      source_id: caster.id,
      value: effect.value ?? 0,
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return { state: stated, effects: [{ target_id, status: 'APPLY_STATE' }] }
  }
  if (effect.type === 'REMOVE_STATE') {
    // The APPLY_STATE eraser (spell_effect.move:52) — drop exactly the rows naming `effect.value`, leaving every
    // unrelated row intact. Twin of `spell_board::clear_fighter_state`, wired on the chain in the same commit.
    // The status row is emitted whether or not the target held the state, exactly as DISPEL reports its sweep.
    const cleared = clear_fighter_state(state, target_id, effect.value ?? 0)
    return { state: cleared, effects: [{ target_id, status: 'REMOVE_STATE' }] }
  }
  if (effect.type === 'RESET_POSITIONS') {
    // Named refusal, matching cast.move:1577: neither fight state carries the start-of-turn cells needed to
    // relocate fighters. Keep the authored kind observable without inventing positions or mutating the board.
    return { state, effects: [{ target_id, status: 'RESET_POSITIONS' }] }
  }
  if (effect.type === 'REFLECT_DAMAGE') {
    // A FLAT damage-reflect (spell_effect.move:57, value = flat) — a TIMED defensive row on the protected fighter
    // carrying the flat amount + duration; it no-ops on tick and decays like a STUN (process_turn_effects). Mirrors
    // Move's record_timed (cast.move:681) + the DAMAGE_REDIRECT idiom — a timed row the damage path consults. The
    // FLAT-reflect CONSUMPTION (distinct from DAMAGE_REDIRECT's PERCENT reflect, fight_reactions::reflect_percent)
    // rides the next train; the sim lands the row honestly here (matrix `status` postcondition).
    const { state: s2, id } = next_id(state)
    const reflected = add_effect(s2, target_id, {
      id,
      type: 'REFLECT_DAMAGE',
      timing: 'TURN_START',
      source_id: caster.id,
      value: effect.value ?? 0,
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return {
      state: reflected,
      effects: [{ target_id, status: 'REFLECT_DAMAGE' }],
    }
  }
  if (effect.type === 'RETURN_SPELL') {
    // SPELL-RETURN (spell_effect.move:61-64) — a TIMED status row on the shielded fighter; it no-ops on tick and
    // decays like a STUN. Mirrors Move's record_timed (cast.move:682). The DEPTH-1 return-redirect RESOLUTION (a
    // returned cast can never be returned/reflected again) is enforced at the dungeon resolver, never in this
    // pure-data layer (spell_effect.move:62-63) — the sim lands the ROW; the redirect arm rides the next train.
    const { state: s2, id } = next_id(state)
    const returned = add_effect(s2, target_id, {
      id,
      type: 'RETURN_SPELL',
      timing: 'TURN_START',
      source_id: caster.id,
      value: effect.value ?? 0,
      // The row carries the REDIRECT probability the chain rolls at the door (`effect_proc(row)`,
      // cast.move:930) — the same idiom the DAMAGE_TO_HEAL row uses for its own consumption-time draw.
      chance: Math.max(0, Math.min(100, Math.floor(effect.chance ?? 100))),
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return { state: returned, effects: [{ target_id, status: 'RETURN_SPELL' }] }
  }
  if (effect.type === 'DISPEL') {
    // STRIP the target's dispellable rows (spell_effect.move:58) — exactly the FLAG_DISPELLABLE-flagged rows
    // (spell_effect.move:200 "else survives Dispel"; the F5 band forces negative alter rows dispellable), leaving
    // non-dispellable rows (STUN, etc.) intact. Move's `dispel_fighter` (spell_board.move:257, 0 callers) is the
    // coarse "strip all"; the flag-filtering cast-resolver arm rides the next train (declared, matrix-gated here).
    const stripped = update_entity(state, target_id, entity => ({
      ...entity,
      effects: entity.effects.filter(row => !has_flag(row, FLAG_DISPELLABLE)),
    }))
    return { state: stripped, effects: [{ target_id, status: 'DISPEL' }] }
  }
  if (effect.type === 'POISON') {
    if (effect.min === undefined || effect.max === undefined)
      return { state, effects: [] }
    const { state: s2, id } = next_id(state)
    const poisoned = add_effect(s2, target_id, {
      id,
      // `type: 'DAMAGE'` is deliberate — it rides the SAME tick machinery a plain damage-over-time row uses
      // (process_turn_effects only special-cases `type === 'DAMAGE'`), so the reducer never needs a parallel
      // POISON damage path. `dot: true` is the ONLY discriminant that survives to say "this DAMAGE row is a
      // Poison/K_APPLY_DOT status, not bookkeeping" — statuses.status_kind_of (#1211) reads it to badge the
      // row on the turn card/tooltip exactly like every other timed status, for a mob target same as a player.
      type: 'DAMAGE',
      dot: true,
      timing: 'TURN_START',
      source_id: caster.id,
      element: effect.element,
      // #1826 — THE BAND, NOT A DRAW. `spell_board::apply_dot` stores the authored Effect verbatim and the
      // chain rolls `[value, value_max]` at EVERY tick (`cast::apply_board_batch_from`); collapsing the band
      // to one apply-time `turn_rng` draw here made tick 2 onward a guaranteed desync on any ranged DoT.
      // Apply draws NOTHING (the chain's `apply_dot` consumes no entropy) — the roll moved to the tick door.
      value: effect.min,
      value_max: effect.max,
      ...row_flags(effect),
      turns_remaining: effect.turns ?? 1,
    })
    return { state: poisoned, effects: [{ target_id, status: 'POISON' }] }
  }
  if (
    effect.type === 'PUSH' ||
    effect.type === 'PULL' ||
    effect.type === 'GEOMETRIC_PUSH'
  ) {
    const geometric = effect.type === 'GEOMETRIC_PUSH'
    const distance = geometric
      ? zone_edge_distance(
          get_aoe_cells(effect, spell_target_cell, caster.cell),
          spell_target_cell,
          target.cell,
        )
      : (effect.distance ?? 1)
    const direction = geometric
      ? get_direction(spell_target_cell, target.cell)
      : effect.type === 'PUSH'
        ? get_direction(caster.cell, target.cell)
        : get_direction(target.cell, caster.cell)
    if (effect.type === 'PUSH' && distance <= 0) return { state, effects: [] }
    return handle_displacement(
      state,
      target_id,
      direction,
      distance,
      caster.level,
      terrain_walkable,
      (next_state, next_cell, displaced_id) =>
        check_traps(next_state, next_cell, displaced_id, terrain_walkable),
    )
  }
  if (effect.type === 'TELEPORT') {
    return {
      state: update_entity(state, target_id, e => ({
        ...e,
        cell: spell_target_cell,
      })),
      effects: [{ target_id, cell: spell_target_cell, has_cell: true }],
    }
  }
  if (effect.type === 'SWAP_POSITIONS') {
    // Caster and target trade cells ATOMICALLY (both Displaced) — the Pandawa swap (spell_effect.move:39). Both
    // cells were already occupied by fighters, so the exchange keeps occupancy consistent: a direct set of each
    // side (no slide, no body-block — a swap is not a walk). Emits the standard Displaced event for BOTH so the
    // render pipeline re-syncs both boards (mirrors TELEPORT's { target_id, cell, has_cell } shape).
    const caster_cell = caster.cell
    const target_cell = target.cell
    const swapped = update_entity(
      update_entity(state, target_id, e => ({ ...e, cell: caster_cell })),
      caster.id,
      e => ({ ...e, cell: target_cell }),
    )
    return {
      state: swapped,
      effects: [
        { target_id, cell: caster_cell, has_cell: true },
        { target_id: caster.id, cell: target_cell, has_cell: true },
      ],
    }
  }
  if (effect.type === 'CARRY') {
    // Pick the target up ONTO the caster's cell (co-location — the carried state; spell_effect.move:40). A direct
    // relocation like TELEPORT, NOT a pull: the caster's own body would block a slide into its cell, and the whole
    // point of a carry is that the carried fighter shares the carrier's cell. Standard Displaced event.
    return {
      state: update_entity(state, target_id, e => ({
        ...e,
        cell: caster.cell,
      })),
      effects: [{ target_id, cell: caster.cell, has_cell: true }],
    }
  }
  if (effect.type === 'THROW') {
    // Heave the (carried) target along the caster->target ray for `value` cells THROUGH the displacement module
    // (walkability, body-block, collision damage, trap check — the same idiom as PUSH). The declared Move semantic
    // is "throw the carried fighter to a target cell" (spell_effect.move:41), but that arm is unwired and the
    // corpus "target cell" is degenerate under the conformance matrix (target cell == victim cell), so the sim
    // lands the displacement-module minimum: a bounded value-distance throw that emits the standard Displaced event.
    const direction = get_direction(caster.cell, spell_target_cell)
    return handle_displacement(
      state,
      target_id,
      direction,
      effect.value ?? 1,
      caster.level,
      terrain_walkable,
      (next_state, next_cell, displaced_id) =>
        check_traps(next_state, next_cell, displaced_id, terrain_walkable),
    )
  }
  if (effect.type === 'INVISIBILITY') {
    const hidden = apply_invisibility(
      state,
      target_id,
      caster.id,
      effect.turns ?? 0,
      effect.flags ?? 0,
    )
    return {
      state: hidden,
      effects: hidden === state ? [] : [{ target_id, status: 'INVISIBILITY' }],
    }
  }
  if (effect.type === 'REVEAL') {
    return {
      state: reveal(state, target_id),
      effects: [{ target_id, status: 'REVEAL' }],
    }
  }
  return { state, effects: [] }
}
/**
 * Cast pipeline: validate, commit costs/history, then resolve the selected effect list.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} caster_id
 * @param {import('./spell_templates.js').SpellTemplate} spell
 * @param {number} level   1-based
 * @param {import('./cell.js').Cell} target
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @param {(cell: import('./cell.js').Cell) => boolean} [terrain_walkable]  terrain-only walkability (PUSH/PULL collisions); defaults to "all walkable" for tests
 * @returns {SpellCastResult}
 */
export const process_spell_cast = (
  state,
  caster_id,
  spell,
  level,
  target,
  context,
  terrain_walkable = () => true,
  turn_context = null, // #577 — {world_seed,spawn_id,turn_entropy,turn_ordinal,seat,slot}: the public player-cast clock.
) => {
  const validation = validate_cast(
    state,
    caster_id,
    spell,
    level,
    target,
    context,
  )
  if (!validation.valid || !validation.spell_level || !validation.caster) {
    return {
      success: false,
      error: validation.error,
      state,
      effects: [],
      caster_ap_remaining: find_entity(state, caster_id)?.ap ?? 0,
      is_critical: false,
    }
  }

  const { spell_level, caster } = validation
  const stack_target_id = find_entity_at(state, target)?.id
  const crit_bonus = effective_stats(caster).critical_hit ?? 0
  const clocked = !!(
    turn_context &&
    caster.is_player &&
    turn_context.slot != null
  )
  const tseed = clocked ? turn_seed(turn_context) : null
  const crit = clocked
    ? {
        value: crit_at(
          slot_crit_roll(tseed, turn_context.slot),
          spell_level.critical_chance,
          crit_bonus,
        ),
        rng: turn_rng_of(state),
      }
    : is_critical(turn_rng_of(state), spell_level.critical_chance, crit_bonus)
  const effect_list =
    crit.value &&
    spell_level.crit_effects &&
    spell_level.crit_effects.length > 0
      ? spell_level.crit_effects
      : spell_level.base_effects

  if (
    is_direct_effect_list(effect_list) &&
    invisible_enemy_at(state, caster_id, target)
  ) {
    return {
      success: false,
      error: 'INVISIBLE_TARGET',
      state,
      effects: [],
      caster_ap_remaining: caster.ap,
      is_critical: false,
      fumbled: false,
    }
  }
  const limit = check_spell_cast_limits(state, caster_id, spell.id, spell_level)
  if (!limit.valid) {
    return {
      success: false,
      error: limit.error,
      state,
      effects: [],
      caster_ap_remaining: caster.ap,
      is_critical: false,
      fumbled: false,
    }
  }
  // Player casts use a temporary stream derived from their public turn slot. Move's player arm never touches
  // the crank, so restore this independent combat thread before returning; mobs and board ticks continue from
  // exactly the state they would have seen had the player payload contained no random branches.
  const combat_rng = turn_rng_of(state)
  state = clocked
    ? with_turn_rng(state, dodge_seed(tseed, turn_context.slot))
    : with_turn_rng(state, crit.rng)
  // #577 — ONE per-cast damage roll: a PLAYER cast derives it from the public turn seed (the client mirrors it to
  // preview this turn's exact damage); a mob / turn-context-less cast reads the explicit combat thread.
  const damage_roll = clocked
    ? slot_damage_roll(tseed, turn_context.slot)
    : crank_damage_roll(turn_rng_of(state))
  const fumble = roll_fumble(
    state,
    caster,
    clocked ? { seed: tseed, slot: turn_context.slot } : null,
  )
  state = record_cast(fumble.state, caster_id, spell.id, spell_level, target)
  state = deduct_ap(state, caster_id, spell_level.cost)
  if (fumble.fumbled)
    return {
      success: true,
      state: clocked ? with_turn_rng(state, combat_rng) : state,
      effects: [{ target_id: caster_id, status: 'CRITICAL_FAILURE_FUMBLE' }],
      caster_ap_remaining: find_entity(state, caster_id)?.ap ?? 0,
      is_critical: false,
      fumbled: true,
    }

  // THE RETURN DOOR (spell_effect.move:61-64, resolved at cast.move:905-970). A wholly point-shaped cast aimed
  // at a living enemy holding a RETURN_SPELL row is turned around: normal target resolution is SKIPPED and the
  // cast's own damage lines land on its caster instead. AP is already spent and the cast already recorded — the
  // chain charges a returned cast in full too. DEPTH ONE, exactly as on chain: the returned hits go through the
  // raw HP sink, so they can never themselves be reflected, redirected, inverted or returned again.
  const returned = try_return_spell(
    state,
    caster,
    effect_list,
    target,
    damage_roll,
  )
  if (returned)
    return {
      success: true,
      state: clocked
        ? with_turn_rng(returned.state, combat_rng)
        : returned.state,
      effects: returned.effects,
      caster_ap_remaining: find_entity(returned.state, caster_id)?.ap ?? 0,
      is_critical: crit.value,
      fumbled: false,
    }

  const result = effect_list.reduce(
    (acc, effect) => {
      // ── CASTER-SIDE KIND: RECOIL (#1809) ────────────────────────────────────────────────────────────────
      // `cast.move::apply_effect` opens with `k_caster_damage` — it hits the CASTER for the flat authored
      // value through the raw sink and RETURNS: the zone is never walked, `target_filter` never consulted, the
      // proc roll never taken. Decoding kind 3 as an ordinary `DAMAGE` line (spell_templates.js keeps the
      // numeric `kind` precisely so this seam can tell them apart) sent it through the zone instead, so a mob
      // zone spell carrying a recoil row diverged twice: the chain debited the caster while the client debited
      // nobody, and the client debited every enemy in the zone while the chain debited none. Flat, raw,
      // unconditional — the same three properties `hit_player`/`hit_mob` have on chain.
      if (effect.kind === K_CASTER_DAMAGE) {
        const recoiled = apply_damage(acc.state, caster_id, effect.value ?? 0)
        return {
          ...acc,
          state: recoiled.state,
          effects: [
            ...acc.effects,
            {
              target_id: caster_id,
              damage: recoiled.damage_dealt,
              new_health: find_entity(recoiled.state, caster_id)?.health ?? 0,
              killed: recoiled.killed,
            },
          ],
        }
      }
      const aoe_cells = get_aoe_cells(effect, target, caster.cell)
      // A PLACEMENT keeps no cast direction — the chain stores (anchor, shape, size) and re-asks `in_zone` when
      // someone enters (#2177). Every other kind resolves NOW, off the cast zone above.
      if (effect.type === 'PLACE_TRAP') {
        const placed = place_trap(
          acc.state,
          caster_id,
          board_zone_cells(effect, target),
          effect.payload ?? [],
          target,
        )
        return {
          ...acc,
          state: placed,
          effects: [...acc.effects, { target_id: caster_id, status: 'TRAP' }],
        }
      }
      if (effect.type === 'GLYPH') {
        // Place regardless of element — payload glyphs (elementless) AND legacy element/min/max glyphs land;
        // the old element guard was the whole PLACE_GLYPH gap (every corpus glyph is payload-style, never fired).
        const placed = place_glyph(
          acc.state,
          caster_id,
          board_zone_cells(effect, target),
          effect.element,
          effect.min,
          effect.max,
          effect.turns ?? 1,
          effect.payload ?? [],
        )
        return {
          ...acc,
          state: placed,
          effects: [...acc.effects, { target_id: caster_id, status: 'GLYPH' }],
        }
      }
      const targets =
        effect.type === 'TELEPORT'
          ? [caster_id]
          : ((effect.target_filter ?? 0) & TF_ONLY_CASTER) === TF_ONLY_CASTER
            ? [caster_id]
            : [...acc.state.team0, ...acc.state.team1]
                .filter(
                  entity =>
                    entity.health > 0 &&
                    aoe_cells.some(
                      cell =>
                        cell.x === entity.cell.x && cell.y === entity.cell.y,
                    ) &&
                    effect_hits(
                      effect.type === 'GEOMETRIC_PUSH'
                        ? TF_NONE
                        : (effect.target_filter ?? 0),
                      entity.id === caster_id,
                      team_of(acc.state, entity.id) ===
                        team_of(acc.state, caster_id),
                    ),
                )
                .map(entity => entity.id)
      const inner = targets.reduce(
        (inner_acc, target_id) => {
          const res = apply_spell_effect(
            inner_acc.state,
            effect,
            caster,
            target_id,
            target,
            terrain_walkable,
            { spell_id: spell.id, stack_target_id },
            damage_roll,
          )
          return {
            state: res.state,
            effects: [...inner_acc.effects, ...res.effects],
            direct_damage:
              inner_acc.direct_damage || (res.direct_damage ?? 0) > 0,
          }
        },
        {
          state: acc.state,
          effects: /** @type {SpellCastEffect[]} */ ([]),
          direct_damage: false,
        },
      )
      return {
        state: inner.state,
        effects: [...acc.effects, ...inner.effects],
        direct_damage: acc.direct_damage || inner.direct_damage,
      }
    },
    {
      state,
      effects: /** @type {SpellCastEffect[]} */ ([]),
      direct_damage: false,
    },
  )

  let final_state = result.direct_damage
    ? reveal(result.state, caster_id)
    : result.state
  if (clocked) final_state = with_turn_rng(final_state, combat_rng)

  return {
    success: true,
    state: final_state,
    effects: result.effects,
    caster_ap_remaining: find_entity(final_state, caster_id)?.ap ?? 0,
    is_critical: crit.value,
    fumbled: false,
  }
}
