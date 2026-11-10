// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedOwnerStatus } from '@aresrpg/protocol'

import { reduce_app_state } from '../../src/store.ts'
import { owner_connected } from '../../src/agents/owner_state.ts'
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
