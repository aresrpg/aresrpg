// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { parse_client_packet, type ServerPacket } from '@aresrpg/protocol'
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'

import inventory_observation from '../src/modules/player_inventory_observation.ts'
import { create_inventory_reader } from '../src/inventory_reader.ts'
import type { PlayerContext } from '../src/player.ts'
import { channels } from '../src/protocol.ts'

import { wire, flush } from './helpers/world_wire.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const identity = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(4)),
  zklogin_public_identifier: google,
})
const observation = {
  character_id: null,
  public_identifier: google.toBase64(),
  pairing: {
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: 'host-persistent' as const,
  },
}
const item = { id: 'item', version: '1', item_type: 'wheat', category: 'resource', name: 'Wheat', amount: 2, level: 1 }
const settle = async () => {
  for (let index = 0; index < 8; index++) await flush()
}
const fixture = () => {
  const base = wire({ owns: false })
  const events = new EventEmitter()
  const controller = new AbortController()
  const sent: ServerPacket[] = []
  const reads: string[] = []
  const graph = {
    ...base.graph,
    read: async (query: string, params?: Record<string, unknown>) => {
      reads.push(String(params?.address))
      return query.includes('[:HOLDS]->(i:Item)') ? [{ item: { properties: item }, kiosk: 'kiosk' }] : []
    },
  }
  inventory_observation.observe({
    events,
    signal: controller.signal,
    address: google.toSuiAddress(),
    graph,
    pubsub: base.pubsub,
    channels,
    send: (packet: ServerPacket) => {
      sent.push(packet)
    },
    dispatch: () => {
      throw new Error('Inventory must never grant character control')
    },
  } as unknown as PlayerContext)
  const watch = (id = 1, request: typeof observation | null = observation) =>
    events.emit('packet/inventory_observe', { id, observation: request })
  return { ...base, graph, events, controller, sent, reads, watch }
}

test('foreign pairing is rejected before any indexed read', async () => {
  const f = fixture()
  try {
    f.watch(1, { ...observation, pairing: { ...observation.pairing, address: `0x${'9'.repeat(64)}` } })
    await settle()
    expect(f.reads).toEqual([])
    expect(f.sent).toEqual([{ type: 'packet/inventory_observed', id: 1, packet: null }])
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/inventory_observe', id: -1, observation }))
    ).toThrow()
  } finally {
    f.controller.abort()
  }
})

test('verified inventory uses indexed baseline and streams the same item deltas until cancellation', async () => {
  const f = fixture()
  try {
    f.watch()
    await settle()
    expect(f.reads.every((address) => address === identity.address)).toBe(true)
    expect(f.sent.at(-1)).toMatchObject({
      type: 'packet/inventory_observed',
      id: 1,
      packet: {
        type: 'packet/inventory',
        items: [{ ...item, kiosk: 'kiosk' }],
      },
    })
    const delta = { type: 'packet/item_removed' as const, item: item.id, version: '2' }
    f.pubsub.emitter.emit(channels.social(identity.address), { type: 'ItemProjected', data: { packet: delta } })
    expect(f.sent.at(-1)).toEqual({ type: 'packet/inventory_observed', id: 1, packet: delta })
    f.watch(2, null)
    const before = f.sent.length
    f.pubsub.emitter.emit(channels.social(identity.address), { type: 'ItemProjected', data: { packet: delta } })
    await settle()
    expect(f.sent.length).toBe(before)
  } finally {
    f.controller.abort()
  }
})

test('shared baseline rereads when an item delta overtakes its pending graph read', async () => {
  const base = wire({ owns: false })
  const controller = new AbortController()
  const pending = Promise.withResolvers<void>()
  const sent: ServerPacket[] = []
  let count = 0
  const graph = {
    ...base.graph,
    read: async () => {
      count += 1
      if (count === 1) {
        await pending.promise
        return []
      }
      return [{ item: { properties: item }, kiosk: 'kiosk' }]
    },
  }
  const { read } = create_inventory_reader({
    graph,
    pubsub: base.pubsub,
    address: 'owner',
    signal: controller.signal,
    send: (packet) => {
      sent.push(packet)
    },
  })
  try {
    const result = read()
    await settle()
    const delta = { type: 'packet/item_updated' as const, item: { ...item, kiosk: 'kiosk' } }
    base.pubsub.emitter.emit(channels.social('owner'), { type: 'ItemProjected', data: { packet: delta } })
    pending.resolve()
    expect(await result).toEqual([{ ...item, kiosk: 'kiosk' }])
    expect(count).toBe(2)
    expect(sent).toEqual([delta])
  } finally {
    pending.resolve()
    controller.abort()
  }
})
