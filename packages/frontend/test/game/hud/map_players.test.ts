// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { PresenceRow } from '@aresrpg/protocol'

import { map_players } from '../../../src/game/hud/map_players.ts'

const player = (character_id: string, x: number, world = 'nauvis'): PresenceRow =>
  ({ character_id, world, x, z: 100 }) as PresenceRow

test('maps include owned followers, distinguish the leader, and draw each identity once', () => {
  const remote = { a: player('a', 1), b: player('b', 2), c: player('c', 3), other_world: player('away', 4, 'away') }
  const owned = { a: player('a', 10), b: player('b', 20), d: player('d', 40) }
  const party = { members: [{ character_id: 'b' }, { character_id: 'a' }, { character_id: 'c' }] }
  expect(map_players(remote, owned, party as never, 'a', 'nauvis')).toEqual([
    { x: 20, z: 100, role: 'leader' },
    { x: 3, z: 100, role: 'party' },
    { x: 40, z: 100, role: 'player' },
  ])
  expect(map_players(remote, owned, null, 'a', null)).toEqual([])
})
