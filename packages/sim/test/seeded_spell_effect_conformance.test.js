// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { reduce } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import * as spell_effect from '../src/spell_effect.js'

import {
  active,
  arena,
  fighter,
  raw_effect,
  state_of,
} from './missing_effect_helpers.js'
import {
  ALLY_CELL,
  ALLY_ID,
  CASTER_CELL,
  CASTER_ID,
  EMPTY_CELL,
  ENEMY_CELL,
  ENEMY_ID,
  MISSING_CORPUS_REASON,
  kind_name,
  matrix_rows,
  source_kinds,
} from './seeded_spell_effect_conformance_matrix.js'
import {
  CORPUS,
  SPELLS_CORPUS_AVAILABLE,
} from './spell_effect_conformance_matrix.js'

const defined = entries =>
  Object.fromEntries(entries.filter(([, value]) => value !== undefined))

const payload_projection = effect =>
  defined([
    ['kind', effect.kind],
    ['type', effect.type],
    ['value', effect.value],
    ['min', effect.min],
    ['max', effect.max],
    ['element', effect.element],
    ['distance', effect.distance],
    ['target_filter', effect.target_filter],
  ])

const active_projection = effect =>
  defined([
    ['type', effect.type],
    ['timing', effect.timing],
    ['source_id', effect.source_id],
    ['element', effect.element],
    ['value', effect.value],
    ['stat', effect.stat],
    ['flags', effect.flags],
    ['chance', effect.chance],
    ['heal_multiplier', effect.heal_multiplier],
    ['trigger_turns', effect.trigger_turns],
    ['spell_id', effect.spell_id],
    ['payload', effect.payload?.map(payload_projection)],
    ['turns_remaining', effect.turns_remaining],
  ])

const entity_projection = entity => ({
  id: entity.id,
  name: entity.name,
  cell: entity.cell,
  health: entity.health,
  health_max: entity.health_max,
  ap: entity.ap,
  ap_max: entity.ap_max,
  mp: entity.mp,
  mp_max: entity.mp_max,
  ap_used: entity.ap_used,
  mp_used: entity.mp_used,
  is_player: entity.is_player,
  template_id: entity.template_id,
  level: entity.level,
  stats: entity.stats,
  effects: entity.effects.map(active_projection),
  ap_reserve: entity.ap_reserve,
})

const hazard_projection = hazard =>
  defined([
    ['source_id', hazard.source_id],
    ['cells', hazard.cells],
    ['payload', hazard.payload?.map(payload_projection)],
    ['anchor', hazard.anchor],
    ['element', hazard.element],
    ['min', hazard.min],
    ['max', hazard.max],
    ['turns_remaining', hazard.turns_remaining],
  ])

const state_projection = state => ({
  fighters: Object.fromEntries(
    [...state.team0, ...state.team1].map(entity => [
      entity.id,
      entity_projection(entity),
    ]),
  ),
  traps: state.traps.map(hazard_projection),
  glyphs: state.glyphs.map(hazard_projection),
  current_turn_idx: state.current_turn_idx,
  turn_number: state.turn_number,
  winner: state.winner,
})

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const object_delta = (before, after) =>
  Object.fromEntries(
    Object.entries(after).filter(([key, value]) => !same(value, before[key])),
  )

const state_delta = (before, after) => {
  const before_projection = state_projection(before)
  const after_projection = state_projection(after)
  const fighter_deltas = Object.fromEntries(
    Object.entries(after_projection.fighters)
      .map(([id, entity]) => [
        id,
        object_delta(before_projection.fighters[id], entity),
      ])
      .filter(([, delta]) => Object.keys(delta).length > 0),
  )
  return defined([
    [
      'fighters',
      Object.keys(fighter_deltas).length > 0 ? fighter_deltas : undefined,
    ],
    [
      'traps',
      same(before_projection.traps, after_projection.traps)
        ? undefined
        : after_projection.traps,
    ],
    [
      'glyphs',
      same(before_projection.glyphs, after_projection.glyphs)
        ? undefined
        : after_projection.glyphs,
    ],
    [
      'current_turn_idx',
      before_projection.current_turn_idx === after_projection.current_turn_idx
        ? undefined
        : after_projection.current_turn_idx,
    ],
    [
      'turn_number',
      before_projection.turn_number === after_projection.turn_number
        ? undefined
        : after_projection.turn_number,
    ],
    [
      'winner',
      before_projection.winner === after_projection.winner
        ? undefined
        : after_projection.winner,
    ],
  ])
}

