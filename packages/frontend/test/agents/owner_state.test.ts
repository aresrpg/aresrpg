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
  expires_at: 1_000_000,
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
