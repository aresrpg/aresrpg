// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { mob_loot_chance_range, mob_power_summary } from '../../src/editor/mob_power.ts'
import type { JsonValue } from '../../src/editor/seed_editor.ts'

const effect = Object.freeze({
  kind: 0,
  element: 'earth',
  value: 100,
  value_max: 120,
  area_shape: 0,
  area_size: 0,
  target_filter: 1,
  chance_bp: 10_000,
  turns: 0,
  stat: 0,
})
const level = Object.freeze({
  ap_cost: 3,
  range_min: 1,
  range_max: 1,
  modifiable_range: false,
  line_of_sight: true,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 2,
  casts_per_target: 0,
  cooldown_turns: 0,
  crit_1_in: 0,
  effects: Object.freeze([effect]),
  crit_effects: Object.freeze([]),
})
const mob = Object.freeze({
  mob_type: 'test',
  name: 'Test',
  role: 'normal',
  level_min: 10,
  level_max: 20,
  hp: 1_000,
  ap: 6,
  mp: 3,
  agility: 100,
  wisdom: 50,
  resistances: Object.freeze({ earth: 32_868, fire: 32_668, water: 32_768, air: 32_768 }),
  spells: Object.freeze([{ name: 'hit', levels: Object.freeze([level, level]) }]),
  loot: Object.freeze([]),
  xp: 500,
}) as unknown as JsonValue

test('mob power shows simple Retro averages beside exact Ares range endpoints', () => {
  expect(mob_power_summary(mob)).toEqual({
    dodge: 10,
    tackle: 8,
    retro: {
      level: 15,
      cohort: 'regular',
      requested_cohort: 'regular',
      donor_level_min: 15,
      donor_level_max: 15,
      sample_count: 21,
      hp: 121,
      xp: 3_308,
      damage: 28,
    },
    minimum: {
      level: 10,
      hp: 600,
      ap: 6,
      mp: 3,
      agility: 60,
      dodge: 10,
      tackle: 0,
      wisdom: 30,
      xp: 300,
      damage: 132,
      resistances: { earth: 60, fire: -160, water: 0, air: 0 },
    },
    maximum: {
      level: 20,
      hp: 1_600,
      ap: 8,
      mp: 4,
      agility: 160,
      dodge: 10,
      tackle: 39,
      wisdom: 80,
      xp: 800,
      damage: 352,
      resistances: { earth: 160, fire: -60, water: 0, air: 0 },
    },
  })
})

test('a level-three protector reference uses level-three regular donors instead of level ten', () => {
  const protector = {
    ...(mob as unknown as Readonly<Record<string, unknown>>),
    role: 'protector',
    level_min: 1,
    level_max: 5,
  } as unknown as JsonValue

  expect(mob_power_summary(protector)?.retro).toMatchObject({
    level: 3,
    requested_cohort: 'protector',
    cohort: 'regular',
    donor_level_min: 3,
    donor_level_max: 3,
    damage: 9,
  })
})

test('mob loot chance shows its exact level-band endpoints before team Chance', () => {
  expect(mob_loot_chance_range(5_000, 10, 20)).toEqual({ minimum: 4_000, maximum: 6_000 })
  expect(mob_loot_chance_range(9_000, 10, 20)).toEqual({ minimum: 7_200, maximum: 10_000 })
  expect(mob_loot_chance_range(5_000, 10, 10)).toEqual({ minimum: 5_000, maximum: 5_000 })
})
