// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ClientPacket, AgentSetupResult } from '@aresrpg/protocol'

import { observe_agent_setup_requests } from '../../src/agents/setup_requests.ts'
import type { AuthSession } from '../../src/auth.ts'
import type { AppContext, AppState } from '../../src/store.ts'

test('setup reuses session packet IDs and cancels a late begin after session invalidation', async () => {
  const events = new EventEmitter()
  const signal = new AbortController()
  const wallet = { address: 'owner' } as AuthSession
  const state = { session: { wallet } } as AppState
  const sent: ClientPacket[] = []
  let id = 0
  observe_agent_setup_requests(
    { events, get_state: () => state, signal: signal.signal } as unknown as AppContext,
    (packet) => {
      sent.push(packet)
      return true
    },
    () => ++id
  )
  const first = new Promise<AgentSetupResult>((resolve, reject) =>
    events.emit('agent_setup/request', {
      wallet,
      request: { action: 'begin', public_identifier: 'public', token: 'capability' },
      resolve,
      reject,
    })
  )
  expect(sent[0]).toEqual({
    type: 'packet/agent_setup_request',
    id: 1,
    request: { action: 'begin', public_identifier: 'public', token: 'capability' },
  })
  events.emit('server/packet', {
    packet: {
      type: 'packet/agent_setup_response',
      id: 1,
      result: { action: 'begin', pairing_id: 'first', token: 'capability' },
    },
  })
  expect(await first).toEqual({ action: 'begin', pairing_id: 'first', token: 'capability' })
  const pending = new Promise<AgentSetupResult>((resolve, reject) =>
    events.emit('agent_setup/request', {
      wallet,
      request: { action: 'begin', public_identifier: 'public', token: 'capability' },
      resolve,
      reject,
    })
  )
  events.emit('STATE_UPDATED', { session: { wallet: null } }, state)
  await expect(pending).rejects.toThrow('SETUP_UNAVAILABLE')
  events.emit('server/packet', {
    packet: {
      type: 'packet/agent_setup_response',
      id: 2,
      result: { action: 'begin', pairing_id: 'late', token: 'never-displayed' },
    },
  })
  expect(sent.at(-1)).toEqual({
    type: 'packet/agent_setup_request',
    id: 4,
    request: { action: 'cancel', pairing_id: 'late', token: 'never-displayed' },
  })
  signal.abort()
})

test('an old attempt cannot remove the current token from session cleanup', async () => {
  const events = new EventEmitter()
  const signal = new AbortController()
  const wallet = { address: 'owner' } as AuthSession
  const state = { session: { wallet } } as AppState
  const sent: ClientPacket[] = []
  let id = 0
  observe_agent_setup_requests(
    { events, get_state: () => state, signal: signal.signal } as unknown as AppContext,
    (packet) => {
      sent.push(packet)
      return true
    },
    () => ++id
  )
  const request = async (input: import('@aresrpg/protocol').AgentSetupRequest, result: AgentSetupResult) => {
    const pending = new Promise<AgentSetupResult>((resolve, reject) =>
      events.emit('agent_setup/request', { wallet, request: input, resolve, reject })
    )
    events.emit('server/packet', { packet: { type: 'packet/agent_setup_response', id, result } })
    return pending
  }
  for (const token of ['old', 'current'])
    await request(
      { action: 'begin', public_identifier: 'public', token },
      { action: 'begin', pairing_id: 'shared', token }
    )
  await request({ action: 'cancel', pairing_id: 'shared', token: 'old' }, { action: 'error', error: 'unavailable' })
  signal.abort()
  expect(sent.at(-1)).toEqual({
    type: 'packet/agent_setup_request',
    id: 4,
    request: { action: 'cancel', pairing_id: 'shared', token: 'current' },
  })
})
