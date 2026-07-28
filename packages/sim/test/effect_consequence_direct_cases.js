// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure consequence descriptions for direct, pool, stat, and displacement kinds.

import { expect } from 'bun:test'

import * as spell_effect from '../src/spell_effect.js'

import {
  CASTER,
  CASTER_CELL,
  ENEMY,
  ENEMY_CELL,
  cast,
  cell,
  damage_taken,
  fight,
  hp,
  pool,
  turn_to,
  walk,
  with_cell,
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

const self_buff = (stat, amount, turns = 5) =>
  on_self(spell_effect.K_ALTER_STAT, {
    value: SIGNED_SHIFT + amount,
    stat,
    turns,
  })

const consequence = (description, probe) => ({ description, probe })

export const direct_consequence_entries = [
  [
    spell_effect.K_DAMAGE,
    consequence('resolved damage debits target HP on every cast', () => {
      const initial = fight([strike])
      const first = cast(initial, 'strike', ENEMY_CELL)
      const second = cast(first, 'strike', ENEMY_CELL)
      expect(damage_taken(initial, first)).toBe(20)
      expect(damage_taken(first, second)).toBe(20)
    }),
  ],
  [
    spell_effect.K_PERCENT_LIFE_DAMAGE,
    consequence('live-HP percentage makes the second hit smaller', () => {
      const initial = fight([
        {
          id: 'quarter',
          effects: [
            on_enemy(spell_effect.K_PERCENT_LIFE_DAMAGE, { value: 25 }),
          ],
        },
      ])
      const first = cast(initial, 'quarter', ENEMY_CELL)
      const second = cast(first, 'quarter', ENEMY_CELL)
      expect(damage_taken(initial, first)).toBeGreaterThan(
        damage_taken(first, second),
      )
    }),
  ],
  [
    spell_effect.K_LIFE_STEAL,
    consequence('resolved victim loss credits half to the caster', () => {
      const initial = fight(
        [
          {
            id: 'drain',
            effects: [
              raw_effect(spell_effect.K_LIFE_STEAL, {
                value: 20,
                element: EARTH,
              }),
            ],
          },
        ],
        { p0: 80 },
      )
      const drained = cast(initial, 'drain', ENEMY_CELL)
      const lost = damage_taken(initial, drained)
      expect(lost).toBe(20)
      expect(hp(drained, CASTER) - hp(initial, CASTER)).toBe(lost / 2)
    }),
  ],
  [
    spell_effect.K_CASTER_DAMAGE,
    consequence('recoil debits caster HP through the cast fold', () => {
      const initial = fight([
        {
          id: 'recoil',
          effects: [
            on_self(spell_effect.K_CASTER_DAMAGE, {
              value: 20,
              element: EARTH,
            }),
          ],
        },
      ])
      expect(
        damage_taken(initial, cast(initial, 'recoil', CASTER_CELL), CASTER),
      ).toBe(20)
    }),
  ],
  [
    spell_effect.K_PUNISHMENT_DAMAGE,
    consequence('caster HP loss increases punishment damage', () => {
      const punishment = {
        id: 'punishment',
        effects: [
          on_enemy(spell_effect.K_PUNISHMENT_DAMAGE, {
            value: 20,
            element: EARTH,
          }),
        ],
      }
      const full = fight([punishment], { p0: 200 })
      const wounded = fight([punishment], { p0: 100 })
      expect(
        damage_taken(wounded, cast(wounded, 'punishment', ENEMY_CELL)),
      ).toBeGreaterThan(
        damage_taken(full, cast(full, 'punishment', ENEMY_CELL)),
      )
    }),
  ],
  [
    spell_effect.K_HEAL,
    consequence('resolved healing credits wounded target HP', () => {
      const initial = fight(
        [
          {
            id: 'mend',
            effects: [
              on_self(spell_effect.K_HEAL, { value: 20, element: NONE }),
            ],
          },
        ],
        { p0: 50 },
      )
      const healed = cast(initial, 'mend', CASTER_CELL)
      expect(hp(healed, CASTER) - hp(initial, CASTER)).toBe(20)
    }),
  ],
  [
    spell_effect.K_GIVE_POINTS,
    consequence('granted MP expands the spendable movement budget', () => {
      const initial = fight([
        {
          id: 'haste',
          effects: [
            on_self(spell_effect.K_GIVE_POINTS, {
              value: 3,
              stat: spell_effect.POINT_MP,
              turns: 2,
            }),
          ],
        },
      ])
      const far = { x: 1, y: 8 }
      expect(walk(initial, far).accepted).toBe(false)
      const granted = cast(initial, 'haste', CASTER_CELL)
      expect(pool(granted, CASTER, 'mp')).toBe(9)
      expect(walk(granted, far).accepted).toBe(true)
    }),
  ],
  [
    spell_effect.K_REMOVE_POINTS,
    consequence('AP and MP drains shrink the victim spendable budgets', () => {
      const initial = fight([
        {
          id: 'root',
          effects: [
            on_enemy(spell_effect.K_REMOVE_POINTS, {
              value: 4,
              stat: spell_effect.POINT_MP,
              turns: 2,
            }),
            on_enemy(spell_effect.K_REMOVE_POINTS, {
              value: 6,
              stat: spell_effect.POINT_AP,
              turns: 2,
            }),
          ],
        },
        {
          id: 'costly',
          ap_cost: 6,
          effects: [
            raw_effect(spell_effect.K_DAMAGE, {
              value: 5,
              element: EARTH,
            }),
          ],
        },
      ])
      const destination = { x: 7, y: 1 }
      const untouched = turn_to(initial, ENEMY)
      expect(walk(untouched, destination, ENEMY).accepted).toBe(true)
      expect(cast(untouched, 'costly', CASTER_CELL, ENEMY).accepted).toBe(true)
      const drained = turn_to(cast(initial, 'root', ENEMY_CELL), ENEMY)
      expect(pool(drained, ENEMY, 'mp')).toBe(2)
      expect(pool(drained, ENEMY, 'ap')).toBe(4)
      expect(walk(drained, destination, ENEMY).accepted).toBe(false)
      expect(cast(drained, 'costly', CASTER_CELL, ENEMY).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_STEAL_POINTS,
    consequence(
      'stolen AP and MP debit victim and credit caster budgets',
      () => {
        const initial = fight([
          {
            id: 'siphon',
            effects: [
              on_enemy(spell_effect.K_STEAL_POINTS, {
                value: 3,
                stat: spell_effect.POINT_MP,
              }),
              on_enemy(spell_effect.K_STEAL_POINTS, {
                value: 3,
                stat: spell_effect.POINT_AP,
              }),
            ],
          },
          {
            id: 'costly',
            ap_cost: 12,
            effects: [
              raw_effect(spell_effect.K_DAMAGE, {
                value: 5,
                element: EARTH,
              }),
            ],
          },
        ])
        const stolen = cast(initial, 'siphon', ENEMY_CELL)
        expect([pool(stolen, CASTER, 'mp'), pool(stolen, ENEMY, 'mp')]).toEqual(
          [9, 3],
        )
        expect([pool(stolen, CASTER, 'ap'), pool(stolen, ENEMY, 'ap')]).toEqual(
          [13, 7],
        )
        expect(walk(stolen, { x: 1, y: 8 }).accepted).toBe(true)
        expect(cast(stolen, 'costly', ENEMY_CELL).accepted).toBe(true)
      },
    ),
  ],
  [
    spell_effect.K_ALTER_STAT,
    consequence('percent-damage buff changes the next resolved hit', () => {
      const initial = fight([
        strike,
        {
          id: 'rage',
          effects: [self_buff(spell_effect.STAT_PERCENT_DAMAGE, 100)],
        },
      ])
      const plain = damage_taken(initial, cast(initial, 'strike', ENEMY_CELL))
      const buffed = cast(initial, 'rage', CASTER_CELL)
      expect(damage_taken(buffed, cast(buffed, 'strike', ENEMY_CELL))).toBe(
        plain * 2,
      )
    }),
  ],
  [
    spell_effect.K_STEAL_STAT,
    consequence(
      'stat steal strengthens caster and weakens victim casts',
      () => {
        const initial = fight(
          [
            strike,
            {
              id: 'rob',
              effects: [
                on_enemy(spell_effect.K_STEAL_STAT, {
                  value: 50,
                  stat: spell_effect.STAT_STRENGTH,
                  turns: 3,
                }),
              ],
            },
          ],
          { m0_stats: { strength: 100 } },
        )
        const plain_caster = damage_taken(
          initial,
          cast(initial, 'strike', ENEMY_CELL),
        )
        const enemy_turn = turn_to(initial, ENEMY)
        const plain_enemy = damage_taken(
          enemy_turn,
          cast(enemy_turn, 'strike', CASTER_CELL, ENEMY),
          CASTER,
        )
        const robbed = cast(initial, 'rob', ENEMY_CELL)
        expect(
          damage_taken(robbed, cast(robbed, 'strike', ENEMY_CELL)),
        ).toBeGreaterThan(plain_caster)
        const weakened = turn_to(robbed, ENEMY)
        expect(
          damage_taken(
            weakened,
            cast(weakened, 'strike', CASTER_CELL, ENEMY),
            CASTER,
          ),
        ).toBeLessThan(plain_enemy)
      },
    ),
  ],
  [
    spell_effect.K_ALTER_RESIST,
    consequence('resistance row reduces the next matching-element hit', () => {
      const initial = fight([
        strike,
        {
          id: 'ward',
          effects: [
            raw_effect(spell_effect.K_ALTER_RESIST, {
              value: SIGNED_SHIFT + 50,
              turns: 3,
              element: EARTH,
              target_filter: spell_effect.TF_NOT_TEAM,
            }),
          ],
        },
      ])
      const plain = damage_taken(initial, cast(initial, 'strike', ENEMY_CELL))
      const warded = cast(initial, 'ward', ENEMY_CELL)
      expect(damage_taken(warded, cast(warded, 'strike', ENEMY_CELL))).toBe(
        Math.floor(plain / 2),
      )
    }),
  ],
  [
    spell_effect.K_PUSH,
    consequence('push moves the victim outside a follow-up cast range', () => {
      const initial = fight([
        { id: 'push', effects: [on_enemy(spell_effect.K_PUSH, { value: 3 })] },
        { ...strike, range_max: 3 },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(true)
      const pushed = cast(initial, 'push', ENEMY_CELL)
      expect(cast(pushed, 'strike', cell(pushed, ENEMY)).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_PULL,
    consequence('pull moves the victim inside a follow-up cast range', () => {
      const initial = fight([
        { id: 'pull', effects: [on_enemy(spell_effect.K_PULL, { value: 1 })] },
        { ...strike, range_max: 2 },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(false)
      const pulled = cast(initial, 'pull', ENEMY_CELL)
      expect(cast(pulled, 'strike', cell(pulled, ENEMY)).accepted).toBe(true)
    }),
  ],
  [
    spell_effect.K_TELEPORT,
    consequence('teleport changes the origin used by the next cast', () => {
      const landing = { x: 3, y: 1 }
      const initial = fight([
        {
          id: 'blink',
          effects: [on_self(spell_effect.K_TELEPORT, { value: 2 })],
        },
        { ...strike, range_max: 1 },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(false)
      const moved = cast(initial, 'blink', landing)
      expect(cast(moved, 'strike', ENEMY_CELL).accepted).toBe(true)
    }),
  ],
  [
    spell_effect.K_SWAP_POSITIONS,
    consequence(
      'swap changes the origin used by the next movement spend',
      () => {
        const initial = fight([
          {
            id: 'swap',
            effects: [on_enemy(spell_effect.K_SWAP_POSITIONS, { value: 1 })],
          },
        ])
        const destination = { x: 8, y: 1 }
        expect(walk(initial, destination).accepted).toBe(false)
        expect(
          walk(cast(initial, 'swap', ENEMY_CELL), destination).accepted,
        ).toBe(true)
      },
    ),
  ],
  [
    spell_effect.K_CARRY,
    consequence(
      'carry brings the victim into a point-blank follow-up hit',
      () => {
        const initial = fight([
          {
            id: 'carry',
            effects: [on_enemy(spell_effect.K_CARRY, { value: 1 })],
          },
          { ...strike, range_max: 0 },
        ])
        expect(
          damage_taken(initial, cast(initial, 'strike', CASTER_CELL)),
        ).toBe(0)
        const carried = cast(initial, 'carry', ENEMY_CELL)
        expect(
          damage_taken(carried, cast(carried, 'strike', CASTER_CELL)),
        ).toBe(20)
      },
    ),
  ],
  [
    spell_effect.K_THROW,
    consequence('throw moves the victim outside a follow-up cast range', () => {
      const initial = fight([
        {
          id: 'throw',
          effects: [on_enemy(spell_effect.K_THROW, { value: 3 })],
        },
        { ...strike, range_max: 3 },
      ])
      expect(cast(initial, 'strike', ENEMY_CELL).accepted).toBe(true)
      const thrown = cast(initial, 'throw', ENEMY_CELL)
      expect(cast(thrown, 'strike', cell(thrown, ENEMY)).accepted).toBe(false)
    }),
  ],
  [
    spell_effect.K_RESET_POSITIONS,
    consequence('reset restores both displaced fighters to home cells', () => {
      const initial = fight([
        {
          id: 'reset',
          effects: [
            raw_effect(spell_effect.K_RESET_POSITIONS, {
              element: NONE,
              target_filter: spell_effect.TF_NONE,
            }),
          ],
        },
      ])
      const displaced = with_cell(
        with_cell(initial, CASTER, { x: 2, y: 2 }),
        ENEMY,
        { x: 6, y: 2 },
      )
      const reset = cast(displaced, 'reset', cell(displaced, CASTER))
      expect(cell(reset, CASTER)).toEqual(CASTER_CELL)
      expect(cell(reset, ENEMY)).toEqual(ENEMY_CELL)
    }),
  ],
]
