// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import { create_app } from '../../src/store.ts'
import { initial_suins_state, reduce_suins } from '../../src/modules/suins.ts'

const tick = () => Bun.sleep(0)
const pairing = {
  address: '0x2',
  multisig_public_key: 'fixture',
  signer_mode: 'host-persistent',
} as AgentPairingIdentity
const snapshot = { default_name: 'aresrpg.child.sceat.sui', names: [] }
const fixture = () => {
  const app = create_app()
  const calls: string[] = []
  const state = {
    refuse: false,
    no_gas: false,
    pause: null as Promise<void> | null,
    guard: null as (() => void) | null,
    agent_error: null as Error | null,
  }
  const wallet = {
    address: '0x1',
    identity: 'zklogin',
    suins: {
      managed: true,
      snapshot: async () => snapshot,
      validate_parent: async (name: string, guard: () => void) => {
        expect(name).toBe('child.sceat.sui')
        calls.push('validate')
        state.guard = guard
        if (state.pause) await state.pause
        guard()
        if (state.refuse) throw new Error('collision', { cause: 'collision' })
      },
      apply_parent: async (name: string, agent: string, guard: () => void) => {
        guard()
        expect(agent).toBe(pairing.address)
        calls.push('human')
        return { name: `aresrpg.${name}` }
      },
    },
    set_agent_default: async (_pairing: AgentPairingIdentity, name: string, guard: () => void) => {
      guard()
      expect(name).toBe('aresrpgagent.child.sceat.sui')
      calls.push('agent')
      if (state.agent_error) throw state.agent_error
      if (state.no_gas) throw new Error('[sdk] transaction resolution failed — NOT submitted: InsufficientGas')
    },
    read_agent_balances: async () => ({ sui_balance_mist: 0n }),
  }
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  const stop = app.observe(['suins'])
  return { app, calls, state, stop, wallet }
}

test('explicit setup awaits both senders and coalesces duplicate proofs without replay', async () => {
  const f = fixture()
  try {
    await tick()
    const pause = Promise.withResolvers<void>()
    f.state.pause = pause.promise
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'duplicate' })
    expect(f.app.store.getState().suins.completed).toEqual([])
    pause.resolve()
    await tick()
    expect(f.calls).toEqual(['validate', 'human', 'agent'])
    expect(f.app.store.getState().suins.completed).toEqual(['first', 'duplicate'])
    // A new explicit intent can repair the same identity; status changes cannot.
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'fresh' })
    await tick()
    expect(f.calls).toHaveLength(6)
  } finally {
    f.stop()
  }
})

test.each(['collision', 'funding'] as const)(
  'terminal %s consumes overlaps without automatic retry',
  async (reason) => {
    const f = fixture()
    try {
      await tick()
      f.state.refuse = reason === 'collision'
      f.state.no_gas = reason === 'funding'
      const pause = Promise.withResolvers<void>()
      f.state.pause = pause.promise
      f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
      await tick()
      f.app.dispatch({ type: 'suins/setup', pairing, token: 'overlap' })
      pause.resolve()
      await tick()
      const result = f.app.store.getState().suins
      expect(result.completed).toEqual(['first', 'overlap'])
      expect(result.request).toBeNull()
      expect(f.calls.filter((call) => call === 'validate')).toHaveLength(1)
      if (reason === 'funding') {
        expect(result.pending).toEqual({ pairing, reason: 'funding' })
        expect(result.snapshot?.default_name).toBe(snapshot.default_name)
      } else expect(result.error).toBe('collision')
    } finally {
      f.stop()
    }
  }
)

test('wallet replacement invalidates unsigned work before the next sender', async () => {
  const f = fixture()
  try {
    await tick()
    const pause = Promise.withResolvers<void>()
    f.state.pause = pause.promise
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
    await tick()
    f.app.dispatch({ type: 'auth/disconnected' })
    expect(() => f.state.guard!()).toThrow('cancelled')
    pause.resolve()
    await tick()
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins).toEqual(initial_suins_state())
  } finally {
    f.stop()
  }
})

test('cancelling setup during a pending snapshot cannot start a later write', () => {
  let state = reduce_suins(initial_suins_state(), { type: 'suins/setup', pairing, token: 'setup' })
  const request = state.request!
  state = reduce_suins(state, { type: 'suins/cancel_setup', token: 'setup' })
  state = reduce_suins(state, { type: 'suins/loaded', request, snapshot })
  expect(state.request).toBeNull()
  expect(state.setup).toBeNull()
})