const setup_state = row => {
  const geometric = row.layout === 'geometric'
  const caster = fighter(
    CASTER_ID,
    geometric ? { x: 4, y: 4 } : CASTER_CELL,
    true,
    { health: 100, health_max: 200 },
  )
  const ally = fighter(ALLY_ID, geometric ? { x: 7, y: 7 } : ALLY_CELL, true, {
    health: 50,
    health_max: 100,
  })
  const enemy = fighter(
    ENEMY_ID,
    geometric ? { x: 4, y: 3 } : ENEMY_CELL,
    false,
  )
  const base_state = state_of([caster, ally], [enemy])
  if (row.setup === 'reset_positions')
    return {
      ...base_state,
      team0: base_state.team0.map(entity => ({
        ...entity,
        cell: entity.id === CASTER_ID ? { x: 3, y: 2 } : entity.cell,
      })),
      team1: base_state.team1.map(entity => ({
        ...entity,
        cell: { x: 5, y: 2 },
      })),
    }
  if (row.setup === 'reveal')
    return {
      ...base_state,
      team1: base_state.team1.map(entity => ({
        ...entity,
        effects: [active('INVISIBILITY', { id: 90, turns_remaining: 3 })],
      })),
    }
  if (row.setup === 'dispel' || row.setup === 'remove_state')
    return {
      ...base_state,
      team1: base_state.team1.map(entity => ({
        ...entity,
        effects:
          row.setup === 'dispel'
            ? [
                active('STAT_DEBUFF', {
                  id: 90,
                  value: 5,
                  stat: 'strength',
                  flags: spell_effect.FLAG_DISPELLABLE,
                  turns_remaining: 3,
                }),
                active('STUN', { id: 91, flags: 0, turns_remaining: 3 }),
              ]
            : [
                active('APPLY_STATE', {
                  id: 90,
                  value: 7,
                  turns_remaining: 3,
                }),
                active('STUN', { id: 91, flags: 0, turns_remaining: 3 }),
              ],
      })),
    }
  return base_state
}

const target_cell = (row, state) => {
  if (row.target === 'self') return find_entity(state, CASTER_ID).cell
  if (row.target === 'ally') return find_entity(state, ALLY_ID).cell
  if (row.target === 'empty') return EMPTY_CELL
  return find_entity(state, ENEMY_ID).cell
}

const representative_effects = row =>
  row.effects ?? [
    raw_effect(row.kind, {
      value: 12,
      element: 2,
      target_filter: spell_effect.TF_NOT_TEAM,
      chance: 100,
      turns: 2,
      ...row.effect,
    }),
  ]

const fixture_of = row => {
  const spell_id = `matrix_${row.kind}`
  const prepared = setup_state(row)
  const state = {
    ...prepared,
    current_turn_idx: 0,
    team0: prepared.team0.map(entity =>
      entity.id === CASTER_ID
        ? {
            ...entity,
            hand: [spell_id],
            spell_levels: { [spell_id]: 1 },
          }
        : entity,
    ),
  }
  const spell_templates = normalize_spell_templates([
    {
      id: spell_id,
      levels: [
        {
          ap_cost: 0,
          range_min: 0,
          range_max: 12,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: row.target === 'empty',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: representative_effects(row),
          crit_effects: [],
        },
      ],
    },
  ])
  return {
    state,
    command: {
      type: 'cast',
      entity_id: CASTER_ID,
      spell_id,
      target: target_cell(row, state),
    },
    context: { spell_templates, arena },
  }
}

describe('seeded spell-effect conformance matrix', () => {
  test('has exactly one contract row for every source effect kind', () => {
    const row_kinds = matrix_rows.map(row => row.kind).toSorted((a, b) => a - b)
    expect(row_kinds).toEqual(source_kinds.map(([, kind]) => kind))
    expect(new Set(row_kinds).size).toBe(matrix_rows.length)
  })

  for (const row of matrix_rows) {
    test.skipIf(row.skip_reason !== undefined)(
      `${kind_name(row.kind)} applies only its declared combat delta${
        row.skip_reason ? ` — quarantined: ${row.skip_reason}` : ''
      }`,
      () => {
        const fixture = fixture_of(row)
        const input_snapshot = JSON.stringify(fixture.state)
        const result = reduce(fixture.state, fixture.command, fixture.context)
        const replay = reduce(fixture.state, fixture.command, fixture.context)
        const cast_event = result.events.find(
          event => event.type === 'fight_cast',
        )

        expect(
          cast_event,
          `${kind_name(row.kind)} cast was rejected`,
        ).toBeTruthy()
        expect(state_delta(fixture.state, result.state)).toEqual(row.contract)
        expect(result).toEqual(replay)
        expect(JSON.stringify(fixture.state)).toBe(input_snapshot)
      },
    )
  }

  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    `real seeded corpus declares no effect kind outside the matrix — ${MISSING_CORPUS_REASON}`,
    () => {
      const matrix_kinds = new Set(matrix_rows.map(row => row.kind))
      const corpus_kinds = CORPUS.flatMap(spell => spell.levels ?? [])
        .flatMap(level => [
          ...(level.effects ?? level.base_effects ?? []),
          ...(level.crit_effects ?? level.critical_effects ?? []),
        ])
        .map(effect => effect.kind)
        .filter(kind => typeof kind === 'number')
      expect(corpus_kinds.every(kind => matrix_kinds.has(kind))).toBe(true)
    },
  )
})
