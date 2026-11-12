// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'

import {
  agent_funding_authorization,
  funding_recipient_current,
  recall_funding_authorization,
} from '../../src/funding/recipient.ts'
import { automation_fixture, character } from '../modules/automation_fixture.ts'
import type { SessionState } from '../../src/modules/session.ts'
const watching = (): SessionState => ({
  ...automation_fixture().session,
  selected_character_id: 'remote',
  agent_view: {
    serial: 3,
    activity: [],
    status: 'ready',
    return_character_id: 'alice',
    characters: [{ ...character(), id: 'remote' }],
    request: {
      character_id: 'remote',
      public_identifier: 'google',
      pairing: { address: 'agent', multisig_public_key: 'public', signer_mode: 'disposable' },
    },
  },
})
test('funding defaults to the player; only a server-accepted current observation authorizes the agent', () => {
  const session = watching()
  expect(funding_recipient_current(session, 'owner')).toBe(true)
  expect(funding_recipient_current(session, 'agent')).toBe(false)
  const authorization = agent_funding_authorization(session)!
  expect(funding_recipient_current(session, 'agent', authorization)).toBe(true)
  expect(funding_recipient_current(session, 'other', authorization)).toBe(false)
  expect(funding_recipient_current(session, 'agent', { ...authorization, recipient: 'other' })).toBe(false)
  for (const status of ['idle', 'loading', 'failed'] as const) {
    const changed = { ...session, agent_view: { ...session.agent_view, status } }
    expect(agent_funding_authorization(changed)).toBeNull()
    expect(funding_recipient_current(changed, 'agent', authorization)).toBe(false)
  }
})
test('captured authorization is invalidated by character, agent, wallet, reconnect or generation changes', () => {
  const session = watching(),
    authorization = agent_funding_authorization(session)!
  const changes: SessionState[] = [
    { ...session, wallet: null },
    { ...session, wallet: { ...session.wallet! } },
    { ...session, selected_character_id: 'another' },
    { ...session, link_status: 'connecting' },
    { ...session, agent_view: { ...session.agent_view, serial: 4 } },
    { ...session, agent_view: { ...session.agent_view, characters: [] } },
    { ...session, agent_view: { ...session.agent_view, request: null } },
    {
      ...session,
      agent_view: {
        ...session.agent_view,
        request: {
          ...session.agent_view.request!,
          pairing: { ...session.agent_view.request!.pairing, address: 'another' },
        },
      },
    },
  ]
  for (const changed of changes) expect(funding_recipient_current(changed, 'agent', authorization)).toBe(false)
  expect(funding_recipient_current({ ...session, wallet: null }, 'owner')).toBe(false)
})

// Public test identities only; no private keys, credentials, signatures or chain calls.
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const identity = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(1)),
  zklogin_public_identifier: google,
})
const pairing = {
  address: identity.address,
  multisig_public_key: identity.public_key.toBase64(),
  signer_mode: 'disposable' as const,
}
const recovery = (): SessionState => ({
  ...automation_fixture().session,
  wallet: {
    ...automation_fixture().session.wallet!,
    address: google.toSuiAddress(),
    identity: 'zklogin',
    read_agent_pairing_request: (nonce) => ({
      version: 1,
      nonce,
      network: 'mainnet',
      owner: google.toSuiAddress(),
      zklogin_public_identifier: google.toBase64(),
    }),
  },
})
test('Recall funds only the canonical current Google-owned multisig outside spectator mode', () => {
  const session = recovery()
  expect(session.agent_view.request).toBeNull()
  expect(agent_funding_authorization(session)).toBeNull()
  expect(funding_recipient_current(session, pairing.address)).toBe(false)
  const authorization = recall_funding_authorization(session, pairing)!
  expect(authorization).not.toBeNull()
  expect(funding_recipient_current(session, pairing.address, authorization)).toBe(true)
  expect(funding_recipient_current(session, 'arbitrary', authorization)).toBe(false)
  for (const changed of [
    { ...session, wallet: null },
    { ...session, wallet: { ...session.wallet! } },
    { ...session, agent_view: { ...session.agent_view, serial: session.agent_view.serial + 1 } },
  ])
    expect(funding_recipient_current(changed, pairing.address, authorization)).toBe(false)
})
test('Recall funding rejects foreign members, altered configuration, missing and changed public identity', () => {
  const session = recovery()
  expect(recall_funding_authorization(session, { ...pairing, address: google.toSuiAddress() })).toBeNull()
  expect(
    recall_funding_authorization({ ...session, wallet: { ...session.wallet!, identity: 'wallet' } }, pairing)
  ).toBeNull()
  const other = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
  const changed = {
    ...session,
    wallet: {
      ...session.wallet!,
      address: other.toSuiAddress(),
      read_agent_pairing_request: (nonce: string) => ({
        version: 1 as const,
        nonce,
        network: 'mainnet' as const,
        owner: other.toSuiAddress(),
        zklogin_public_identifier: other.toBase64(),
      }),
    },
  }
  expect(recall_funding_authorization(changed, pairing)).toBeNull()
  let available = true
  const read_request = session.wallet!.read_agent_pairing_request!
  const current = {
    ...session,
    wallet: {
      ...session.wallet!,
      read_agent_pairing_request: (nonce: string) => (available ? read_request(nonce) : null),
    },
  }
  const authorization = recall_funding_authorization(current, pairing)!
  available = false
  expect(funding_recipient_current(current, pairing.address, authorization)).toBe(false)
})

test('Send funding remains bound to the selected pairing without changing recovery funding', () => {
  const session = { ...recovery(), inventory_pairing: pairing }
  const authorization = { ...recall_funding_authorization(session, pairing)!, require_inventory_pairing: true }
  expect(funding_recipient_current(session, pairing.address, authorization)).toBe(true)
  for (const inventory_pairing of [null, { ...pairing, address: 'replacement' }])
    expect(funding_recipient_current({ ...session, inventory_pairing }, pairing.address, authorization)).toBe(false)
})
