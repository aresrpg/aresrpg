// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import {
  current_dungeon_room_players,
  dungeon_fight_joinable,
  dungeon_room_state,
} from '../../src/components/DungeonLobby.tsx'
import { dungeon_portal_targets } from '../../src/game/core/dungeon_portal_feed.ts'
import { dungeon_entry_key, dungeon_operation_reconciled, selected_dungeon_run } from '../../src/modules/dungeon.ts'

const portal_source = readFileSync(new URL('../../src/components/DungeonPortalPrompt.tsx', import.meta.url), 'utf8')
const lobby_source = readFileSync(new URL('../../src/components/DungeonLobby.tsx', import.meta.url), 'utf8')

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

test('an entering character sees the expedition immediately while chain custody catches up', () => {
  const optimistic = { world: 'nauvis', room: 1, x: 4, z: 7 }
  const state = {
    session: { selected_character_id: '0xc', characters: [{ id: '0xc' }] },
    dungeon: { optimistic_runs: { '0xc': optimistic } },
  }
  expect(selected_dungeon_run(state as never)).toEqual(optimistic)
  expect(
    selected_dungeon_run({
      ...state,
      session: { ...state.session, characters: [{ id: '0xc', dungeon_run: { ...optimistic, room: 2 } }] },
    } as never)
  ).toEqual({ ...optimistic, room: 2 })
})

test('the portal entry control exists only while an unlocked matching key is available', () => {
  const key = {
    id: '0xkey',
    item_type: 'nauvis_key',
    name: 'Nauvis key',
    category: 'key',
    level: 1,
    kiosk: '0xkiosk',
    amount: 1,
  }
  const state = {
    session: {
      selected_character_id: '0xc',
      characters: [{ id: '0xc', kiosk: '0xkiosk' }],
      inventory: [key],
    },
    marketplace: { own_listings: [] },
    trade: { rows: [] },
  }
  expect(dungeon_entry_key(state as never, 'nauvis_key')).toEqual(key)
  expect(
    dungeon_entry_key({ ...state, session: { ...state.session, inventory: [] } } as never, 'nauvis_key')
  ).toBeNull()
  expect(
    dungeon_entry_key({ ...state, marketplace: { own_listings: [{ id: '0xkey' }] } } as never, 'nauvis_key')
  ).toBeNull()
})

test('dungeon surfaces use the global gold card language and rounded expedition frame', () => {
  expect(portal_source).toContain('data-dungeon-entry-card')
  expect(portal_source).not.toContain('#328dff')
  expect(portal_source).toContain('portal.zx')
  expect(portal_source).toContain('rounded-[11px]')
  expect(lobby_source).toContain('data-dungeon-expedition')
  expect(lobby_source).toContain('rounded-xl')
  expect(lobby_source).toContain('<Chat')
})
