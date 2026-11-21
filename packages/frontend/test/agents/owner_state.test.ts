// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedOwnerStatus } from '@aresrpg/protocol'

import { reduce_app_state } from '../../src/store.ts'
import { owner_answer, owner_checkable, owner_connected } from '../../src/agents/owner_state.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const pairing = { address: 'agent', multisig_public_key: 'descriptor', signer_mode: 'host-persistent' as const }
const response = (owner: string): HostedOwnerStatus => ({
  owner,
  status: 'connected',
  expires_at: Date.now() + 60_000,
  recovery_bots: [],
  bot: { id: 'bot', ...pairing, status: 'ready', generation: 1, policy_revision: 1 },
})

test('one validated owner result supplies connection display and inventory identity; local metadata cannot', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  const remembered = reduce_app_state(original, {
    type: 'agent/pairing_verified',
    wallet,
    pairing: { ...pairing, signer_mode: 'disposable' },
  })
  expect(owner_connected(remembered.session)).toBe(false)
  const checking = reduce_app_state(remembered, { type: 'agent/connection_refresh' })
  const ready = reduce_app_state(checking, {
    type: 'agent/connection_result',
    failure: null,
    wallet,
    generation: checking.session.agent_connection.generation,
    response: response(wallet.address),
    pairing,
  })
  expect(owner_connected(ready.session)).toBe(true)
  expect(ready.session.inventory_pairing).toBe(pairing)
  expect(ready.session.agent_pairing_candidate).toBeNull()
  const revoked = reduce_app_state(ready, { type: 'agent/connection_refresh' })
  const stopped = reduce_app_state(revoked, {
    type: 'agent/connection_result',
    failure: null,
    wallet,
    generation: revoked.session.agent_connection.generation,
    response: { ...response(wallet.address), status: 'disconnected', expires_at: null },
    pairing: null,
  })
  expect(owner_connected(stopped.session)).toBe(false)
  expect(stopped.session.inventory_pairing).toBeNull()
})

test('cancellation and account replacement reject late owner verification results', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  const pending = reduce_app_state(original, { type: 'agent/connection_refresh' })
  const result = {
    type: 'agent/connection_result' as const,
    failure: null,
    wallet,
    generation: pending.session.agent_connection.generation,
    response: response(wallet.address),
    pairing,
  }
  for (const retired of [
    reduce_app_state(pending, { type: 'agent/connection_cancel' }),
    reduce_app_state(pending, { type: 'auth/disconnected' }),
  ]) {
    expect(reduce_app_state(retired, result).session).toBe(retired.session)
    expect(retired.session.inventory_pairing).toBeNull()
  }
  expect(reduce_app_state(pending, { ...result, wallet: { ...wallet } }).session).toBe(pending.session)
})

test('routine owner refresh preserves an explicit recovery selection without promoting its deposit authority', () => {
  const original = automation_fixture(),
    wallet = original.session.wallet!
  const recovery = { ...pairing, address: 'recovery', signer_mode: 'disposable' as const }
  const selected = reduce_app_state(original, { type: 'agent/inventory_target', wallet, pairing: recovery })
  const checking = reduce_app_state(selected, { type: 'agent/connection_refresh' })
  const result = reduce_app_state(checking, {
    type: 'agent/connection_result',
    failure: null,
    wallet,
    generation: checking.session.agent_connection.generation,
    response: response(wallet.address),
    pairing,
  })
  expect(result.session.inventory_pairing).toBe(selected.session.inventory_pairing)
  expect(result.session.inventory_pairing?.signer_mode).toBe('disposable')
  expect(owner_connected(result.session)).toBe(true)
})

test('fresh authorization restores the same returned account without replacing its identity', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  const selected = reduce_app_state(original, {
    type: 'agent/inventory_target',
    wallet,
    pairing: { ...pairing, signer_mode: 'disposable' },
  })
  const checking = reduce_app_state(selected, { type: 'agent/connection_refresh' })
  const connected = reduce_app_state(checking, {
    type: 'agent/connection_result',
    failure: null,
    wallet,
    generation: checking.session.agent_connection.generation,
    response: response(wallet.address),
    pairing,
  })
  expect(connected.session.inventory_pairing).toBe(pairing)
  expect(owner_connected(connected.session)).toBe(true)
})

