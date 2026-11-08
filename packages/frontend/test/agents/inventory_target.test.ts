// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { reduce_app_state } from '../../src/store.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const pairing = { address: 'agent', multisig_public_key: 'public', signer_mode: 'host-persistent' as const }
test('inventory target accepts only the current wallet and never derives from observation', () => {
  const original = automation_fixture()
  const wallet = original.session.wallet!
  expect(original.session.inventory_pairing).toBeNull()
  const watched = reduce_app_state(original, {
    type: 'agent/watch',
    observation: { pairing, public_identifier: 'google', character_id: null },
  })
  expect(watched.session.inventory_pairing).toBeNull()
  const stale = reduce_app_state(original, { type: 'agent/inventory_target', wallet: { ...wallet }, pairing })
  expect(stale.session).toBe(original.session)
  const selected = reduce_app_state(original, { type: 'agent/inventory_target', wallet, pairing })
  expect(selected.session.inventory_pairing).toEqual(pairing)
  expect(Object.isFrozen(selected.session.inventory_pairing)).toBe(true)
  expect(reduce_app_state(selected, { type: 'auth/disconnected' }).session.inventory_pairing).toBeNull()
})
test('restored disposable metadata is retained as disposable, never upgraded', () => {
  const original = automation_fixture()
  const selected = reduce_app_state(original, {
    type: 'agent/inventory_target',
    wallet: original.session.wallet!,
    pairing: { ...pairing, signer_mode: 'disposable' },
  })
  expect(selected.session.inventory_pairing?.signer_mode).toBe('disposable')
  expect(
    reduce_app_state(selected, { type: 'agent/inventory_target', wallet: selected.session.wallet!, pairing: null })
      .session.inventory_pairing
  ).toBeNull()
})

test('verified proof is only a candidate until explicit comparison, and replacement revokes consent', () => {
  const original = automation_fixture(),
    wallet = original.session.wallet!
  const verified = reduce_app_state(original, { type: 'agent/pairing_verified', wallet, pairing })
  expect(verified.session.agent_pairing_candidate).toEqual(pairing)
  expect(verified.session.inventory_pairing).toBeNull()
  const confirmed = reduce_app_state(verified, { type: 'agent/inventory_target', wallet, pairing })
  expect(confirmed.session.agent_pairing_candidate).toBeNull()
  expect(confirmed.session.inventory_pairing).toEqual(pairing)
  const revoked = reduce_app_state(confirmed, { type: 'agent/inventory_target', wallet, pairing: null })
  expect(revoked.session.inventory_pairing).toBeNull()
  expect(revoked.session.agent_pairing_candidate).toEqual(pairing)
  const replacement = reduce_app_state(confirmed, {
    type: 'agent/pairing_verified',
    wallet,
    pairing: { ...pairing, address: 'other' },
  })
  expect(replacement.session.inventory_pairing).toBeNull()
  expect(reduce_app_state(replacement, { type: 'auth/disconnected' }).session.agent_pairing_candidate).toBeNull()
  expect(reduce_app_state(original, { type: 'agent/pairing_verified', wallet: { ...wallet }, pairing }).session).toBe(
    original.session
  )
})
