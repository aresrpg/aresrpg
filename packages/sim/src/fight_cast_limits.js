// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cast cooldown/count bookkeeping, split from the spell resolver so each engine module stays below 600 lines.

import { CASTS_UNLIMITED } from './spell_templates.js'

const cast_limit_key = (entity_id, spell_id) => `${entity_id}:${spell_id}`
const target_limit_key = (entity_id, spell_id, cell) =>
  `${entity_id}:${spell_id}:${cell.x},${cell.y}`

/**
 * Pure read of the spell-wide half of Move `enforce_and_record_cast`: cooldown first, then per-turn.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {string} spell_id
 * @param {import('./spell_templates.js').SpellLevel} spell_level
 * @returns {{ valid: boolean, error?: string }}
 */
export const check_spell_cast_limits = (
  state,
  entity_id,
  spell_id,
  spell_level,
) => {
  const cooldown = spell_level.cooldown_turns
  const per_turn = spell_level.casts_per_turn
  const track_spell = cooldown > 0 || per_turn !== CASTS_UNLIMITED
  if (!track_spell) return { valid: true }

  const turn = state.turn_number
  const record = (state.cast_history ?? {})[cast_limit_key(entity_id, spell_id)]
  if (record) {
    const this_turn = record.last_turn === turn ? record.casts_this_turn : 0
    if (cooldown > 0 && !(turn - record.last_turn > cooldown))
      return { valid: false, error: 'SPELL_ON_COOLDOWN' }
    if (!(this_turn < per_turn))
      return { valid: false, error: 'CASTS_PER_TURN' }
  }
  return { valid: true }
}

/**
 * The per-target fact consumed by `spell_targeting.can_target`. Move cast.move:424-429/456-461.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {string} spell_id
 * @param {import('./spell_templates.js').SpellLevel} spell_level
 * @param {import('./cell.js').Cell} target
 */
const target_cap_reached = (
  state,
  entity_id,
  spell_id,
  spell_level,
  target,
) => {
  const per_target = spell_level.casts_per_target
  if (per_target === CASTS_UNLIMITED) return false
  const record = (state.target_history ?? {})[
    target_limit_key(entity_id, spell_id, target)
  ]
  if (!record) return false
  const this_target = record.last_turn === state.turn_number ? record.casts : 0
  return !(this_target < per_target)
}

/** Pure compatibility composition for readers that need the full cast-limit verdict. */
export const check_cast_limits = (
  state,
  entity_id,
  spell_id,
  spell_level,
  target,
) => {
  const spell_limit = check_spell_cast_limits(
    state,
    entity_id,
    spell_id,
    spell_level,
  )
  if (!spell_limit.valid) return spell_limit
  return target_cap_reached(state, entity_id, spell_id, spell_level, target)
    ? { valid: false, error: 'CASTS_PER_TARGET' }
    : { valid: true }
}

/**
 * Write half of the cast-limit twin. Called only after every read-only cast gate succeeds.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {string} spell_id
 * @param {import('./spell_templates.js').SpellLevel} spell_level
 * @param {import('./cell.js').Cell} target
 * @returns {import('./fight_state.js').FightState}
 */
export const record_cast = (
  state,
  entity_id,
  spell_id,
  spell_level,
  target,
) => {
  const cooldown = spell_level.cooldown_turns
  const per_turn = spell_level.casts_per_turn
  const per_target = spell_level.casts_per_target
  const track_spell = cooldown > 0 || per_turn !== CASTS_UNLIMITED
  const track_target = per_target !== CASTS_UNLIMITED
  if (!track_spell && !track_target) return state

  const turn = state.turn_number
  let cast_history = state.cast_history ?? {}
  let target_history = state.target_history ?? {}
  if (track_spell) {
    const key = cast_limit_key(entity_id, spell_id)
    const record = cast_history[key]
    const this_turn =
      record && record.last_turn === turn ? record.casts_this_turn : 0
    cast_history = {
      ...cast_history,
      [key]: { last_turn: turn, casts_this_turn: this_turn + 1 },
    }
  }
  if (track_target) {
    const key = target_limit_key(entity_id, spell_id, target)
    const record = target_history[key]
    const this_target = record && record.last_turn === turn ? record.casts : 0
    target_history = {
      ...target_history,
      [key]: { last_turn: turn, casts: this_target + 1 },
    }
  }
  return { ...state, cast_history, target_history }
}
