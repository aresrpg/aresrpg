// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Reducer-only sequencing for the effects-application oracle.

import { find_entity } from '../src/fight_state.js'
import { reduce } from '../src/reduce.js'

import { arena, fighter, spell_of, state_of } from './missing_effect_helpers.js'

export const CASTER = 'p0'
export const ENEMY = 'm0'
export const CASTER_CELL = { x: 1, y: 1 }
export const ENEMY_CELL = { x: 4, y: 1 }

const with_level_contract = (template, definition) => ({
  ...template,
  levels: template.levels.map(level => ({
    ...level,
    required_states: definition.required_states ?? [],
    forbidden_states: definition.forbidden_states ?? [],
  })),
})

/**
 * Minimal live fight: two units, the caster's turn, and the supplied spells known by both units.
 * @param {{ id: string, effects: object[], ap_cost?: number, range_max?: number,
 *   modifiable_range?: boolean, required_states?: number[], forbidden_states?: number[] }[]} definitions
 * @param {{ p0?: number, m0?: number, p0_stats?: object, m0_stats?: object }} [health]
 */
export const fight = (definitions, health = {}) => {
  const spell_levels = Object.fromEntries(
    definitions.map(definition => [definition.id, 1]),
  )
  const with_spells = entity => ({ ...entity, spell_levels })
  const caster = with_spells(
    fighter(CASTER, CASTER_CELL, true, {
      health: health.p0 ?? 100,
      health_max: 200,
      stats: health.p0_stats ?? {},
    }),
  )
  const enemy = with_spells(
    fighter(ENEMY, ENEMY_CELL, false, {
      health: health.m0 ?? 100,
      health_max: 100,
      stats: health.m0_stats ?? {},
    }),
  )
  const base = state_of([caster], [enemy])
  return {
    state: { ...base, current_turn_idx: 0 },
    ctx: {
      spell_templates: new Map(
        definitions.map(definition => {
          const template = spell_of(definition.id, definition.effects, {
            ap_cost: definition.ap_cost ?? 0,
            range_max: definition.range_max ?? 8,
            modifiable_range: definition.modifiable_range ?? false,
          })
          return [definition.id, with_level_contract(template, definition)]
        }),
      ),
      arena,
    },
  }
}

export const cast = ({ state, ctx }, spell_id, target, entity_id = CASTER) => {
  const result = reduce(
    state,
    { type: 'cast', entity_id, spell_id, target },
    ctx,
  )
  return {
    state: result.state,
    ctx,
    events: result.events,
    accepted: result.events.some(event => event.type === 'fight_cast'),
  }
}

export const walk = ({ state, ctx }, destination, entity_id = CASTER) => {
  const result = reduce(
    state,
    { type: 'move', entity_id, path: [destination] },
    ctx,
  )
  return {
    state: result.state,
    ctx,
    events: result.events,
    accepted: result.events.some(event => event.type === 'fight_moved'),
  }
}

export const end_turn = ({ state, ctx }) => {
  const entity_id = state.turn_order[state.current_turn_idx]
  const result = reduce(state, { type: 'end_turn', entity_id }, ctx)
  return { state: result.state, ctx, events: result.events }
}

export const turn_to = (
  fight_state,
  entity_id,
  turns_left = fight_state.state.turn_order.length + 1,
) => {
  const current =
    fight_state.state.turn_order[fight_state.state.current_turn_idx]
  if (current === entity_id) return fight_state
  if (turns_left === 0)
    throw new Error(`turn_to: the fight never reached ${entity_id}`)
  return turn_to(end_turn(fight_state), entity_id, turns_left - 1)
}

export const advance_rounds = (fight_state, entity_id, count) =>
  count === 0
    ? fight_state
    : advance_rounds(
        turn_to(end_turn(fight_state), entity_id),
        entity_id,
        count - 1,
      )

export const entity = ({ state }, id) => find_entity(state, id)
export const hp = (fight_state, id) => entity(fight_state, id)?.health ?? 0
export const pool = (fight_state, id, key) =>
  entity(fight_state, id)?.[key] ?? 0
export const rows = (fight_state, id) => entity(fight_state, id)?.effects ?? []
export const cell = (fight_state, id) => entity(fight_state, id)?.cell

export const damage_taken = (before, after, id = ENEMY) =>
  hp(before, id) - hp(after, id)

export const with_cell = (fight_state, id, next_cell) => ({
  ...fight_state,
  state: {
    ...fight_state.state,
    team0: fight_state.state.team0.map(entity_row =>
      entity_row.id === id ? { ...entity_row, cell: next_cell } : entity_row,
    ),
    team1: fight_state.state.team1.map(entity_row =>
      entity_row.id === id ? { ...entity_row, cell: next_cell } : entity_row,
    ),
  },
})
