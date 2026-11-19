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
import { channels, mesh } from '../src/protocol.ts'

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
    // What locks items of the bag travels with it: the account's trades, beside its own listings.
    expect(f.sent).toContainEqual({
      type: 'packet/inventory_observed',
      id: 1,
      packet: { type: 'packet/trades', trades: [] },
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

test('a bot status reaches the owner watching that wallet, and only under the address of its own socket', async () => {
  const f = fixture()
  const status = { ready: true, event_fence: 3, sampled_at: 10, state: 'idle' as const, runs: [], direct: null }
  const socket = (address: string) => {
    const events = new EventEmitter()
    const controller = new AbortController()
    const received: ServerPacket[] = []
    inventory_observation.observe({
      events,
      signal: controller.signal,
      address,
      pubsub: f.pubsub,
      send: (packet: ServerPacket) => {
        received.push(packet)
      },
    } as unknown as PlayerContext)
    return { events, controller, received }
  }
  const observed = () => f.sent.filter((packet) => packet.type === 'packet/inventory_observed').at(-1)
  try {
    const bot = socket(identity.address)
    f.watch()
    await settle()
    // The stream has no stored snapshot: a new watcher asks the wallet's own socket.
    expect(f.published).toContainEqual({ channel: mesh.agent_status_wanted(identity.address), payload: null })
    // A socket that never shared a status is not a bot: it is asked nothing.
    expect(bot.received).toEqual([])
    const before = f.sent.length
    socket(`0x${'9'.repeat(64)}`).events.emit('packet/agent_status', { status })
    await settle()
    expect(f.sent.length).toBe(before)
    bot.events.emit('packet/agent_status', { status })
    await settle()
    expect(f.published).toContainEqual({ channel: mesh.agent_status(identity.address), payload: status })
    expect(observed()).toEqual({
      type: 'packet/inventory_observed',
      id: 1,
      packet: { type: 'packet/agent_status', status },
    })
    // A second owner session starts watching: the bot's socket is asked, and never told its own status.
    f.watch(2)
    await settle()
    expect(bot.received).toEqual([{ type: 'packet/agent_status_wanted' }])
    // The bot's socket closes: the watcher is told, and asks whichever socket holds the wallet now.
    const asked = () => f.published.filter(({ channel }) => channel === mesh.agent_status_wanted(identity.address))
    const requests = asked().length
    bot.controller.abort()
    await settle()
    expect(observed()).toEqual({
      type: 'packet/inventory_observed',
      id: 2,
      packet: { type: 'packet/agent_status', status: null },
    })
    expect(asked()).toHaveLength(requests + 1)
  } finally {
    f.controller.abort()
  }
})
