// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world module mounts the tracked spiral, recenters presence at zone boundaries, rejects
// impossible movement, and never mounts a character the indexed custody does not prove.

import { EventEmitter } from 'node:events'

import { character_checkpoint, type ServerPacket } from '@aresrpg/protocol'

import type { Pubsub } from '../../src/pubsub_bus.ts'

export const make_character = ({
  pet = false,
  id = '0xabc',
  x = 100,
  z = 100,
  dungeon_run = null as string | null,
} = {}) => ({
  properties: {
    id,
    pet,
    name: 'nox',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    color_1: 1,
    color_2: 2,
    color_3: 3,
    world: 'overworld',
    checkpoint_world: 'overworld',
    x,
    z,
    // the checkpoint's own timestamp — the budget the FIRST stream move prices against
    at_ms: Date.now() - 60_000,
    spells: '{}',
    spell_points_spent: 0,
    ...(dungeon_run ? { dungeon_run } : {}),
  },
})
const character = make_character()

type WireOptions = Readonly<{
  owns?: boolean
  pet?: boolean
  friends?: string[]
  character_ids?: string[]
  shared_pubsub?: Pubsub
  dungeon_run?: string | null
  party_after_watch?: boolean
}>
type TestPubsub = Pubsub & Readonly<{ emitter: EventEmitter }>

export const wire = ({
  owns = true,
  pet = false,
  friends = [] as string[],
  character_ids = ['0xabc', '0xdef'],
  shared_pubsub,
  dungeon_run = null,
  party_after_watch = false,
}: WireOptions = {}) => {
  const at_ms = Date.now() - 60_000
  const character_row = (id: string) => ({
    properties: {
      ...make_character({ pet, id, x: id === character_ids[1] ? 700 : 100, dungeon_run }).properties,
      at_ms,
    },
  })
  const checkpoint = (id: string) => character_checkpoint(character_row(id).properties)!
  const sent: ServerPacket[] = []
  const dropped: string[] = []
  const owned_reads = new Map<string, number>()
  const ws = {
    // eslint-disable-next-line fp-law/no-mutating-methods -- the fake transport records effects for assertions.
    send: (raw: string) => sent.push(JSON.parse(raw)),
    // eslint-disable-next-line fp-law/no-mutating-methods -- the fake transport records disconnects for assertions.
    close: (_c?: number, reason?: string) => dropped.push(reason ?? ''),
  }
  const graph = {
    read: async (cypher: string, params?: Record<string, unknown>) => {
      if (cypher.includes('(p:Party)-[:INVITED]')) return []
      if (cypher.includes(':Character {id:')) {
        const character_id = String(params?.character_id ?? '0xabc')
        const read = (owned_reads.get(character_id) ?? 0) + 1
        owned_reads.set(character_id, read)
        return owns
          ? [
              {
                character: character_row(character_id),
                held_kiosk: '0xk',
                kiosk: '0xk',
                fight: null,
                party: party_after_watch && read > 1 ? '0xp' : null,
                worn: pet ? [{ slot: 'pet', item_type: 'bulbiflor' }] : [],
              },
            ]
          : []
      }
      if (cypher.includes('MATCH (p:Party {id:'))
        return [
          {
            party: { properties: { id: '0xp' } },
            members: [{ order: 0, character: { properties: { id: '0xabc', name: 'nox' } } }],
            invited: [],
          },
        ]
      if (cypher.includes(':FRIEND')) return friends.map((friend) => ({ address: friend, characters: [] }))
      if (cypher.includes('[:HOLDS]->(c:Character)'))
        return owns
          ? character_ids.map((id) => ({
              character: character_row(id),
              kiosk_node: { properties: { id: '0xk' } },
              equipment: [],
            }))
          : []
      if (cypher.includes(':FIGHTER]->(c:Character {owner:')) return []
      if (cypher.includes('RESULT_FOR')) return []
      if (cypher.includes('HOLDS_CLAIM') || cypher.includes('HOLDS_VOUCHER') || cypher.includes('CAN_BUY')) return []
      if (cypher.includes('LISTED_IN')) return []
      if (cypher.includes(':Zone')) return [{ zone: { properties: { world: 'overworld', zx: 0, zz: 0, seed: '7' } } }]
      if (cypher.includes('MATCH (c:Character {dungeon:') && cypher.includes('RETURN c.id'))
        return [{ character_id: '0xabc', name: 'nox', level: 10, room: 1 }]
      if (cypher.includes(':Fight')) return []
      return [{ character, kiosk: '0xk', equipment: [], item: { properties: {} }, label: 'User', count: 1 }]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  const published: { channel: string; payload: any }[] = []
  const bus = {
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      // eslint-disable-next-line fp-law/no-mutating-methods -- the fake mesh records publications for assertions.
      published.push({ channel, payload })
      emitter.emit(channel, payload) // loopback so a second connection would see it
    },
    close: () => {},
  }
  const pubsub: TestPubsub = shared_pubsub
    ? { ...shared_pubsub, emitter: shared_pubsub.graph.emitter }
    : {
        emitter,
        graph: { ...bus, indexed_checkpoint: async () => 1, sales_history: async () => [] },
        mesh: { ...bus, heartbeat: async () => {}, cluster_online: async () => 7 },
      }
  return { sent, ws, graph, pubsub, published, dropped, checkpoint }
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