test('setup overlapping Apply attaches a waiter without changing or replaying its request', () => {
  let state = reduce_suins(initial_suins_state(), { type: 'suins/name_changed', name: 'sceat.sui' })
  state = reduce_suins(state, { type: 'suins/use' })
  const request = state.request!
  state = reduce_suins(state, { type: 'suins/setup', pairing, token: 'setup' })
  expect(state.request).toBe(request)
  state = reduce_suins(state, { type: 'suins/failed', request, error: 'write_failed' })
  expect(state.completed).toEqual(['setup'])
  expect(state.request).toBeNull()
})

test('external wallets refresh existing defaults but never admit managed writes', async () => {
  const f = fixture()
  try {
    await tick()
    const external = { ...f.wallet, identity: 'wallet', suins: { ...f.wallet.suins, managed: false } }
    f.app.dispatch({ type: 'auth/disconnected' })
    f.app.dispatch({ type: 'auth/connecting' })
    f.app.dispatch({ type: 'auth/connected', session: external as never })
    await tick()
    f.app.dispatch({ type: 'suins/name_changed', name: 'child.sceat.sui' })
    f.app.dispatch({ type: 'suins/use' })
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'ignored' })
    expect(f.calls).toEqual([])
    expect(f.app.store.getState().suins.snapshot).toEqual(snapshot)
  } finally {
    f.stop()
  }
})

test('setup intent reserved before proof is consumed by overlapping refused Apply', () => {
  let state = reduce_suins(initial_suins_state(), { type: 'suins/setup_started', token: 'connect' })
  state = reduce_suins(state, { type: 'suins/name_changed', name: 'sceat.sui' })
  state = reduce_suins(state, { type: 'suins/use' })
  state = reduce_suins(state, { type: 'suins/failed', request: state.request!, error: 'write_failed' })
  const completed = state
  state = reduce_suins(state, { type: 'suins/setup', pairing, token: 'connect' })
  expect(state).toBe(completed)
  expect(state.completed).toEqual(['connect'])
})

test('Settings closing cancels unsigned Apply and completes waiting Connect without cancelling setup-only repair', () => {
  let state = reduce_suins(initial_suins_state(), { type: 'suins/name_changed', name: 'sceat.sui' })
  state = reduce_suins(state, { type: 'suins/use' })
  state = reduce_suins(state, { type: 'suins/setup', pairing, token: 'connect' })
  state = reduce_suins(state, { type: 'suins/close' })
  expect(state.request).toBeNull()
  expect(state.completed).toEqual(['connect'])
  state = reduce_suins(state, { type: 'suins/setup', pairing, token: 'next' })
  state = reduce_suins(state, { type: 'suins/loaded', request: state.request!, snapshot })
  expect(reduce_suins(state, { type: 'suins/close' })).toBe(state)
})

test.each([
  ['uncertain', new Error('[sdk] transaction outcome unknown: digest; check this transaction before trying again')],
  ['refused', Object.assign(new Error('Declined'), { code: 4001 })],
  ['failed', new Error('[sdk] transaction digest failed on-chain: abort')],
] as const)('agent %s remains distinct despite zero balance after human success', async (reason, error) => {
  const f = fixture()
  try {
    await tick()
    f.state.agent_error = error
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'setup' })
    await tick()
    expect(f.app.store.getState().suins.pending?.reason).toBe(reason)
    expect(f.app.store.getState().suins.snapshot?.default_name).toBe(snapshot.default_name)
    expect(f.calls).toEqual(['validate', 'human', 'agent'])
    await tick()
    expect(f.calls).toHaveLength(3)
  } finally {
    f.stop()
  }
})

test('accepted navigation out of Settings retires deferred validation before custody or either sender', async () => {
  const f = fixture()
  try {
    f.app.dispatch({ type: 'page/open', page: 'settings' })
    await tick()
    const paused = Promise.withResolvers<void>()
    f.state.pause = paused.promise
    f.app.dispatch({ type: 'suins/name_changed', name: 'child.sceat.sui' })
    f.app.dispatch({ type: 'suins/use' })
    expect(f.calls).toEqual(['validate'])
    f.app.dispatch({ type: 'page/open', page: 'world' })
    expect(f.app.store.getState().navigation.page).toBe('world')
    expect(f.app.store.getState().suins.request).toBeNull()
    paused.resolve()
    await tick()
    expect(f.calls).toEqual(['validate'])
  } finally {
    f.stop()
  }
})
