// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure consequence descriptions for hazards, timed rows, and reaction kinds.

import { expect } from 'bun:test'

import * as spell_effect from '../src/spell_effect.js'

import {
  CASTER,
  CASTER_CELL,
  ENEMY,
  ENEMY_CELL,
  advance_rounds,
  cast,
  cell,
  damage_taken,
  fight,
  hp,
  rows,
  turn_to,
  walk,
} from './effect_consequence_driver.js'
import { raw_effect } from './missing_effect_helpers.js'

const SIGNED_SHIFT = 32_768
const EARTH = 2
const NONE = 255

const strike = {
  id: 'strike',
  effects: [raw_effect(spell_effect.K_DAMAGE, { value: 20, element: EARTH })],
}

const on_enemy = (kind, overrides = {}) =>
  raw_effect(kind, {
    element: NONE,
    target_filter: spell_effect.TF_NOT_TEAM,
    ...overrides,
  })

const on_self = (kind, overrides = {}) =>
  raw_effect(kind, {
    element: NONE,
    target_filter: spell_effect.TF_ONLY_CASTER,
    ...overrides,
  })

const consequence = (description, probe) => ({ description, probe })

export const status_consequence_entries = [
  [
    spell_effect.K_PLACE_TRAP,
    consequence(
      'trap payload damages a later fighter entering its cell',
      () => {
        const trap_cell = { x: 4, y: 3 }
        const initial = fight([
          {
            id: 'trap',
            effects: [
              raw_effect(spell_effect.K_PLACE_TRAP, {
                element: NONE,
                target_filter: spell_effect.TF_NONE,
              }),
              raw_effect(spell_effect.K_DAMAGE, { value: 12, element: EARTH }),
            ],
          },
        ])
        const placed = cast(initial, 'trap', trap_cell)
        const enemy_turn = turn_to(placed, ENEMY)
        const stepped = walk(enemy_turn, trap_cell, ENEMY)
        expect(stepped.accepted).toBe(true)
        expect(hp(stepped, ENEMY)).toBeLessThan(hp(enemy_turn, ENEMY))
      },
    ),
  ],
  [
    spell_effect.K_PLACE_GLYPH,
    consequence('glyph damages its occupant at a later turn boundary', () => {
      const initial = fight([
        {
          id: 'glyph',
          effects: [
            raw_effect(spell_effect.K_PLACE_GLYPH, {
              value: 12,
              turns: 3,
              element: EARTH,
              area_shape: spell_effect.SHAPE_CIRCLE,
              area_size: 1,
              target_filter: spell_effect.TF_NONE,
            }),
          ],
        },
      ])
      const placed = cast(initial, 'glyph', ENEMY_CELL)
      expect(hp(turn_to(placed, ENEMY), ENEMY)).toBeLessThan(hp(placed, ENEMY))
    }),
  ],
  [
    spell_effect.K_APPLY_DOT,
    consequence('poison ticks victim HP down at its turn boundary', () => {
      const initial = fight([
        {
          id: 'poison',
          effects: [
            on_enemy(spell_effect.K_APPLY_DOT, {
              value: 8,
              turns: 3,
              element: EARTH,
            }),
          ],
        },
      ])
      const poisoned = cast(initial, 'poison', ENEMY_CELL)
      expect(hp(turn_to(poisoned, ENEMY), ENEMY)).toBe(hp(poisoned, ENEMY) - 8)
    }),
  ],
  [
    spell_effect.K_APPLY_STATE,
    consequence('applied forbidden state refuses a subsequent cast', () => {
      const initial = fight([
        {
          id: 'state',
          effects: [
            on_self(spell_effect.K_APPLY_STATE, { value: 42, turns: 3 }),
          ],
        },
        { ...strike, forbidden_states: [42] },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(true)
      const stated = cast(initial, 'state', CASTER_CELL)
      expect(cast(stated, 'strike', ENEMY_CELL).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_REMOVE_STATE,
    consequence(
      'remove-state clears the named state before the next cast',
      () => {
        const initial = fight([
          {
            id: 'state',
            effects: [
              on_self(spell_effect.K_APPLY_STATE, { value: 42, turns: 3 }),
            ],
          },
          {
            id: 'clear',
            effects: [
              on_self(spell_effect.K_REMOVE_STATE, { value: 42, turns: 0 }),
            ],
          },
        ])
        const stated = cast(initial, 'state', CASTER_CELL)
        const cleared = cast(stated, 'clear', CASTER_CELL)
        expect(
          rows(cleared, CASTER).some(
            row => row.type === 'APPLY_STATE' && row.value === 42,
          ),
        ).toBe(false)
      },
    ),
  ],
  [
    spell_effect.K_REDUCE_DAMAGE,
    consequence('shield absorbs part of a subsequent resolved hit', () => {
      const initial = fight([
        strike,
        {
          id: 'shield',
          effects: [
            on_self(spell_effect.K_REDUCE_DAMAGE, { value: 15, turns: 3 }),
          ],
        },
      ])
      const plain_turn = turn_to(initial, ENEMY)
      const plain = damage_taken(
        plain_turn,
        cast(plain_turn, 'strike', CASTER_CELL, ENEMY),
        CASTER,
      )
      const shielded = turn_to(cast(initial, 'shield', CASTER_CELL), ENEMY)
      expect(
        damage_taken(
          shielded,
          cast(shielded, 'strike', CASTER_CELL, ENEMY),
          CASTER,
        ),
      ).toBe(plain - 15)
    }),
  ],
  [
    spell_effect.K_POOL_SHIELD,
    consequence(
      'pool shield absorbs a later matching hit and exposes its remaining reservoir',
      () => {
        const initial = fight([
          strike,
          {
            id: 'pool',
            effects: [
              on_self(spell_effect.K_POOL_SHIELD, {
                value: 25,
                turns: 3,
                element: EARTH,
              }),
            ],
          },
        ])
        const guarded = turn_to(cast(initial, 'pool', CASTER_CELL), ENEMY)
        const struck = cast(guarded, 'strike', CASTER_CELL, ENEMY)
        expect(hp(struck, CASTER)).toBe(hp(guarded, CASTER))
        expect(
          rows(struck, CASTER).find(row => row.type === 'POOL_SHIELD')?.value,
        ).toBe(5)
      },
    ),
  ],
  [
    spell_effect.K_REFLECT_DAMAGE,
    consequence('flat reflect debits the subsequent attacker HP', () => {
      const initial = fight([
        strike,
        {
          id: 'reflect',
          effects: [
            on_self(spell_effect.K_REFLECT_DAMAGE, { value: 7, turns: 3 }),
          ],
        },
      ])
      const guarded = turn_to(cast(initial, 'reflect', CASTER_CELL), ENEMY)
      const attacked = cast(guarded, 'strike', CASTER_CELL, ENEMY)
      expect(damage_taken(guarded, attacked, ENEMY)).toBe(7)
    }),
  ],
  [
    spell_effect.K_DISPEL,
    consequence(
      'dispel removes a buff from the next damage calculation',
      () => {
        const initial = fight([
          strike,
          {
            id: 'rage',
            effects: [
              raw_effect(spell_effect.K_ALTER_STAT, {
                value: SIGNED_SHIFT + 100,
                stat: spell_effect.STAT_PERCENT_DAMAGE,
                turns: 5,
                element: NONE,
                target_filter: spell_effect.TF_ONLY_CASTER,
                flags: spell_effect.FLAG_DISPELLABLE,
              }),
            ],
          },
          {
            id: 'dispel',
            effects: [on_self(spell_effect.K_DISPEL)],
          },
        ])
        const plain = damage_taken(initial, cast(initial, 'strike', ENEMY_CELL))
        const buffed = cast(initial, 'rage', CASTER_CELL)
        expect(damage_taken(buffed, cast(buffed, 'strike', ENEMY_CELL))).toBe(
          plain * 2,
        )
        const dispelled = cast(buffed, 'dispel', CASTER_CELL)
        expect(
          damage_taken(dispelled, cast(dispelled, 'strike', ENEMY_CELL)),
        ).toBe(plain)
      },
    ),
  ],
  [
    spell_effect.K_INVISIBILITY,
    consequence('invisibility prevents a subsequent targeted hit', () => {
      const initial = fight([
        strike,
        {
          id: 'fade',
          effects: [on_self(spell_effect.K_INVISIBILITY, { turns: 3 })],
        },
      ])
      const hidden = turn_to(cast(initial, 'fade', CASTER_CELL), ENEMY)
      expect(
        damage_taken(
          hidden,
          cast(hidden, 'strike', CASTER_CELL, ENEMY),
          CASTER,
        ),
      ).toBe(0)
    }),
  ],
  [
    spell_effect.K_REVEAL,
    consequence('reveal restores targetability for a subsequent hit', () => {
      const initial = fight([
        strike,
        {
          id: 'fade',
          effects: [on_enemy(spell_effect.K_INVISIBILITY, { turns: 3 })],
        },
        {
          id: 'reveal',
          effects: [
            on_enemy(spell_effect.K_REVEAL, {
              area_shape: spell_effect.SHAPE_CIRCLE,
              area_size: 2,
            }),
          ],
        },
      ])
      const hidden = cast(initial, 'fade', ENEMY_CELL)
      expect(damage_taken(hidden, cast(hidden, 'strike', ENEMY_CELL))).toBe(0)
      const revealed = cast(hidden, 'reveal', ENEMY_CELL)
      expect(damage_taken(revealed, cast(revealed, 'strike', ENEMY_CELL))).toBe(
        20,
      )
    }),
  ],
  [
    spell_effect.K_RETURN_SPELL,
    consequence(
      'spell return sends a subsequent hit back to its caster',
      () => {
        const initial = fight([
          strike,
          {
            id: 'mirror',
            effects: [
              on_self(spell_effect.K_RETURN_SPELL, { value: 0, turns: 3 }),
            ],
          },
        ])
        const mirrored = turn_to(cast(initial, 'mirror', CASTER_CELL), ENEMY)
        const returned = cast(mirrored, 'strike', CASTER_CELL, ENEMY)
        expect(damage_taken(mirrored, returned, CASTER)).toBe(0)
        expect(damage_taken(mirrored, returned, ENEMY)).toBe(20)
      },
    ),
  ],
  [
    spell_effect.K_GEOMETRIC_PUSH,
    consequence('zone-edge push changes the next legal cast envelope', () => {
      const initial = fight([
        {
          id: 'burst',
          effects: [
            raw_effect(spell_effect.K_GEOMETRIC_PUSH, {
              element: NONE,
              target_filter: spell_effect.TF_NONE,
              area_shape: spell_effect.SHAPE_CIRCLE,
              area_size: 4,
            }),
          ],
        },
        { ...strike, range_max: 3 },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(true)
      const pushed = cast(initial, 'burst', CASTER_CELL)
      expect(cast(pushed, 'strike', cell(pushed, ENEMY)).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_CRITICAL_FAILURE,
    consequence('critical-failure row makes the next cast fumble', () => {
      const initial = fight([
        strike,
        {
          id: 'curse',
          effects: [
            on_self(spell_effect.K_CRITICAL_FAILURE, { value: 1, turns: 3 }),
          ],
        },
      ])
      const cursed = cast(initial, 'curse', CASTER_CELL)
      expect(damage_taken(cursed, cast(cursed, 'strike', ENEMY_CELL))).toBe(0)
    }),
  ],
  [
    spell_effect.K_DAMAGE_TO_HEAL,
    consequence('damage inversion turns a subsequent hit into healing', () => {
      const initial = fight(
        [
          strike,
          {
            id: 'invert',
            effects: [
              on_enemy(spell_effect.K_DAMAGE_TO_HEAL, {
                value: 2,
                stat: 2,
                turns: 3,
              }),
            ],
          },
        ],
        { m0: 40 },
      )
      const inverted = cast(initial, 'invert', ENEMY_CELL)
      expect(hp(cast(inverted, 'strike', ENEMY_CELL), ENEMY)).toBeGreaterThan(
        hp(inverted, ENEMY),
      )
    }),
  ],
  [
    spell_effect.K_FORCED_DEATH,
    consequence('forced death latches winner and rejects later casts', () => {
      const initial = fight([
        {
          id: 'doom',
          effects: [on_enemy(spell_effect.K_FORCED_DEATH)],
        },
        strike,
      ])
      const killed = cast(initial, 'doom', ENEMY_CELL)
      expect(hp(killed, ENEMY)).toBe(0)
      expect(killed.state.winner).toBe(0)
      expect(cast(killed, 'strike', ENEMY_CELL).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_TIMED_PAYLOAD,
    consequence('timed payload fires after later turn boundaries', () => {
      const initial = fight([
        {
          id: 'fuse',
          effects: [
            on_self(spell_effect.K_TIMED_PAYLOAD, {
              value: 2,
              stat: 1,
              turns: 2,
            }),
            raw_effect(spell_effect.K_DAMAGE, { value: 9, element: EARTH }),
          ],
        },
      ])
      const armed = cast(initial, 'fuse', CASTER_CELL)
      expect(hp(advance_rounds(armed, CASTER, 3), CASTER)).toBeLessThan(
        hp(armed, CASTER),
      )
    }),
  ],
  [
    spell_effect.K_NAMED_DAMAGE_STACK,
    consequence('named stack increases the next same-spell hit', () => {
      const initial = fight([
        {
          id: 'stack',
          effects: [
            on_enemy(spell_effect.K_NAMED_DAMAGE_STACK, {
              value: 10,
              turns: 3,
            }),
            raw_effect(spell_effect.K_DAMAGE, { value: 20, element: EARTH }),
          ],
        },
      ])
      const first = cast(initial, 'stack', ENEMY_CELL)
      const second = cast(first, 'stack', ENEMY_CELL)
      expect(damage_taken(first, second)).toBeGreaterThan(
        damage_taken(initial, first),
      )
    }),
  ],
  [
    spell_effect.K_STANCE,
    consequence('entering a new stance evicts the prior stance', () => {
      const initial = fight([
        {
          id: 'stance_a',
          effects: [on_self(spell_effect.K_STANCE, { value: 6, turns: 5 })],
        },
        {
          id: 'stance_b',
          effects: [on_self(spell_effect.K_STANCE, { value: 9, turns: 5 })],
        },
      ])
      const changed = cast(
        cast(initial, 'stance_a', CASTER_CELL),
        'stance_b',
        CASTER_CELL,
      )
      const active = rows(changed, CASTER).filter(row => row.type === 'STANCE')
      expect(active.map(row => row.value)).toEqual([9])
    }),
  ],
  [
    spell_effect.K_REACTIVE_PUNISHMENT,
    consequence('incoming hit grants a stat felt by the next cast', () => {
      const initial = fight([
        strike,
        {
          id: 'react',
          effects: [
            on_self(spell_effect.K_REACTIVE_PUNISHMENT, {
              value: 10,
              stat: spell_effect.STAT_STRENGTH,
              area_size: 2,
              turns: 5,
            }),
          ],
        },
      ])
      const plain = damage_taken(initial, cast(initial, 'strike', ENEMY_CELL))
      const guarded = cast(initial, 'react', CASTER_CELL)
      const enemy_turn = turn_to(guarded, ENEMY)
      const hit = cast(enemy_turn, 'strike', CASTER_CELL, ENEMY)
      const retaliating = turn_to(hit, CASTER)
      expect(
        damage_taken(retaliating, cast(retaliating, 'strike', ENEMY_CELL)),
      ).toBeGreaterThan(plain)
    }),
  ],
  [
    spell_effect.K_EROSION,
    consequence('erosion burns max HP when a later hit lands', () => {
      const initial = fight([
        strike,
        {
          id: 'erosion',
          effects: [on_enemy(spell_effect.K_EROSION, { value: 50, turns: 5 })],
        },
      ])
      const eroded = cast(initial, 'erosion', ENEMY_CELL)
      const struck = cast(eroded, 'strike', ENEMY_CELL)
      expect(struck.state.team1[0].health_max).toBeLessThan(
        eroded.state.team1[0].health_max,
      )
    }),
  ],
  [
    spell_effect.K_DAMAGE_REDIRECT,
    consequence('redirect sends part of a later hit to its source', () => {
      const initial = fight([
        strike,
        {
          id: 'redirect',
          effects: [
            on_enemy(spell_effect.K_DAMAGE_REDIRECT, {
              value: 50,
              turns: 3,
            }),
          ],
        },
      ])
      const linked = cast(initial, 'redirect', ENEMY_CELL)
      const struck = cast(linked, 'strike', ENEMY_CELL)
      expect(hp(struck, CASTER)).toBeLessThan(hp(linked, CASTER))
    }),
  ],
]
