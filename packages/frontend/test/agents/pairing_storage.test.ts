// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { create_agent_multisig } from '@aresrpg/sdk/agent-multisig'

import {
  complete_agent_pairing,
  read_agent_identities,
  remember_agent_identity,
} from '../../src/agents/pairing_storage.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const request = {
  version: 1 as const,
  nonce: '11111111-1111-4111-8111-111111111111',
  network: 'mainnet' as const,
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
}
const pairing = (n: number) => {
  const identity = create_agent_multisig({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(n)),
    zklogin_public_identifier: google,
    sign_personal_message: async () => {
      throw new Error('no agent')
    },
  })
  return {
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: 'host-persistent' as const,
  }
}
test('multiple public recovery identities survive reload, deduplicate, and never restore signing capability', () => {
  const rows = new Map<string, string>()
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value)
    },
    removeItem: (key: string) => {
      rows.delete(key)
    },
  }
  remember_agent_identity(storage, request, pairing(1))
  remember_agent_identity(storage, request, pairing(2))
  remember_agent_identity(storage, request, pairing(1))
  const restored = read_agent_identities(storage, request)
  expect(restored).toHaveLength(2)
  expect(restored.every((row) => row.signer_mode === 'disposable')).toBe(true)
  expect(read_agent_identities(storage, { ...request, owner: 'other' })).toEqual([])
  expect([...rows.values()][0]).not.toContain('signer_mode')
  expect(() => remember_agent_identity(null, request, pairing(1))).toThrow('storage')
})

test('setup publishes nothing unless persistent canonical identity is durably saved', () => {
  const rows = new Map<string, string>()
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value)
    },
    removeItem: (key: string) => {
      rows.delete(key)
    },
  }
  expect(complete_agent_pairing(storage, request, pairing(1))).toBeNull()
  expect(read_agent_identities(storage, request)[0]?.signer_mode).toBe('disposable')
  expect(complete_agent_pairing(null, request, pairing(1))).toBe('storage')
  expect(
    complete_agent_pairing(
      {
        ...storage,
        setItem: () => {
          throw new Error('quota')
        },
      },
      request,
      pairing(2)
    )
  ).toBe('storage')
  expect(complete_agent_pairing({ ...storage, setItem: () => undefined }, request, pairing(2))).toBe('storage')
  expect(complete_agent_pairing(storage, request, { ...pairing(1), signer_mode: 'disposable' })).toBe('disposable')
  expect(() => complete_agent_pairing(storage, { ...request, owner: 'other' }, pairing(1))).toThrow()
  expect(() => complete_agent_pairing(storage, request, { ...pairing(1), multisig_public_key: 'malformed' })).toThrow()
})

test('refresh never overwrites an unreadable historical recovery record', () => {
  const original = JSON.stringify([pairing(1), { address: 'unknown', multisig_public_key: 'damaged' }])
  let value = original
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {},
  }
  expect(complete_agent_pairing(storage, request, pairing(2))).toBe('storage')
  expect(value).toBe(original)
})
