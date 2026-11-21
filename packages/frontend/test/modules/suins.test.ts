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
    unchanged: false,
  }
  const wallet = {
    address: '0x1',
    identity: 'zklogin',
    read_agent_pairing_request: () => ({ owner: '0x1' }),
    suins: {
      managed: true,
      set_default: async (_name: string, guard: () => void) => {
        guard()
        calls.push('default')
      },
      snapshot: async () => snapshot,
      validate_parent: async (name: string, guard: () => void) => {
        expect(name).toBe('child.sceat.sui')
        calls.push('validate')
        state.guard = guard
        if (state.pause) await state.pause
        guard()
        if (state.refuse) throw new Error('collision', { cause: 'collision' })
      },
      review_parent: async (_name: string, agent: string, guard: () => void, player: string) => {
        guard()
        return {
          fingerprint: 'review',
          player_address: player,
          agent_address: agent,
          erased_names: ['aresrpg.child.sceat.sui'],
          unchanged: state.unchanged,
        }
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

// Existing reconciliation scenarios explicitly accept the new review before continuing.
const advance = async (f: ReturnType<typeof fixture>) => {
  await tick()
  const { request } = f.app.store.getState().suins
  if (request?.kind === 'set' && request.stage === 'review') {
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
  }
}

test('explicit setup awaits both senders and coalesces duplicate proofs without replay', async () => {
  const f = fixture()
  try {
    await advance(f)
    const pause = Promise.withResolvers<void>()
    f.state.pause = pause.promise
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
    await advance(f)
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'duplicate' })
    expect(f.app.store.getState().suins.completed).toEqual([])
    pause.resolve()
    await advance(f)
    expect(f.calls).toEqual(['validate', 'human', 'agent'])
    expect(f.app.store.getState().suins.completed).toEqual(['first', 'duplicate'])
    // A new explicit intent can repair the same identity; status changes cannot.
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'fresh' })
    await advance(f)
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
      await advance(f)
      f.state.refuse = reason === 'collision'
      f.state.no_gas = reason === 'funding'
      const pause = Promise.withResolvers<void>()
      f.state.pause = pause.promise
      f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
      await advance(f)
      f.app.dispatch({ type: 'suins/setup', pairing, token: 'overlap' })
      pause.resolve()
      await advance(f)
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
    await advance(f)
    const pause = Promise.withResolvers<void>()
    f.state.pause = pause.promise
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
    await advance(f)
    f.app.dispatch({ type: 'auth/disconnected' })
    expect(() => f.state.guard!()).toThrow('cancelled')
    pause.resolve()
    await advance(f)
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
    await advance(f)
    const external = { ...f.wallet, identity: 'wallet', suins: { ...f.wallet.suins, managed: false } }
    f.app.dispatch({ type: 'auth/disconnected' })
    f.app.dispatch({ type: 'auth/connecting' })
    f.app.dispatch({ type: 'auth/connected', session: external as never })
    await advance(f)
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
    await advance(f)
    f.state.agent_error = error
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'setup' })
    await advance(f)
    expect(f.app.store.getState().suins.pending?.reason).toBe(reason)
    expect(f.app.store.getState().suins.snapshot?.default_name).toBe(snapshot.default_name)
    expect(f.calls).toEqual(['validate', 'human', 'agent'])
    await advance(f)
    expect(f.calls).toHaveLength(3)
  } finally {
    f.stop()
  }
})

test('accepted navigation out of Settings retires deferred validation before custody or either sender', async () => {
  const f = fixture()
  try {
    f.app.dispatch({ type: 'page/open', page: 'settings' })
    await advance(f)
    const paused = Promise.withResolvers<void>()
    f.state.pause = paused.promise
    f.app.dispatch({ type: 'suins/name_changed', name: 'child.sceat.sui' })
    f.app.dispatch({ type: 'suins/use' })
    expect(f.calls).toEqual(['validate'])
    f.app.dispatch({ type: 'page/open', page: 'world' })
    expect(f.app.store.getState().navigation.page).toBe('world')
    expect(f.app.store.getState().suins.request).toBeNull()
    paused.resolve()
    await advance(f)
    expect(f.calls).toEqual(['validate'])
  } finally {
    f.stop()
  }
})

const connect_parent = (f: ReturnType<typeof fixture>, pause: Promise<void> | null = null) => {
  const external = {
    ...f.wallet,
    address: '0xexternal',
    wallet_name: 'External',
    identity: 'wallet',
    suins: {
      ...f.wallet.suins,
      managed: false,
      snapshot: async () => {
        if (pause) await pause
        return {
          default_name: 'external.sui',
          names: [{ name: 'child.sceat.sui', object_id: '0x3', nft_id: '0x3', subname: true }],
        }
      },
      apply_parent: async (name: string, agent: string, guard: () => void, player: string) => {
        expect(player).toBe(f.wallet.address)
        expect(agent).toBe(pairing.address)
        guard()
        f.calls.push('external')
        return { name: `aresrpg.${name}` }
      },
    },
  }
  f.app.dispatch({
    type: 'external_wallet/connected',
    sequence: f.app.store.getState().external_wallet.sequence,
    session: external as never,
  })
  return external
}

