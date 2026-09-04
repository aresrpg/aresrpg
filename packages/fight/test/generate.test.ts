// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  API_FIGHT_DOORS,
  CONTRACT_CONSTANTS,
  INTEGER_WIDTHS,
  MOVE_SOURCES,
  STRUCT_SCHEMAS,
} from '../src/move_contract.gen.ts'

describe('Move contract generation', () => {
  test('projects every field from compact one-line Move structs', () => {
    expect(
      Object.fromEntries(
        [
          'KitSpell',
          'TurnCast',
          'Cooldown',
          'RolledDrop',
          'FightCreated',
          'FighterJoined',
          'FightStarted',
          'FightEnded',
          'TurnSeedUsed',
          'DropsRolled',
        ].map((name) => [name, STRUCT_SCHEMAS[name as keyof typeof STRUCT_SCHEMAS].map(({ name: field }) => field)])
      )
    ).toEqual({
      KitSpell: ['name', 'ordinal', 'level'],
      TurnCast: ['spell', 'target'],
      Cooldown: ['spell', 'left'],
      RolledDrop: ['item_type', 'qty'],
      FightCreated: ['fight', 'world', 'x', 'z', 'placement_ms'],
      FighterJoined: ['fight', 'character', 'team'],
      FightStarted: ['fight', 'world', 'x', 'z', 'queue'],
      FightEnded: ['fight', 'world', 'x', 'z', 'winner'],
      TurnSeedUsed: ['fight', 'seat', 'seed'],
      DropsRolled: ['fight', 'fighter', 'drops'],
    })
    expect(STRUCT_SCHEMAS.TurnSeedUsed).toEqual([
      { name: 'fight', type: 'ID' },
      { name: 'seat', type: 'u64' },
      { name: 'seed', type: 'u64' },
    ])
    expect(INTEGER_WIDTHS.KitSpell).toEqual({ ordinal: 8 })
    expect(INTEGER_WIDTHS.TurnSeedUsed).toEqual({ seat: 64, seed: 64 })
  })

  test('hashes every Move module that supplies fight state or behavior', () => {
    expect(MOVE_SOURCES).toEqual(
      expect.arrayContaining([
        'packages/move/sources/character.move',
        'packages/move/sources/equipment.move',
        'packages/move/sources/forgemagie.move',
        'packages/seed/sources/mob_rows.move',
        'packages/seed/sources/spell_rows.move',
        'packages/move-math/sources/item_damages.move',
      ])
    )
  })

  test('projects the forgemagie unlock gate from Move', () => {
    expect(CONTRACT_CONSTANTS.rune_unlock_level).toBe(1n)
  })

  test('preserves the steered movement path as vector<u64>', () => {
    expect(API_FIGHT_DOORS.move_fighter.arguments.find(({ name }) => name === 'path')).toEqual({
      name: 'path',
      type: 'vector<u64>',
    })
  })
})
