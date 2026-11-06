// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

test('online characters follow server tracking, including fights and dungeons, through removal and reconnect', async () => {
  const fixture = wire({ character_ids: ['one', 'two'], dungeon_run: JSON.stringify({ dungeon: 'dungeon', room: 1 }) })
  const mount = () => create_player({ ...fixture, address: 'owner', admin: false })
  const first = mount()
  expect(first.online_characters()).toEqual([])
  try {
    await flush()
    expect([...first.online_characters()].sort()).toEqual(['one', 'two'])
    first.dispatch({ type: 'action/fight', character_id: 'one', fight: 'fight', seat: 0 })
    expect([...first.online_characters()].sort()).toEqual(['one', 'two'])
    const roster = fixture.sent.find((packet) => packet.type === 'packet/characters')!
    expect(roster.type).toBe('packet/characters')
    if (roster.type !== 'packet/characters') throw new Error('missing roster')
    first.dispatch({ type: 'action/character_roster', characters: roster.characters.filter(({ id }) => id === 'two') })
    expect(first.online_characters()).toEqual(['two'])
  } finally {
    first.on_close()
  }
  expect(first.online_characters()).toEqual([])
  const second = mount()
  try {
    await flush()
    expect([...second.online_characters()].sort()).toEqual(['one', 'two'])
    first.on_close()
    expect([...second.online_characters()].sort()).toEqual(['one', 'two'])
  } finally {
    second.on_close()
  }
  expect(second.online_characters()).toEqual([])
})

test('owned characters without a world are not online characters', async () => {
  const fixture = wire({ character_ids: ['unjoined'] })
  const graph = {
    ...fixture.graph,
    read: async (query: string, params?: Record<string, unknown>) => {
      const rows = await fixture.graph.read(query, params)
      return rows.map((row) =>
        'character' in row
          ? {
              ...row,
              character: { properties: { ...row.character.properties, world: undefined, checkpoint_world: undefined } },
            }
          : row
      )
    },
  }
  const player = create_player({ ...fixture, graph, address: 'owner', admin: false })
  try {
    await flush()
    expect(player.online_characters()).toEqual([])
  } finally {
    player.on_close()
  }
})