test('external parent selection preserves gameplay, reads source names and signs each default with its target', async () => {
  const f = fixture()
  try {
    await advance(f)
    connect_parent(f)
    await advance(f)
    const state = f.app.store.getState()
    expect(state.session.wallet).toBe(f.wallet as never)
    expect(state.suins.snapshot?.default_name).toBe(snapshot.default_name)
    expect(state.suins.snapshot?.names.map(({ name }) => name)).toEqual(['child.sceat.sui'])
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'external' })
    await advance(f)
    expect(f.calls).toEqual(['validate', 'external', 'default', 'agent'])
    expect(f.app.store.getState().session.wallet).toBe(f.wallet as never)
  } finally {
    f.stop()
  }
})

test('external disconnection discards stale names without replacing the gameplay wallet', async () => {
  const f = fixture()
  try {
    await advance(f)
    const pause = Promise.withResolvers<void>()
    const external = connect_parent(f, pause.promise)
    f.app.dispatch({ type: 'external_wallet/invalidated', session: external as never })
    await advance(f)
    pause.resolve()
    await advance(f)
    expect(f.app.store.getState().session.wallet).toBe(f.wallet as never)
    expect(f.app.store.getState().suins.snapshot).toEqual(snapshot)
    expect(f.calls).toEqual([])
  } finally {
    f.stop()
  }
})

test('external replacement cancels pending validation before any signer and releases setup waiters', async () => {
  const f = fixture()
  try {
    await advance(f)
    connect_parent(f)
    await advance(f)
    const pause = Promise.withResolvers<void>()
    f.state.pause = pause.promise
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'old-source' })
    await advance(f)
    connect_parent(f)
    expect(() => f.state.guard!()).toThrow('cancelled')
    pause.resolve()
    await advance(f)
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins.completed).toContain('old-source')
  } finally {
    f.stop()
  }
})

test('setup during source disconnection terminates its waiter without signing', async () => {
  const f = fixture()
  try {
    await advance(f)
    connect_parent(f)
    await advance(f)
    f.app.dispatch({ type: 'external_wallet/disconnect' })
    f.app.dispatch({ type: 'suins/setup_started', token: 'disconnecting' })
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'disconnecting' })
    await advance(f)
    expect(f.app.store.getState().suins.completed).toContain('disconnecting')
    expect(f.calls).toEqual([])
  } finally {
    f.stop()
  }
})

test('existing-name review waits for consent, cancel retires it and repeated confirmation applies once', async () => {
  const f = fixture()
  try {
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'cancel' })
    await tick()
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins.request).toMatchObject({ stage: 'review' })
    f.app.dispatch({ type: 'suins/cancel' })
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins.completed).toEqual(['cancel'])
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'apply' })
    await tick()
    f.app.dispatch({ type: 'suins/confirm' })
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    expect(f.calls).toEqual(['validate', 'validate', 'human', 'agent'])
  } finally {
    f.stop()
  }
})

test('changing the parent account discards the visible review and its consent', async () => {
  const f = fixture()
  try {
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'old' })
    await tick()
    expect(f.app.store.getState().suins.request).toMatchObject({ stage: 'review' })
    connect_parent(f)
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins.completed).toContain('old')
  } finally {
    f.stop()
  }
})

test('a managed flag cannot substitute for a verified zkLogin owner', async () => {
  const f = fixture()
  try {
    await tick()
    const foreign = { ...f.wallet, read_agent_pairing_request: () => ({ owner: '0xwrong' }) }
    f.app.dispatch({ type: 'auth/disconnected' })
    f.app.dispatch({ type: 'auth/connecting' })
    f.app.dispatch({ type: 'auth/connected', session: foreign as never })
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'foreign' })
    await tick()
    expect(f.calls).toEqual([])
    expect(f.app.store.getState().suins.error).toBe('unsupported')
  } finally {
    f.stop()
  }
})

test('a different hosted destination invalidates the reviewed target', async () => {
  const f = fixture()
  try {
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'first' })
    await tick()
    f.app.dispatch({ type: 'suins/setup', pairing: { ...pairing, address: '0x3' }, token: 'changed' })
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    expect(f.calls).toEqual(['validate'])
    expect(f.app.store.getState().suins.error).toBe('stale_review')
    expect(f.app.store.getState().suins.completed).toEqual(['first', 'changed'])
  } finally {
    f.stop()
  }
})

