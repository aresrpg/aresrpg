// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import * as spell_effect from '../src/spell_effect.js'

import { raw_effect } from './missing_effect_helpers.js'

export const CASTER_ID = 'p0'
export const ALLY_ID = 'p1'
export const ENEMY_ID = 'm0'
export const CASTER_CELL = { x: 2, y: 2 }
export const ALLY_CELL = { x: 2, y: 5 }
export const ENEMY_CELL = { x: 4, y: 2 }
export const EMPTY_CELL = { x: 6, y: 6 }
export const MISSING_CORPUS_REASON =
  'seed/mainnet/spells is private generated corpus data and is absent from the public repository'

export const source_kinds = Object.entries(spell_effect)
  .filter(([name, value]) => name.startsWith('K_') && typeof value === 'number')
  .toSorted(([, left], [, right]) => left - right)

export const kind_name = kind =>
  source_kinds.find(([, value]) => value === kind)?.[0] ?? `K_${kind}`

const status = (type, value, overrides = {}) => ({
  type,
  timing: 'TURN_START',
  source_id: CASTER_ID,
  value,
  ...overrides,
})

const effect_row = (kind, contract, overrides = {}) => ({
  kind,
  contract,
  target: 'enemy',
  effect: {},
  ...overrides,
})

export const matrix_rows = [
  effect_row(spell_effect.K_DAMAGE, {
    fighters: { [ENEMY_ID]: { health: 88 } },
  }),
  effect_row(
    spell_effect.K_PERCENT_LIFE_DAMAGE,
    { fighters: { [ENEMY_ID]: { health: 80 } } },
    { effect: { value: 20 } },
  ),
  effect_row(spell_effect.K_LIFE_STEAL, {
    fighters: {
      [CASTER_ID]: { health: 106 },
      [ENEMY_ID]: { health: 88 },
    },
  }),
  effect_row(
    spell_effect.K_CASTER_DAMAGE,
    { fighters: { [CASTER_ID]: { health: 88 } } },
    { target: 'self', effect: { target_filter: spell_effect.TF_ONLY_CASTER } },
  ),
  effect_row(spell_effect.K_PUNISHMENT_DAMAGE, {
    fighters: { [ENEMY_ID]: { health: 88 } },
  }),
  effect_row(
    spell_effect.K_HEAL,
    { fighters: { [ALLY_ID]: { health: 62 } } },
    { target: 'ally', effect: { target_filter: spell_effect.TF_NOT_ENEMY } },
  ),
  effect_row(
    spell_effect.K_GIVE_POINTS,
    {
      fighters: {
        [ALLY_ID]: {
          ap: 12,
          effects: [status('STAT_BUFF', 2, { stat: 'ap', turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'ally',
      effect: {
        target_filter: spell_effect.TF_NOT_ENEMY,
        stat: spell_effect.POINT_AP,
        value: 2,
      },
    },
  ),
  effect_row(
    spell_effect.K_REMOVE_POINTS,
    {
      fighters: {
        [ENEMY_ID]: {
          mp: 4,
          effects: [
            status('STAT_DEBUFF', 2, { stat: 'mp', turns_remaining: 2 }),
          ],
        },
      },
    },
    { effect: { stat: spell_effect.POINT_MP, value: 2 } },
  ),
  effect_row(
    spell_effect.K_STEAL_POINTS,
    {
      fighters: {
        [CASTER_ID]: { ap: 12 },
        [ENEMY_ID]: {
          ap: 8,
          effects: [
            status('STAT_DEBUFF', 2, { stat: 'ap', turns_remaining: 2 }),
          ],
        },
      },
    },
    { effect: { stat: spell_effect.POINT_AP, value: 2 } },
  ),
  effect_row(
    spell_effect.K_ALTER_STAT,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [
            status('STAT_BUFF', 5, { stat: 'strength', turns_remaining: 2 }),
          ],
        },
      },
    },
    { effect: { stat: spell_effect.STAT_STRENGTH, value: 5 } },
  ),
  effect_row(
    spell_effect.K_STEAL_STAT,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [
            status('STAT_BUFF', 5, { stat: 'strength', turns_remaining: 2 }),
          ],
        },
        [ENEMY_ID]: {
          effects: [
            status('STAT_DEBUFF', 5, { stat: 'strength', turns_remaining: 2 }),
          ],
        },
      },
    },
    { effect: { stat: spell_effect.STAT_STRENGTH, value: 5 } },
  ),
  effect_row(
    spell_effect.K_ALTER_RESIST,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [
            status('STAT_BUFF', 5, {
              stat: 'earth_resistance',
              turns_remaining: 2,
            }),
          ],
        },
      },
    },
    { effect: { element: 2, value: 5 } },
  ),
  effect_row(
    spell_effect.K_PUSH,
    { fighters: { [ENEMY_ID]: { cell: { x: 6, y: 2 } } } },
    { effect: { element: 255, value: 2 } },
  ),
  effect_row(
    spell_effect.K_PULL,
    { fighters: { [ENEMY_ID]: { cell: { x: 3, y: 2 } } } },
    { effect: { element: 255, value: 1 } },
  ),
  effect_row(
    spell_effect.K_TELEPORT,
    { fighters: { [CASTER_ID]: { cell: EMPTY_CELL } } },
    {
      target: 'empty',
      effect: { element: 255, target_filter: spell_effect.TF_ONLY_CASTER },
    },
  ),
  effect_row(
    spell_effect.K_SWAP_POSITIONS,
    {
      fighters: {
        [CASTER_ID]: { cell: ENEMY_CELL },
        [ENEMY_ID]: { cell: CASTER_CELL },
      },
    },
    { effect: { element: 255 } },
  ),
  effect_row(
    spell_effect.K_CARRY,
    { fighters: { [ENEMY_ID]: { cell: CASTER_CELL } } },
    { effect: { element: 255 } },
  ),
  effect_row(
    spell_effect.K_THROW,
    { fighters: { [ENEMY_ID]: { cell: { x: 6, y: 2 } } } },
    { effect: { element: 255, value: 2 } },
  ),
  effect_row(
    spell_effect.K_RESET_POSITIONS,
    {
      fighters: {
        [CASTER_ID]: { cell: CASTER_CELL },
        [ENEMY_ID]: { cell: ENEMY_CELL },
      },
    },
    {
      target: 'self',
      setup: 'reset_positions',
      effect: { element: 255, target_filter: spell_effect.TF_NONE },
      skip_reason:
        'conformance bug: K_RESET_POSITIONS normalizes to UNSUPPORTED and leaves displaced fighters in place',
    },
  ),
  effect_row(
    spell_effect.K_PLACE_TRAP,
    {
      traps: [
        {
          source_id: CASTER_ID,
          cells: [EMPTY_CELL],
          payload: [],
          anchor: EMPTY_CELL,
        },
      ],
    },
    {
      target: 'empty',
      effect: { element: 255, target_filter: spell_effect.TF_NONE },
    },
  ),
  effect_row(
    spell_effect.K_PLACE_GLYPH,
    {
      glyphs: [
        {
          source_id: CASTER_ID,
          cells: [EMPTY_CELL],
          payload: [],
          element: 'NONE',
          min: 12,
          max: 12,
          turns_remaining: 2,
        },
      ],
    },
    {
      target: 'empty',
      effect: { element: 255, target_filter: spell_effect.TF_NONE },
    },
  ),
  effect_row(
    spell_effect.K_APPLY_DOT,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [
            status('DAMAGE', 8, { element: 'EARTH', turns_remaining: 3 }),
          ],
        },
      },
    },
    { effect: { value: 8, turns: 3 } },
  ),
  effect_row(
    spell_effect.K_APPLY_STATE,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [status('APPLY_STATE', 7, { turns_remaining: 2 })],
        },
      },
    },
    { effect: { value: 7 } },
  ),
  effect_row(
    spell_effect.K_REMOVE_STATE,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [status('STUN', 0, { flags: 0, turns_remaining: 3 })],
        },
      },
    },
    {
      setup: 'remove_state',
      effect: { value: 7 },
      skip_reason:
        'conformance bug: K_REMOVE_STATE normalizes to UNSUPPORTED and cannot remove an active named state',
    },
  ),
  effect_row(
    spell_effect.K_REDUCE_DAMAGE,
    {
      fighters: {
        [ALLY_ID]: {
          effects: [
            status('SHIELD', 15, { element: 'NONE', turns_remaining: 2 }),
          ],
        },
      },
    },
    {
      target: 'ally',
      effect: { target_filter: spell_effect.TF_NOT_ENEMY, value: 15 },
    },
  ),
  effect_row(
    spell_effect.K_REFLECT_DAMAGE,
    {
      fighters: {
        [ALLY_ID]: {
          effects: [status('REFLECT_DAMAGE', 15, { turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'ally',
      effect: { target_filter: spell_effect.TF_NOT_ENEMY, value: 15 },
    },
  ),
  effect_row(
    spell_effect.K_DISPEL,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [status('STUN', 0, { flags: 0, turns_remaining: 3 })],
        },
      },
    },
    { setup: 'dispel' },
  ),
  effect_row(
    spell_effect.K_INVISIBILITY,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [status('INVISIBILITY', 0, { turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'self',
      effect: { element: 255, target_filter: spell_effect.TF_ONLY_CASTER },
    },
  ),
  effect_row(
    spell_effect.K_REVEAL,
    { fighters: { [ENEMY_ID]: { effects: [] } } },
    {
      effect: {
        element: 255,
        area_shape: spell_effect.SHAPE_CIRCLE,
        area_size: 1,
      },
      setup: 'reveal',
    },
  ),
  effect_row(
    spell_effect.K_RETURN_SPELL,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [status('RETURN_SPELL', 12, { turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'self',
      effect: { element: 255, target_filter: spell_effect.TF_ONLY_CASTER },
    },
  ),
  effect_row(
    spell_effect.K_GEOMETRIC_PUSH,
    { fighters: { [ENEMY_ID]: { cell: { x: 4, y: 2 } } } },
    {
      target: 'self',
      layout: 'geometric',
      effect: {
        element: 255,
        target_filter: spell_effect.TF_NONE,
        area_shape: spell_effect.SHAPE_CIRCLE,
        area_size: 2,
      },
    },
  ),
  effect_row(
    spell_effect.K_CRITICAL_FAILURE,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [status('CRITICAL_FAILURE', 3, { turns_remaining: 2 })],
        },
      },
    },
    { effect: { value: 3 } },
  ),
  effect_row(
    spell_effect.K_DAMAGE_TO_HEAL,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [
            status('DAMAGE_TO_HEAL', 2, {
              chance: 100,
              heal_multiplier: 2,
              turns_remaining: 2,
            }),
          ],
        },
      },
    },
    { effect: { value: 2, stat: 2 } },
  ),
  effect_row(spell_effect.K_FORCED_DEATH, {
    fighters: { [ENEMY_ID]: { health: 0 } },
    winner: 0,
  }),
  effect_row(
    spell_effect.K_TIMED_PAYLOAD,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [
            status('TIMED_PAYLOAD', 0, {
              spell_id: `matrix_${spell_effect.K_TIMED_PAYLOAD}`,
              payload: [
                {
                  kind: spell_effect.K_DAMAGE,
                  type: 'DAMAGE',
                  value: 9,
                  min: 9,
                  max: 9,
                  element: 'EARTH',
                  target_filter: spell_effect.TF_NOT_TEAM,
                },
              ],
              turns_remaining: 2,
            }),
          ],
        },
      },
    },
    {
      target: 'self',
      effects: [
        raw_effect(spell_effect.K_TIMED_PAYLOAD, {
          element: 255,
          value: 2,
          stat: 1,
          turns: 2,
          target_filter: spell_effect.TF_ONLY_CASTER,
        }),
        raw_effect(spell_effect.K_DAMAGE, { value: 9 }),
      ],
    },
  ),
  effect_row(
    spell_effect.K_NAMED_DAMAGE_STACK,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [
            status('NAMED_DAMAGE_STACK', 4, {
              spell_id: `matrix_${spell_effect.K_NAMED_DAMAGE_STACK}`,
              turns_remaining: 2,
            }),
          ],
        },
      },
    },
    { effect: { value: 4 } },
  ),
  effect_row(
    spell_effect.K_STANCE,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [status('STANCE', 6, { turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'self',
      effect: { value: 6, target_filter: spell_effect.TF_ONLY_CASTER },
    },
  ),
  effect_row(
    spell_effect.K_REACTIVE_PUNISHMENT,
    {
      fighters: {
        [CASTER_ID]: {
          effects: [
            status('REACTIVE_PUNISHMENT', 10, {
              stat: 'strength',
              trigger_turns: 2,
              turns_remaining: 2,
            }),
          ],
        },
      },
    },
    {
      target: 'self',
      effect: {
        value: 10,
        stat: spell_effect.STAT_STRENGTH,
        area_size: 2,
        target_filter: spell_effect.TF_ONLY_CASTER,
      },
    },
  ),
  effect_row(
    spell_effect.K_EROSION,
    {
      fighters: {
        [ENEMY_ID]: {
          effects: [status('EROSION', 10, { turns_remaining: 2 })],
        },
      },
    },
    { effect: { value: 10 } },
  ),
  effect_row(
    spell_effect.K_DAMAGE_REDIRECT,
    {
      fighters: {
        [ALLY_ID]: {
          effects: [status('DAMAGE_REDIRECT', 25, { turns_remaining: 2 })],
        },
      },
    },
    {
      target: 'ally',
      effect: { value: 25, target_filter: spell_effect.TF_NOT_ENEMY },
    },
  ),
]
