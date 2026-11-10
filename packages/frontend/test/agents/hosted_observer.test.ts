// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, spyOn, test } from 'bun:test'

import { observe_hosted_agent } from '../../src/modules/hosted_agent.ts'
import * as hosted from '../../src/agents/hosted_client.ts'
import { owner_connected } from '../../src/agents/owner_state.ts'
import { reduce_app_state, type AppInput } from '../../src/store.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const fixture = () => {
  const original = automation_fixture()
  const wallet = { ...original.session.wallet!, identity: 'zklogin' as const }
  let state = { ...original, session: { ...original.session, wallet } }
  const events = new EventEmitter()
  const controller = new AbortController()
  const window_fixture = new EventTarget()
  const globals = { window: window_fixture, document: { visibilityState: 'visible' }, location: { search: '' } }
  const descriptors = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  let pulse = () => {}
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
    pulse = callback
    return 1
  }) as typeof setInterval)
  const clear = spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const pairing = { address: 'agent', multisig_public_key: 'descriptor', signer_mode: 'host-persistent' as const }
  let status = 503
  let connected = true
  let calls = 0
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation((async () => {
    calls++
    if (status !== 200) return new Response('Service unavailable', { status })
    return Response.json({
      response: {
        owner: wallet.address,
        status: connected ? 'connected' : 'disconnected',
        expires_at: Date.now() + 60_000,
        recovery_bots: [],
        bot: { id: 'bot', ...pairing, status: 'ready', generation: 1, policy_revision: 1 },
      },
      pairing: connected ? pairing : null,
    })
  }) as unknown as typeof fetch)
  // The owner verification boundary has its own real cryptographic fixture tests. Here the HTTP client,
  // observer, timer and session reducer exercise transport recovery without signing or network access.
  const refresh = spyOn(hosted, 'refresh_hosted_owner').mockImplementation((client) =>
    client.request('/fixture/status')
  )
  const dispatch = (input: AppInput) => {
    const previous = state
    state = reduce_app_state(state, input) as typeof state
    events.emit('STATE_UPDATED', state, previous)
    events.emit(input.type, input)
  }
  observe_hosted_agent(
    { events, dispatch, get_state: () => state, signal: controller.signal } as never,
    'https://fixture.test'
  )
  return {
    dispatch,
    state: () => state,
    calls: () => calls,
    pulse: () => pulse(),
    status: (next: number) => {
      status = next
    },
    revoke: () => {
      connected = false
    },
    close: () => {
      controller.abort()
      refresh.mockRestore()
      fetcher.mockRestore()
      interval.mockRestore()
      clear.mockRestore()
      warn.mockRestore()
      for (const key of Object.keys(globals)) {
        const descriptor = descriptors[key]
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('temporary 503 clears active display and the existing timer recovers; true revocation stays disconnected', async () => {
  const f = fixture()
  try {
    await tick()
    expect(f.state().session.agent_connection.phase).toBe('unavailable')
    expect(owner_connected(f.state().session)).toBe(false)
    f.status(200)
    f.pulse()
    await tick()
    expect(owner_connected(f.state().session)).toBe(true)
    f.status(503)
    f.pulse()
    await tick()
    expect(owner_connected(f.state().session)).toBe(false)
    f.status(200)
    f.pulse()
    await tick()
    expect(owner_connected(f.state().session)).toBe(true)
    f.revoke()
    f.pulse()
    await tick()
    expect(f.state().session.agent_connection.phase).toBe('ready')
    expect(owner_connected(f.state().session)).toBe(false)
  } finally {
    f.close()
  }
})

test('explicit cancellation does not automatically retry a temporary failure or reopen consent', async () => {
  const f = fixture()
  try {
    await tick()
    f.dispatch({ type: 'agent/connection_cancel' })
    const before = f.calls()
    f.status(200)
    f.pulse()
    await tick()
    expect(f.calls()).toBe(before)
    expect(owner_connected(f.state().session)).toBe(false)
    f.dispatch({ type: 'agent/connection_refresh' })
    await tick()
    expect(owner_connected(f.state().session)).toBe(true)
  } finally {
    f.close()
  }
})

test('an owner-session refusal stops automatic refresh until an explicit retry', async () => {
  const f = fixture()
  try {
    await tick()
    f.status(401)
    f.pulse()
    await tick()
    expect(f.state().session.agent_connection.phase).toBe('failed')
    const before = f.calls()
    f.status(200)
    f.pulse()
    await tick()
    expect(f.calls()).toBe(before)
    expect(owner_connected(f.state().session)).toBe(false)
  } finally {
    f.close()
  }
})
