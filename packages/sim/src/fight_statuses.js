// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight-status semantics over immutable ActiveEffect rows.
//
// AresRPG 1.29 brand law: kind 27 is authoritative invisibility; enemies cannot directly select a hidden
// fighter, but point-free/AoE casts remain cell-resolved and hit hidden occupants normally. Directness is read
// from the selected normal/critical list: at least one fighter-resolving effect, all such effects point-shaped.
// With no trustworthy last-known-cell state, AI ignores hidden targets and idles when none remain. Only positive
// immediate cast/weapon/displacement-collision damage reveals its damager; recoil and trap/glyph/DoT damage do
// not. Reveal strips every invisibility row and preserves all riders and unrelated statuses.

import {
  find_entity,
  find_entity_at,
  next_id,
  team_of,
  update_entity,
} from './fight_state.js'
import {
  K_CASTER_DAMAGE,
  K_PLACE_GLYPH,
  K_PLACE_TRAP,
  K_TELEPORT,
  row_flags,
  SHAPE_POINT,
} from './spell_effect.js'

/** @param {import('./fight_state.js').FightEntity} entity */
export const is_invisible = entity =>
  entity.effects.some(effect => effect.type === 'INVISIBILITY')

/** @param {import('./fight_state.js').FightState} state @param {string} entity_id */
export const fighter_is_invisible = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  return entity !== null && is_invisible(entity)
}

/**
 * Does `entity_id` currently HOLD the named state `state_id`? A named state lives as an APPLY_STATE row whose
 * `value` is the state id — the sim twin of `spell_board::fighter_has_state` (kind == k_apply_state &&
 * effect.value == state_id). ONE home: both the required/forbidden cast gate and REMOVE_STATE read states here.
 * @param {import('./fight_state.js').FightState} state @param {string} entity_id @param {number} state_id
 */
export const fighter_has_state = (state, entity_id, state_id) => {
  const entity = find_entity(state, entity_id)
  return (
    entity !== null &&
    entity.effects.some(
      effect => effect.type === 'APPLY_STATE' && effect.value === state_id,
    )
  )
}

/** Drop every APPLY_STATE row naming `state_id`, preserving unrelated rows. Twin of the Move board's state clear. */
export const clear_fighter_state = (state, entity_id, state_id) =>
  update_entity(state, entity_id, entity => ({
    ...entity,
    effects: entity.effects.filter(
      effect => !(effect.type === 'APPLY_STATE' && effect.value === state_id),
    ),
  }))

/** Remove every invisibility row from one fighter and nothing else. */
export const reveal = (state, entity_id) =>
  update_entity(state, entity_id, entity => ({
    ...entity,
    effects: entity.effects.filter(effect => effect.type !== 'INVISIBILITY'),
  }))

/** Attach a timed invisibility row to either a participant or mob. `flags` is the authoring effect's word — an
 *  invisibility row is `record_timed`-stored whole on chain, so a dispellable one must stay dispellable here. */
export const apply_invisibility = (
  state,
  target_id,
  source_id,
  turns,
  flags = 0,
) => {
  const duration = Math.max(0, Math.floor(turns))
  if (duration === 0) return state
  const allocated = next_id(state)
  return update_entity(allocated.state, target_id, entity => ({
    ...entity,
    effects: [
      ...entity.effects,
      {
        id: allocated.id,
        type: /** @type {const} */ ('INVISIBILITY'),
        timing: /** @type {const} */ ('TURN_START'),
        source_id,
        value: 0,
        ...row_flags({ flags }),
        turns_remaining: duration,
      },
    ],
  }))
}

const fighter_resolving = effect =>
  effect.kind !== K_CASTER_DAMAGE &&
  effect.kind !== K_TELEPORT &&
  effect.kind !== K_PLACE_TRAP &&
  effect.kind !== K_PLACE_GLYPH &&
  effect.type !== 'TELEPORT' &&
  effect.type !== 'PLACE_TRAP' &&
  effect.type !== 'GLYPH'

/** Match Move's selected-list directness rule. */
export const is_direct_effect_list = effects => {
  let selects_fighter = false
  for (const effect of effects) {
    if (!fighter_resolving(effect)) continue
    selects_fighter = true
    if ((effect.area_shape ?? SHAPE_POINT) !== SHAPE_POINT) return false
  }
  return selects_fighter
}

/** Does the target cell hold a living invisible enemy of the caster? */
export const invisible_enemy_at = (state, caster_id, target_cell) => {
  const target = find_entity_at(state, target_cell)
  if (!target || !is_invisible(target)) return false
  return team_of(state, target.id) !== team_of(state, caster_id)
}

/**
 * The RETURN_SPELL row shielding a living ENEMY standing on `target_cell`, or null. The twin of the chain's
 * `return_target` + `fighter_status_of(k_return_spell)` pair (cast.move:905-931): only an ENEMY's row can turn a
 * cast around — a self- or ally-aimed cast never traverses the door, so a fighter can never return a spell onto
 * itself. The pure DECISION only; the caller owns the redirect.
 * @param {import('./fight_state.js').FightState} state @param {string} caster_id
 * @param {import('./cell.js').Cell} target_cell
 */
export const returning_enemy_at = (state, caster_id, target_cell) => {
  const target = find_entity_at(state, target_cell)
  if (!target || target.health <= 0) return null
  if (team_of(state, target.id) === team_of(state, caster_id)) return null
  return target.effects.find(effect => effect.type === 'RETURN_SPELL') ?? null
}