test('connection proof expires and cannot be replaced by a matching inventory preference', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  const checking = reduce_app_state(original, { type: 'agent/connection_refresh' })
  const connected = reduce_app_state(checking, {
    type: 'agent/connection_result',
    failure: null,
    wallet,
    generation: checking.session.agent_connection.generation,
    response: { ...response(wallet.address), expires_at: Date.now() - 1 },
    pairing,
  })
  expect(owner_connected(connected.session)).toBe(false)
})

// Regression: `owner_connected` is false both for "not connected" and for "not checked yet", so the
// agent page opened the setup and read "Connect your agent" during the check, then flipped to
// "Agent connected". The reading has three answers, and an unanswered check is never "not connected".
test('an owner check that has not answered reads unknown, never not connected', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  // Signed in, nothing asked yet: the check is about to run.
  expect(owner_answer(original.session, true)).toBe('unknown')
  const checking = reduce_app_state(original, { type: 'agent/connection_refresh' })
  expect(checking.session.agent_connection.phase).toBe('checking')
  expect(owner_answer(checking.session, true)).toBe('unknown')
  const result = {
    type: 'agent/connection_result' as const,
    failure: null,
    wallet,
    generation: checking.session.agent_connection.generation,
  }
  const connected = reduce_app_state(checking, { ...result, response: response(wallet.address), pairing })
  expect(owner_answer(connected.session, true)).toBe('connected')
  const disconnected = reduce_app_state(checking, {
    ...result,
    response: { ...response(wallet.address), status: 'disconnected', expires_at: null },
    pairing: null,
  })
  expect(owner_answer(disconnected.session, true)).toBe('not_connected')
  // A check that failed or could not reach the bot has answered: the page offers Try again, not a wait.
  for (const failure of ['failed', 'unavailable'] as const) {
    const ended = reduce_app_state(checking, { ...result, failure, response: null, pairing: null })
    expect(owner_answer(ended.session, true)).toBe('not_connected')
  }
  expect(owner_answer(reduce_app_state(checking, { type: 'agent/connection_cancel' }).session, true)).toBe(
    'not_connected'
  )
})

test('a re-check keeps the answer it already has until the new one arrives', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  const settle = (state: typeof original, connected: boolean) => {
    const checking = reduce_app_state(state, { type: 'agent/connection_refresh' })
    return reduce_app_state(checking, {
      type: 'agent/connection_result',
      failure: null,
      wallet,
      generation: checking.session.agent_connection.generation,
      response: connected
        ? response(wallet.address)
        : { ...response(wallet.address), status: 'disconnected', expires_at: null },
      pairing: connected ? pairing : null,
    })
  }
  for (const [connected, answer] of [
    [true, 'connected'],
    [false, 'not_connected'],
  ] as const) {
    const again = reduce_app_state(settle(original, connected), { type: 'agent/connection_refresh' })
    expect(again.session.agent_connection.phase).toBe('checking')
    expect(owner_answer(again.session, true)).toBe(answer)
  }
})

test('a check that can never run reads not connected at once instead of waiting for ever', () => {
  const original = automation_fixture()
  const checking = reduce_app_state(original, { type: 'agent/connection_refresh' })
  for (const session of [original.session, checking.session]) expect(owner_answer(session, false)).toBe('not_connected')
  const service = 'https://bot.example.test'
  const google = { identity: 'zklogin' } as const
  expect(owner_checkable(google, service, '')).toBe(true)
  expect(owner_checkable(google, service, '?intent=connect-agent')).toBe(true)
  // No bot service, an account that is not a Google account, no account, or a consent link: no check.
  expect(owner_checkable(google, '', '')).toBe(false)
  expect(owner_checkable({ identity: 'wallet' }, service, '')).toBe(false)
  expect(owner_checkable(null, service, '')).toBe(false)
  expect(owner_checkable(google, service, '?intent=connect-agent&authorization_id=request')).toBe(false)
})
