// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { create_agent_connection, type AgentConnectionOptions, type AgentTransport } from '../src/agent_connection.ts'

const address = `0x${'1'.repeat(64)}`
const fight = `0x${'2'.repeat(64)}`
const challenge = { type: 'packet/signature_request', payload: '01234567-0123-4567-89ab-0123456789ab' }
const acceptance = { type: 'packet/connection_accepted', address }
// Synthetic projection fixture: tests exercise client admission/lifecycle, not wire decoding.
const character: CharacterRow = {
  id: `0x${'3'.repeat(64)}`,
  name: 'Fixture',
  classe: 'iop',
  sex: 'male',
  level: 1,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  kiosk: `0x${'4'.repeat(64)}`,
  equipment: [],
  custody: 'fight',
  active_fight: { id: fight, seat: 0 },
}
const roster = { type: 'packet/characters', characters: [character] }
type Handlers = Parameters<AgentTransport['open']>[1]
const fixture = (sign?: AgentConnectionOptions['signer']['sign_personal_message']) => {
  const sessions: { handlers: Handlers; sent: string[]; closed: boolean; url: string }[] = []
  const messages: Uint8Array[] = []
  const client = create_agent_connection({
    endpoint: 'ws://127.0.0.1:0/',
    origin: 'https://aresrpg.world',
    signer: {
      address,
      sign_personal_message: async (message) => {
        messages.push(message)
        return sign ? sign(message) : { bytes: Buffer.from(message).toString('base64'), signature: 'fake-proof' }
      },
    },
    transport: {
      open: (url, handlers) => {
        const session = { handlers, sent: [] as string[], closed: false, url }
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
  })
  const send = async (packet: unknown, index = sessions.length - 1) =>
    sessions[index].handlers.on_message(JSON.stringify(packet))
  const admit = async () => {
    await send(challenge)
    await send(acceptance)
    await send(roster)
  }
  return { client, sessions, messages, send, admit }
}

test('signing is restricted to one exact server challenge and acceptance identity', async () => {
  const { client, sessions, messages, send } = fixture()
  client.connect()
  expect(sessions[0].url).toBe(`ws://127.0.0.1:0/?address=${address}`)
  expect(client.request_fight_resync(fight)).toBe(false)
  await send(challenge)
  expect(new TextDecoder().decode(messages[0])).toBe(`aresrpg::${challenge.payload}`)
  expect(JSON.parse(sessions[0].sent[0])).toEqual({
    type: 'packet/signature_response',
    bytes: Buffer.from(messages[0]).toString('base64'),
    signature: 'fake-proof',
  })
  await send({ ...acceptance, address: fight })
  expect(client.state().status).toBe('failed')
  expect(sessions[0].closed).toBe(true)
})

test('unsolicited acceptance, invalid challenges and pre-admission rosters fail closed', async () => {
  for (const packet of [acceptance, roster, { ...challenge, payload: 'sign arbitrary data' }]) {
    const { client, messages, send } = fixture()
    client.connect()
    await send(packet)
    expect(client.state().status).toBe('failed')
    expect(messages).toHaveLength(0)
  }
})

test('duplicate challenges and signer byte substitutions are rejected', async () => {
  const first = fixture()
  first.client.connect()
  await first.send(challenge)
  await first.send(challenge)
  expect(first.messages).toHaveLength(1)
  expect(first.client.state().status).toBe('failed')
  const second = fixture(async () => ({ bytes: 'wrong', signature: 'fake-proof' }))
  second.client.connect()
  await second.send(challenge)
  expect(second.sessions[0].sent).toHaveLength(0)
  expect(second.client.state().status).toBe('failed')
})

test('read-only resync requires a fresh owned fight roster and never replays on reconnect', async () => {
  const { client, sessions, send, admit } = fixture()
  client.connect()
  await send(challenge)
  await send({ type: 'packet/game_state', frozen: false })
  await send(acceptance)
  expect(client.state().status).toBe('resyncing')
  expect(client.request_fight_resync(fight)).toBe(false)
  await send(roster)
  expect(client.request_fight_resync(address)).toBe(false)
  expect(client.request_fight_resync(fight)).toBe(true)
  expect(JSON.parse(sessions[0].sent[1])).toEqual({ type: 'packet/fight_resync', fight })
  client.reconnect()
  expect(client.state().characters).toEqual([])
  expect(sessions[0].closed).toBe(true)
  expect(sessions[1].sent).toEqual([])
  await send(roster, 0)
  expect(client.state().characters).toEqual([])
  await admit()
  expect(sessions[1].sent).toHaveLength(1)
  await send({ type: 'packet/characters', characters: [] })
  expect(client.request_fight_resync(fight)).toBe(false)
})

test('disconnect invalidates an in-flight proof and stop prevents reconnect', async () => {
  let resolve: ((proof: { bytes: string; signature: string }) => void) | undefined
  const { client, sessions, messages, send } = fixture(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  client.connect()
  const pending = send(challenge)
  await Promise.resolve()
  client.disconnect()
  resolve!({ bytes: Buffer.from(messages[0]).toString('base64'), signature: 'fake-proof' })
  await pending
  expect(sessions[0].sent).toHaveLength(0)
  expect(client.state().status).toBe('disconnected')
  client.connect()
  client.stop()
  client.reconnect()
  expect(sessions).toHaveLength(2)
  expect(client.state().status).toBe('stopped')
})

test('takeover closes permanently, and returned snapshots cannot mutate authority', async () => {
  const { client, sessions, admit } = fixture()
  client.connect()
  await admit()
  const snapshot = client.state()
  snapshot.characters[0].custody = 'kiosk'
  expect(client.request_fight_resync(fight)).toBe(true)
  sessions[0].handlers.on_close(1008, 'ALREADY_CONNECTED')
  client.connect()
  expect(sessions).toHaveLength(1)
  expect(client.state().characters).toEqual([])
  expect(client.state().status).toBe('stopped')
})

test('malformed roster and malformed JSON retire the connection', async () => {
  const { client, send, sessions } = fixture()
  client.connect()
  await send(challenge)
  await send(acceptance)
  await send({ type: 'packet/characters', characters: [{ ...character, active_fight: { id: fight, seat: -1 } }] })
  expect(client.state().status).toBe('failed')
  client.connect()
  await sessions[1].handlers.on_message('{')
  expect(client.state().status).toBe('failed')
})
