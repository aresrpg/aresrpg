// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_dungeon_lobby } from '../src/reads/get_dungeon_lobby.ts'

test('a dungeon lobby projects dungeon-scoped occupants and room fights', async () => {
  const graph = {
    read: async (query: string) =>
      query.includes('MATCH (c:Character {dungeon:') && query.includes('RETURN c.id')
        ? [{ character_id: '0xc1', name: 'Nox', level: 12, room: 2 }]
        : [
            {
              fight: {
                properties: {
                  id: '0xf1',
                  dungeon_room: 2,
                  phase: 'placement',
                  access_a: 1,
                  opener_a: '0xc1',
                },
              },
              players: [{ character_id: '0xc1', name: 'Nox', level: 12, room: 2 }],
            },
          ],
    close: async () => undefined,
  }

  expect(await get_dungeon_lobby(graph, { dungeon: 'tangled_aftermath' })).toEqual({
    dungeon: 'tangled_aftermath',
    players: [{ character_id: '0xc1', name: 'Nox', level: 12, room: 2 }],
    fights: [
      {
        id: '0xf1',
        room: 2,
        phase: 'placement',
        access: 1,
        opener: '0xc1',
        players: [{ character_id: '0xc1', name: 'Nox', level: 12, room: 2 }],
      },
    ],
  })
})