test.each([
  ['refused', Object.assign(new Error('Declined'), { code: 4001 })],
  ['uncertain', new Error('[sdk] transaction outcome unknown: digest; check this transaction before trying again')],
  ['failed', new Error('[sdk] transaction digest failed on-chain: abort')],
  ['funding', new Error('[sdk] transaction resolution failed — NOT submitted: InsufficientGas')],
] as const)('external leaf success survives a %s player-default outcome', async (reason, error) => {
  const f = fixture()
  try {
    await tick()
    connect_parent(f)
    await tick()
    f.wallet.suins.set_default = async (_name, guard) => {
      guard()
      f.calls.push('default')
      throw error
    }
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'partial' })
    await tick()
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    const state = f.app.store.getState().suins
    expect(f.calls).toEqual(['validate', 'external', 'default'])
    expect(state.error).toBe(`player_default_${reason}`)
    expect(state.confirmed).toBe(false)
    expect(state.completed).toEqual(['partial'])
    await tick()
    expect(f.calls).toHaveLength(3)
  } finally {
    f.stop()
  }
})

// Regression (production, 2026-11-21): "Confirm name change" was offered again for a name whose
// records already matched, in Settings and on every hosted connection. Applying it signed nothing.
test('a name whose records already match finishes setup without a review or a signature', async () => {
  const f = fixture()
  try {
    await tick()
    f.state.unchanged = true
    const stages: string[] = []
    const unsubscribe = f.app.store.subscribe(({ suins }) => {
      if (suins.request?.kind === 'set') stages.push(suins.request.stage)
    })
    f.app.dispatch({ type: 'suins/setup_started', token: 'connect' })
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'connect' })
    await tick()
    unsubscribe()
    const result = f.app.store.getState().suins
    expect(stages).not.toContain('review')
    expect(stages).not.toContain('apply')
    expect(f.calls).toEqual(['validate'])
    expect(result.request).toBeNull()
    expect(result.completed).toEqual(['connect'])
    expect(result.pending).toBeNull()
    expect(result.error).toBeNull()
    expect(result.applied).toBe('child.sceat.sui')
    // The next connection reads again and is not asked either.
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'again' })
    await tick()
    expect(f.calls).toEqual(['validate', 'validate'])
    expect(f.app.store.getState().suins.completed).toEqual(['again'])
  } finally {
    f.stop()
  }
})

test('a missing agent default keeps the name offered: the review opens and Apply retries', async () => {
  const f = fixture()
  try {
    await tick()
    f.state.no_gas = true
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'partial' })
    await advance(f)
    expect(f.app.store.getState().suins.pending).toEqual({ pairing, reason: 'funding' })
    expect(f.app.store.getState().suins.applied).toBeNull()
    f.state.no_gas = false
    f.app.dispatch({ type: 'suins/setup', pairing, token: 'retry' })
    await tick()
    expect(f.app.store.getState().suins.request).toMatchObject({ stage: 'review' })
    f.app.dispatch({ type: 'suins/confirm' })
    await tick()
    expect(f.calls).toEqual(['validate', 'human', 'agent', 'validate', 'human', 'agent'])
    expect(f.app.store.getState().suins.applied).toBe('child.sceat.sui')
  } finally {
    f.stop()
  }
})

const names = [{ name: 'sceat.sui', object_id: '0x3', nft_id: '0x3', subname: false }]
const applied_state = (name = 'sceat.sui') => {
  const loaded = { ...initial_suins_state(), snapshot: { default_name: `aresrpg.${name}`, names }, draft: name }
  const requested = reduce_suins(loaded, { type: 'suins/use' })
  return reduce_suins(requested, { type: 'suins/used', request: requested.request as never, pending: null })
}

test('the applied name is a claim of the last read: writes, contradicting reads and resets retire it', () => {
  const state = applied_state()
  expect(state.applied).toBe('sceat.sui')
  // Choosing another name and coming back changes nothing on chain.
  const other = reduce_suins(state, { type: 'suins/name_changed', name: 'other.sui' })
  expect(other.applied).toBe('sceat.sui')
  // A cancelled review signed nothing either.
  const reviewing = reduce_suins(other, { type: 'suins/use' })
  const request = reviewing.request as never
  const review = {
    fingerprint: 'review',
    player_address: '0x1',
    agent_address: '0x2',
    erased_names: [],
    unchanged: false,
  }
  const reviewed = reduce_suins(reviewing, { type: 'suins/reviewed', request, pairing, review })
  expect(reduce_suins(reviewed, { type: 'suins/cancel' }).applied).toBe('sceat.sui')
  // Consent starts the writes: the outcome is unknown until they complete.
  const applying = reduce_suins(reviewed, { type: 'suins/confirm' })
  expect(applying.applied).toBeNull()
  const partial = reduce_suins(applying, {
    type: 'suins/used',
    request: applying.request as never,
    pending: { pairing, reason: 'funding' },
  })
  expect(partial.applied).toBeNull()
  // A later read that shows another default name contradicts the claim.
  const refreshing = reduce_suins(state, { type: 'suins/refresh' })
  const same = { type: 'suins/loaded', request: refreshing.request!, snapshot: state.snapshot! } as const
  expect(reduce_suins(refreshing, same).applied).toBe('sceat.sui')
  const moved = { ...same, snapshot: { default_name: 'aresrpg.other.sui', names } }
  expect(reduce_suins(refreshing, moved).applied).toBeNull()
  expect(reduce_suins(state, { type: 'suins/reset' }).applied).toBeNull()
})
