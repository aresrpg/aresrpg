// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toSerializedSignature } from '@mysten/sui/cryptography'
import { toBase64 } from '@mysten/sui/utils'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_multisig } from '../src/agent_multisig.ts'

// Synthetic public metadata and zero signatures test rejection, never cryptographic success.
const agent = new Ed25519PublicKey(new Uint8Array(32).fill(1))
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const message = new TextEncoder().encode('aresrpg::test-challenge')
const invalid_signature = (public_key = agent) =>
  toSerializedSignature({
    signatureScheme: 'ED25519',
    signature: new Uint8Array(64),
    publicKey: public_key,
  })
const adapter = (sign_personal_message: (message: Uint8Array) => Promise<{ bytes: string; signature: string }>) =>
  create_agent_multisig({ agent_public_key: agent, zklogin_public_identifier: google, sign_personal_message })

test('fixed ordered agent/Google threshold identity normalizes the stable Google identifier', () => {
  const a = adapter(async () => {
    throw new Error('not signing')
  })
  const b = create_agent_multisig({
    agent_public_key: agent,
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true }),
    sign_personal_message: async () => {
      throw new Error('not signing')
    },
  })
  expect(a.address).toBe(b.address)
  expect(a.public_key.getThreshold()).toBe(1)
  expect(a.public_key.getPublicKeys().map(({ weight }) => weight)).toEqual([1, 1])
  expect(a.public_key.getPublicKeys()[0]!.publicKey.equals(agent)).toBe(true)
  expect(a.public_key.getPublicKeys()[1]!.publicKey.equals(google)).toBe(true)
})

test('rejects a zkLogin agent key instead of silently using an ephemeral or recovery signer', () => {
  expect(() =>
    create_agent_multisig({
      agent_public_key: google,
      zklogin_public_identifier: google,
      sign_personal_message: async () => {
        throw new Error('not signing')
      },
    })
  ).toThrow('ordinary keypair')
})

test('rejects signer mutation and mismatched returned bytes', async () => {
  const input = message.slice()
  const a = adapter(async (bytes) => {
    bytes.fill(0)
    return { bytes: toBase64(bytes), signature: invalid_signature() }
  })
  await expect(a.sign_personal_message(input)).rejects.toThrow('different personal-message bytes')
  expect(input).toEqual(message)
})

test('rejects another member before attempting cryptographic verification', async () => {
  const a = adapter(async (bytes) => ({
    bytes: toBase64(bytes),
    signature: invalid_signature(new Ed25519PublicKey(new Uint8Array(32).fill(2))),
  }))
  await expect(a.sign_personal_message(message)).rejects.toThrow('configured agent member')
})

test('explicitly rejects a zkLogin partial', async () => {
  const a = adapter(async (bytes) => ({ bytes: toBase64(bytes), signature: toBase64(new Uint8Array([5])) }))
  await expect(a.sign_personal_message(message)).rejects.toThrow('zkLogin partial signatures are unsupported')
})

test('matching public metadata does not make an invalid signature acceptable', async () => {
  const a = adapter(async (bytes) => ({ bytes: toBase64(bytes), signature: invalid_signature() }))
  await expect(a.sign_personal_message(message)).rejects.toThrow()
})
