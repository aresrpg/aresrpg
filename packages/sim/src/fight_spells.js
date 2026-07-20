import { rng_range } from './prng.js'
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
  apply_incoming_damage,
  apply_heal,
  add_effect,
  consume_shields,
} from './fight_actions.js'
import { get_aoe_cells, can_target, effect_hits } from './spell_targeting.js'
import { check_cast_limits, record_cast } from './fight_cast_limits.js'
import {
  handle_displacement,
  get_direction,
  zone_edge_distance,
} from './fight_displacement.js'
import { check_traps, place_trap, place_glyph } from './fight_traps.js'
import { summon_entity } from './fight_summon.js'
import {
  calculate_final_damage,
  calculate_heal,
  effect_triggers,
  is_critical,
} from './spell_calculator.js'
import {
  apply_invisibility,
  invisible_enemy_at,
  is_direct_effect_list,
  reveal,
} from './fight_statuses.js'
import {
  FLAG_DISPELLABLE,
  FLAG_LIFE_LOST,
  has_flag,
  K_CASTER_DAMAGE,
  TF_NONE,
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
  const range_bonus = effective_stats(caster).range ?? 0
  if (!can_target(spell_level, caster.cell, target, context, range_bonus))
    return { valid: false, error: 'INVALID_TARGET' }
  if (
    spell_level.base_effects.some(e => e.type === 'PLACE_TRAP') &&
    state.traps.some(
      t => t.anchor && t.anchor.x === target.x && t.anchor.y === target.y,
    )
  )
    return { valid: false, error: 'CELL_TRAPPED' }
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
) => {
  const trigger = effect_triggers(state.rng, effect)
  state = { ...state, rng: trigger.rng }
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
    const damage_effect = named_bonus
      ? {
          ...effect,
          min: (effect.min ?? 0) + named_bonus,
          max: (effect.max ?? 0) + named_bonus,
        }
      : effect
    const shields = target.effects.filter(e => e.type === 'SHIELD')
    const dmg = calculate_final_damage(
      state.rng,
      /** @type {any} */ (damage_effect),
      effective_stats(caster),
      effective_stats(target),
      caster.level,
      shields,
    )
    const after = apply_incoming_damage(
      { ...state, rng: dmg.rng },
      target_id,
      dmg.damage,
      caster.id,
    )
    const after_shields = consume_shields(
      after.state,
      target_id,
      dmg.shields_consumed,
    )
    return {
      state: after_shields,
      direct_damage: effect.kind === K_CASTER_DAMAGE ? 0 : after.damage_dealt,
      effects: hit_result_effects(after_shields, after, target_id),
    }
  }
  if (effect.type === 'PERCENT_LIFE_DAMAGE') {
    // A fraction of the HP POOL (current, or missing under FLAG_LIFE_LOST); deterministic — no amp/variance/resist. cast.move:564-570.
    const pool = has_flag(effect, FLAG_LIFE_LOST)
      ? target.health_max - target.health
      : target.health
    const damage = Math.floor((pool * (effect.value ?? 0)) / 100)
    const after = apply_incoming_damage(state, target_id, damage, caster.id)
    return {
      state: after.state,
      direct_damage: after.damage_dealt,
      effects: hit_result_effects(after.state, after, target_id),
    }
  }
  if (effect.type === 'HEAL') {
    const h = calculate_heal(
      state.rng,
      /** @type {any} */ (effect),
      effective_stats(caster),
    )
    const after = apply_heal({ ...state, rng: h.rng }, target_id, h.value)
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
      state.rng,
      /** @type {any} */ ({
        ...effect,
        type: 'DAMAGE',
        min: (effect.min ?? 0) + named_bonus,
        max: (effect.max ?? 0) + named_bonus,
      }),
      effective_stats(caster),
      effective_stats(target),
      caster.level,
      target.effects.filter(e => e.type === 'SHIELD'),
    )
    const after_dmg = apply_incoming_damage(
      { ...state, rng: dmg.rng },
      target_id,
      dmg.damage,
      caster.id,
    )
    const after_shields = consume_shields(
      after_dmg.state,
      target_id,
      dmg.shields_consumed,
    )
    const healed = apply_heal(
      after_shields,
      caster.id,
      Math.floor(after_dmg.damage_dealt / 2),
    )
    return {
      state: healed,
      direct_damage: after_dmg.damage_dealt,
      effects: hit_result_effects(healed, after_dmg, target_id),
    }
  }
  if (effect.type === 'SHIELD') {
    if (effect.min === undefined || effect.max === undefined)
      return { state, effects: [] }
    const { state: s2, id } = next_id(state)
    const draw = rng_range(s2.rng, effect.min, effect.max)
    const shielded = add_effect({ ...s2, rng: draw.state }, target_id, {
      id,
      type: 'SHIELD',
      timing: 'TURN_START',
      source_id: caster.id,
      element: effect.element,
      value: draw.value,
      turns_remaining: effect.turns ?? 1,
    })
    return { state: shielded, effects: [{ target_id, status: 'SHIELD' }] }
  }
  if (effect.type === 'STUN') {
    const { state: s2, id } = next_id(state)
    const stunned = add_effect(s2, target_id, {
      id,
      type: 'STUN',
      timing: 'TURN_START',
      source_id: caster.id,
      value: 0,
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
      turns_remaining: effect.turns ?? 1,
    })
    return { state: stated, effects: [{ target_id, status: 'APPLY_STATE' }] }
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
      turns_remaining: effect.turns ?? 1,
    })
    return { state: reflected, effects: [{ target_id, status: 'REFLECT_DAMAGE' }] }
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
    const draw = rng_range(s2.rng, effect.min, effect.max)
    const poisoned = add_effect({ ...s2, rng: draw.state }, target_id, {
      id,
      type: 'DAMAGE',
      timing: 'TURN_START',
      source_id: caster.id,
      element: effect.element,
      value: draw.value,
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
    return handle_displacement(
      state,
      target_id,
      direction,
      distance,
      caster.level,
      terrain_walkable,
      (next_state, next_cell, displaced_id) =>
        check_traps(next_state, next_cell, displaced_id, terrain_walkable),
      caster.id,
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
      state: update_entity(state, target_id, e => ({ ...e, cell: caster.cell })),
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
      caster.id,
    )
  }
  if (effect.type === 'INVISIBILITY') {
    const hidden = apply_invisibility(
      state,
      target_id,
      caster.id,
      effect.turns ?? 0,
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
  const crit = is_critical(state.rng, spell_level.critical_chance, crit_bonus)
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
  const limit = check_cast_limits(
    state,
    caster_id,
    spell.id,
    spell_level,
    target,
  )
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
  const fumble = roll_fumble({ ...state, rng: crit.rng }, caster)
  state = record_cast(fumble.state, caster_id, spell.id, spell_level, target)
  state = deduct_ap(state, caster_id, spell_level.cost)
  if (fumble.fumbled)
    return {
      success: true,
      state,
      effects: [{ target_id: caster_id, status: 'CRITICAL_FAILURE_FUMBLE' }],
      caster_ap_remaining: find_entity(state, caster_id)?.ap ?? 0,
      is_critical: false,
      fumbled: true,
    }

  const result = effect_list.reduce(
    (acc, effect) => {
      const aoe_cells = get_aoe_cells(effect, target, caster.cell)
      if (effect.type === 'PLACE_TRAP') {
        const placed = place_trap(
          acc.state,
          caster_id,
          aoe_cells,
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
          aoe_cells,
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
      if (effect.type === 'SUMMON') {
        const summoned = summon_entity(
          acc.state,
          caster,
          target,
          terrain_walkable,
          effect.summon ?? '',
        )
        return {
          ...acc,
          state: summoned.state,
          effects: [...acc.effects, ...summoned.effects],
        }
      }
      const targets =
        effect.type === 'TELEPORT'
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

  const final_state = result.direct_damage
    ? reveal(result.state, caster_id)
    : result.state

  return {
    success: true,
    state: final_state,
    effects: result.effects,
    caster_ap_remaining: find_entity(final_state, caster_id)?.ap ?? 0,
    is_critical: crit.value,
    fumbled: false,
  }
}
