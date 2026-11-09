// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentTransport } from '@aresrpg/sdk/agent-connection'

import { create_bot_actor } from '../src/actor.ts'
const address = `0x${'1'.repeat(64)}`
const fixture = (authorize_observation?: (owner: string) => Promise<void>) => {
  const sessions: { handlers: Parameters<AgentTransport['open']>[1]; closed: boolean; sent: string[] }[] = []
  let live = true
  let resyncs = 0
  let signs = 0
  const actor = create_bot_actor({
    connection: {
      endpoint: 'ws://127.0.0.1:0/',
      origin: 'https://aresrpg.world',
      signer: {
        address,
        sign_personal_message: async (message) => {
          signs += 1
          return { bytes: Buffer.from(message).toString('base64'), signature: 'fixture' }
        },
      },
      transport: {
        open: (_, handlers) => {
          const session = { handlers, closed: false, sent: [] as string[] }
          sessions.push(session)
          return {
            send: (raw) => {
              session.sent.push(raw)
            },
            close: () => {
              session.closed = true
            },
          }
        },
      },
    },
    authorize: async () => {
      if (!live) throw new Error('LEASE_LOST')
    },
    authorize_observation,
    needs_resync: async () => {
      resyncs += 1
    },
    observe: async () => undefined,
    report_failure: (error) => {
      throw error
    },
  })
  const send = async (packet: unknown) => sessions.at(-1)!.handlers.on_message(JSON.stringify(packet))
  const admit = async () => {
    await send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
    await send({ type: 'packet/connection_accepted', address })
    await send({ type: 'packet/characters', characters: [] })
    await actor.settle_observations()
  }
  return {
    actor,
    sessions,
    send,
    admit,
    lose: () => {
      live = false
    },
    signs: () => signs,
    resyncs: () => resyncs,
  }
}
test('concurrent connectors share one ordinary socket and require fresh baseline', async () => {
  const f = fixture()
  await Promise.all([f.actor.connect(), f.actor.connect()])
  expect(f.sessions).toHaveLength(1)
  expect(f.resyncs()).toBeGreaterThan(0)
  await f.admit()
  expect(f.actor.state().status).toBe('ready')
  await f.actor.connect()
  expect(f.sessions).toHaveLength(1)
  await f.actor.stop()
})
test('lost lease rejects challenge signing and permanently retires actor', async () => {
  const f = fixture()
  await f.actor.connect()
  f.lose()
  await f.send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
  expect(f.signs()).toBe(0)
  expect(f.sessions[0]!.closed).toBe(true)
  await expect(f.actor.connect()).rejects.toThrow('TERMINAL')
  await f.actor.stop()
})
test('market and price observation have distinct exclusive slots', async () => {
  const f = fixture()
  await f.actor.connect()
  await f.admit()
  await f.actor.observe('chatgpt', { type: 'packet/market_observe', observation: { kind: 'overview', request: 1 } })
  await expect(
    f.actor.observe('claude', { type: 'packet/market_observe', observation: { kind: 'overview', request: 2 } })
  ).rejects.toThrow('BUSY')
  await f.actor.observe('claude', { type: 'packet/market_prices_observe', observation: { item_type: 'wood', id: 1 } })
  await f.actor.observe('chatgpt', { type: 'packet/market_observe', observation: null })
  await f.actor.observe('claude', { type: 'packet/market_observe', observation: { kind: 'overview', request: 2 } })
  await expect(f.actor.send({ type: 'packet/market_observe', observation: null })).rejects.toThrow('ARBITRATED')
  await f.actor.stop()
})
test('heartbeat lease failure closes idle socket before further traffic', async () => {
  const f = fixture()
  await f.actor.connect()
  await f.admit()
  f.lose()
  await expect(f.actor.check_lease()).rejects.toThrow('LEASE_LOST')
  expect(f.sessions[0]!.closed).toBe(true)
  await f.actor.stop()
})

test('transient reconnect restores each retained watch on the same new root socket', async () => {
  const f = fixture()
  await f.actor.connect()
  await f.admit()
  const packet = { type: 'packet/market_observe' as const, observation: { kind: 'overview' as const, request: 1 } }
  await f.actor.observe('chatgpt', packet)
  f.sessions[0]!.handlers.on_close(1006, 'NETWORK_LOST')
  await f.actor.settle_observations()
  await f.actor.connect()
  await f.admit()
  expect(f.sessions).toHaveLength(2)
  expect(f.sessions[1]!.sent.map((raw) => JSON.parse(raw))).toContainEqual(packet)
  await f.actor.stop()
})
test('explicit offline watch release cannot return after reconnect', async () => {
  const f = fixture()
  await f.actor.connect()
  await f.admit()
  await f.actor.observe('chatgpt', { type: 'packet/market_observe', observation: { kind: 'overview', request: 1 } })
  f.sessions[0]!.handlers.on_close(1006, 'NETWORK_LOST')
  await f.actor.observe('chatgpt', { type: 'packet/market_observe', observation: null })
  await f.actor.connect()
  await f.admit()
  expect(f.sessions[1]!.sent).toHaveLength(1)
  await f.actor.stop()
})
