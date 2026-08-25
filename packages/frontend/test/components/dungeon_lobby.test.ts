// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  current_dungeon_room_players,
  dungeon_fight_joinable,
  dungeon_room_state,
} from '../../src/components/DungeonLobby.tsx'
import { dungeon_portal_targets } from '../../src/game/core/dungeon_portal_feed.ts'
import { dungeon_operation_reconciled } from '../../src/modules/dungeon.ts'

test('dungeon rooms reveal only cleared and current rooms', () => {
  expect([1, 2, 3, 4].map((room) => dungeon_room_state(room, 2))).toEqual([
    'cleared',
    'current',
    'mysterious',
    'mysterious',
  ])
})

test('only the current room exposes its player list or occupancy', () => {
  const players = [{ character_id: '0xc1', name: 'Nox', level: 12, room: 2 }]
  expect(current_dungeon_room_players(players, 2, 2)).toEqual(players)
  expect(current_dungeon_room_players(players, 3, 2)).toEqual([])
})

test('a group fight accepts only a member of the opener party during placement', () => {
  const fight = { phase: 'placement', access: 1, opener: '0xopener' }
  expect(dungeon_fight_joinable(fight, ['0xself', '0xopener'])).toBeTrue()
  expect(dungeon_fight_joinable(fight, ['0xself'])).toBeFalse()
  expect(dungeon_fight_joinable({ ...fight, access: 0 }, [])).toBeTrue()
  expect(dungeon_fight_joinable({ ...fight, phase: 'active', access: 0 }, [])).toBeFalse()
})

test('portal names advertise at range while interaction remains close', () => {
  const portals = [
    { id: 'near', world: 'nauvis', x: 3, z: 0, zx: 1, zz: 1 },
    { id: 'far', world: 'nauvis', x: 42, z: 0, zx: 1, zz: 2 },
    { id: 'hidden', world: 'nauvis', x: 51, z: 0, zx: 1, zz: 3 },
  ]
  expect(dungeon_portal_targets(portals, 0, 0)).toEqual({ visible_ids: ['near', 'far'], focused_id: 'near' })
})

test('dungeon writes remain pending until the roster proves their state transition', () => {
  const staged = { dungeon_run: { world: 'nauvis', room: 1, x: 1, z: 2 }, custody: 'kiosk' } as never
  const fighting = {
    dungeon_run: { world: 'nauvis', room: 1, x: 1, z: 2 },
    custody: 'fight',
  } as never
  expect(dungeon_operation_reconciled('enter', staged)).toBeTrue()
  expect(dungeon_operation_reconciled('start', staged)).toBeFalse()
  expect(dungeon_operation_reconciled('start', fighting)).toBeTrue()
  expect(dungeon_operation_reconciled('abandon', staged)).toBeFalse()
  expect(dungeon_operation_reconciled('abandon', {} as never)).toBeTrue()
})
