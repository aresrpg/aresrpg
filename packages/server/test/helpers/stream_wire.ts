// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import type { ServerPacket } from '@aresrpg/protocol'

const character = {
  properties: {
    id: '0xabc',
    name: 'nox',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    color_1: 1,
    color_2: 2,
    color_3: 3,
    world: 'overworld',
    x: 100,
    z: 100,
    spells: '{}',
    spell_points_spent: 0,
  },
}

export const fight_node = {
  properties: {
    id: '0xf1',
    world: 'overworld',
    x: 120,
    z: 120,
    phase: 'placement',
    access_a: 0,
    access_b: 0,
    managed: false,
    wagered: false,
    winner: null,
    dungeon_room: null,
    drops_rolled: false,
    turn_ptr: 0,
    round: 0,
    turn_seed: '0',
    placement_ms: 0,
    turn_started_ms: 0,
    // the indexer's machine document (graph.rs fight_machine) — the replayable blob
    machine: JSON.stringify({
      board: {
        width: 8,
        height: 8,
        shape_mask: ['0'],
        obstacles: [],
        holes: [],
        start_cells_a: [1],
        start_cells_b: [62],
      },
      closed: [],
      opener_a: '0xabc',
      opener_b: null,
      queue: [],
      turn_slot: 0,
      turn_casts: [],
      zones: [],
      fighters: [
        {
          team: 0,
          kind: { player: { character: '0xabc', owner: '0xme', level: 10 } },
          cell: 1,
          ready: false,
          dead: false,
          settled: false,
          forfeited: false,
          hp: 100,
          ap: 6,
          mp: 3,
          drops: [],
          effects: [],
          cooldowns: [],
        },
      ],
    }),
  },
}

/** `seated` puts the character in a fight BEFORE the connection exists — the custody the
 *  embody read must find (a reconnect mid-fight, or the creator seated at the fight's birth). */
export const wire = ({
  seated = false,
  fight = fight_node,
  fight_read,
}: {
  seated?: boolean
  fight?: typeof fight_node
  fight_read?: (fight_id: string) => Promise<{ fight: typeof fight_node }[]>
} = {}) => {
  const sent: ServerPacket[] = []
  const ws = {
    // eslint-disable-next-line fp-law/no-mutating-methods -- the test socket intentionally records its ordered output.
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: () => {},
  }
  const graph = {
    read: async (cypher: string, params?: Record<string, unknown>) => {
      if (cypher.includes(':Fight {id:')) return fight_read ? fight_read(String(params?.fight_id)) : [{ fight }]
      if (cypher.includes('WHERE c.id IN')) return [{ character, weapon: null }]
      if (cypher.includes(':Fight {world:')) return []
      // seated: the kiosk's HOLDS edge is severed by law, so custody proves nothing and the
      // embody gate must read the seat out of the fight's machine document instead
      if (cypher.includes(':Character {id:'))
        return [
          {
            character,
            held_kiosk: seated ? null : '0xk',
            kiosk: '0xk',
            fight: seated ? fight : null,
            party: null,
            worn: [],
          },
        ]
      if (cypher.includes(':FRIEND')) return []
      if (/RESULT_FOR|CLOSABLE_FOR/.test(cypher)) return []
      if (cypher.includes('[:HOLDS]->(i:Item)')) return []
      if (cypher.includes('HOLDS_CLAIM') || cypher.includes('HOLDS_VOUCHER')) return []
      if (cypher.includes('MATCH (s:Sale)') || cypher.includes('MATCH (a:Airdrop)')) return []
      if (cypher.includes(':Trade {id:'))
        return [
          {
            trade: {
              properties: {
                id: '0xt1',
                a: '0xme',
                b: '0xher',
                version: 2,
                accept_a: false,
                accept_b: false,
                locked: false,
                sui_a: '0',
                sui_b: '1000',
                caps_a: '[]',
                caps_b: '[]',
              },
            },
          },
        ]
      if (cypher.includes(':Trade')) return []
      if (cypher.includes('LISTED_IN')) return []
      if (cypher.includes(':Zone')) return []
      if (cypher.includes(':Item {id:'))
        return [
          {
            item: {
              properties: { id: '0xi1', name: 'hat', item_type: 'straw_hat', category: 'hat', level: 3, amount: 1 },
            },
          },
        ]
      return [{ character, kiosk: '0xk', equipment: [], label: 'User', count: 1 }]
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
      // eslint-disable-next-line fp-law/no-mutating-methods -- the test bus intentionally records its ordered output.
      published.push({ channel, payload })
      emitter.emit(channel, payload)
    },
    close: () => {},
  }
  const pubsub = {
    emitter,
    graph: { ...bus, indexed_checkpoint: async () => 1, sales_history: async () => [] },
    mesh: { ...bus, heartbeat: async () => {}, cluster_online: async () => 7 },
  }
  return { sent, ws, graph, pubsub, published }
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

export const embody = async (player: { on_message: (raw: string) => void }) => {
  player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
}
