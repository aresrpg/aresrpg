// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { empty_snapshot, reduce_actor_snapshot } from '../../bot/src/actor_snapshot.ts'

import { create_player } from './helpers/player.ts'
import { wire, flush } from './helpers/world_wire.ts'

for (const joined_world of [false, true])
  test(`indexed character invalidation refreshes full equipment, jobs, XP and raised stats (joined world: ${joined_world})`, async () => {
    const fixture = wire({ character_ids: ['0xabc'] })
    let equipment: { slot: string; item: { properties: Record<string, unknown> } }[] = []
    let properties: Record<string, unknown> = {
      vitality: 0,
      available_points: 5,
      experience: '0',
      ...(!joined_world ? { world: null, checkpoint_world: null } : {}),
    }
    const graph = {
      ...fixture.graph,
      read: async (query: string, params?: Record<string, unknown>) => {
        if (query.includes(':Tournament')) return []
        const rows = await fixture.graph.read(query, params)
        return rows.map((row) =>
          'character' in row && row.character
            ? {
                ...row,
                equipment,
                character: { ...row.character, properties: { ...row.character.properties, ...properties } },
              }
            : row
        )
      },
    }
    const player = create_player({ ...fixture, graph, address: '0xme', admin: false })
    let snapshot = empty_snapshot()
    const latest = () => fixture.sent.filter((packet) => packet.type === 'packet/characters').at(-1)!
    const changed = async () => {
      const before = fixture.sent.filter((packet) => packet.type === 'packet/characters').length
      fixture.pubsub.emitter.emit('evt:character:0xabc', { type: 'CharacterChanged', data: { character: '0xabc' } })
      await flush()
      await flush()
      expect(fixture.sent.filter((packet) => packet.type === 'packet/characters').length).toBeGreaterThan(before)
      snapshot = reduce_actor_snapshot(snapshot, { status: 'ready', last_packet: latest() } as never, 1000, 100)
      return snapshot.characters[0]!
    }
    try {
      await flush()
      await flush()
      await flush()
      expect(latest().characters[0]!.equipment).toEqual([])
      equipment = [
        {
          slot: 'tool',
          item: {
            properties: {
              id: 'tool',
              item_type: 'basic_sickle',
              name: 'Sickle',
              category: 'tool_herbalist',
              amount: '1',
              level: 1,
            },
          },
        },
      ]
      properties = { ...properties, folded_stats: Array(15).fill(32770) }
      expect((await changed()).equipment).toMatchObject([{ slot: 'tool', id: 'tool', category: 'tool_herbalist' }])
      equipment = []
      expect((await changed()).equipment).toEqual([])
      equipment = [
        {
          slot: 'tool',
          item: {
            properties: {
              id: 'replacement',
              item_type: 'basic_sickle',
              category: 'tool_herbalist',
              amount: '1',
              level: 1,
            },
          },
        },
      ]
      expect((await changed()).equipment[0]!.id).toBe('replacement')
      properties = { ...properties, at_ms: 2000 }
      await changed()
      properties = { ...properties, job_herbalist: '1300', experience: '120', level: 11, available_points: 10 }
      expect(await changed()).toMatchObject({
        jobs: { HERBALIST: '1300' },
        experience: '120',
        level: 11,
        available_points: 10,
      })
      properties = { ...properties, vitality: 10, available_points: 0 }
      expect(await changed()).toMatchObject({ vitality: 10, available_points: 0 })
    } finally {
      player.on_close()
    }
  })
