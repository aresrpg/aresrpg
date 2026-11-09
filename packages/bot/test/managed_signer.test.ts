// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createCipheriv } from 'node:crypto'

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { create_key_provider, parse_signing_keyring } from '../src/managed_signer.ts'
import type { ManagedProvider } from '../src/managed_signer.ts'
import type { ControlStore } from '../src/store.ts'

import { memory_store, put } from './helpers/control_fixture.ts'

// Public synthetic encryption keys, never deployed or used with funded identities.
const config = { active_key_id: 'v1', keys: { v1: new Uint8Array(32).fill(9) } }
const fixture = () => {
  const store = memory_store()
  return { store, provider: create_key_provider(store, config) }
}
const persist = async (store: ControlStore, provider: ManagedProvider, id: string) => {
  const { key, sealed } = await provider.prepare(id)
  await put(store, key.key_id, sealed)
  return key
}
const message = new TextEncoder().encode('synthetic custody proof')
test('preparation has no durable writes, ciphertext proves possession before atomic publication', async () => {
  const { store, provider } = fixture()
  const { key, sealed } = await provider.prepare('request')
  expect(await store.scan_keys('', 20)).toEqual([])
  const local = provider.signer(key, sealed)
  expect(
    await local.public_key.verifyPersonalMessage(message, (await local.sign_personal_message(message)).signature)
  ).toBe(true)
  await expect(provider.signer(key).sign_personal_message(message)).rejects.toThrow('MISSING')
  const stored = JSON.parse(sealed)
  expect(Object.keys(stored).sort()).toEqual([
    'bytes',
    'encryption_key_id',
    'key_id',
    'nonce',
    'public_key',
    'tag',
    'version',
  ])
  expect(Buffer.from(stored.bytes, 'base64').length).toBe(32)
  await put(store, key.key_id, sealed)
  const signer = create_key_provider(store, config).signer(key)
  expect(
    await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
  ).toBe(true)
})
test('tampering and transplanted ciphertext fail closed', async () => {
  const { store, provider } = fixture()
  const first = await persist(store, provider, 'first')
  const second = await persist(store, provider, 'second')
  const original = (await store.read<string>(first.key_id))!
  await put(store, second.key_id, original)
  await expect(provider.signer(second).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  for (const field of ['tag', 'bytes', 'nonce', 'public_key', 'encryption_key_id', 'version']) {
    await put(store, first.key_id, JSON.stringify({ ...JSON.parse(original), [field]: 'tampered' }))
    await expect(provider.signer(first).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  }
  await put(store, first.key_id, original)
  await expect(
    provider.signer({ ...first, public_key: second.public_key }).sign_personal_message(message)
  ).rejects.toThrow('IDENTITY_MISMATCH')
})
test('backup restore needs matching keyring; rotation preserves identity and old backups remain recoverable', async () => {
  const { store, provider } = fixture()
  const key = await persist(store, provider, 'request')
  const backup = await store.read<string>(key.key_id)
  const rotated_config = { ...config, active_key_id: 'v2', keys: { ...config.keys, v2: new Uint8Array(32).fill(7) } }
  const rotated = create_key_provider(store, rotated_config)
  expect(await rotated.rewrap(key)).toEqual(key)
  const v2_only = create_key_provider(store, { ...rotated_config, keys: { v2: rotated_config.keys.v2 } })
  await expect(provider.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  await v2_only.signer(key).sign_personal_message(message)
  await put(store, key.key_id, backup)
  await expect(v2_only.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  const signer = rotated.signer(key)
  expect(
    await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
  ).toBe(true)
  const wrong = create_key_provider(store, { ...config, keys: { v1: new Uint8Array(32).fill(1) } })
  await expect(wrong.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
})
test('rotation conflict and malformed persisted key identities fail closed', async () => {
  const { store, provider } = fixture()
  const key = await persist(store, provider, 'request')
  const conflict: ControlStore = {
    ...store,
    transaction: async () => {
      throw new Error('control_transaction_conflict')
    },
  }
  await expect(create_key_provider(conflict, config).rewrap(key)).rejects.toThrow('conflict')
  await expect(provider.signer({ ...key, key_id: 'not-a-signing-key' }).sign_personal_message(message)).rejects.toThrow(
    'IDENTITY_MISMATCH'
  )
  await expect(provider.rewrap({ ...key, key_id: 'not-a-signing-key' })).rejects.toThrow('IDENTITY_MISMATCH')
})
test('invalid configuration fails without disclosing secret values', () => {
  expect(
    parse_signing_keyring(JSON.stringify({ active_key_id: 'v1', keys: { v1: Buffer.alloc(32, 9).toString('base64') } }))
  ).toEqual({ active_key_id: 'v1', keys: { v1: Buffer.alloc(32, 9) } })
  for (const encoded of ['secret malformed JSON', '{}', '{"active_key_id":"v1","keys":{"v1":"secret"}}'])
    expect(() => parse_signing_keyring(encoded)).toThrow('INVALID_SIGNING_KEYRING')
  expect(() => create_key_provider(fixture().store, { ...config, active_key_id: 'missing' })).toThrow(
    'INVALID_SIGNING_KEYRING'
  )
})

test('legacy namespace ciphertext remains readable without rewriting or changing its identity', async () => {
  const { store, provider } = fixture()
  const seed = new Uint8Array(32).fill(3)
  const key = {
    key_id: `bot:signing:${'a'.repeat(64)}:${'b'.repeat(64)}`,
    public_key: Ed25519Keypair.fromSecretKey(seed).getPublicKey().toBase64(),
  }
  const nonce = Buffer.alloc(12, 4)
  const cipher = createCipheriv('aes-256-gcm', config.keys.v1, nonce)
  cipher.setAAD(Buffer.from(JSON.stringify(['aresrpg-signing-seed', 1, key.key_id, key.public_key, 'v1'])))
  const bytes = Buffer.concat([cipher.update(seed), cipher.final()])
  const sealed = JSON.stringify({
    version: 1,
    ...key,
    encryption_key_id: 'v1',
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    bytes: bytes.toString('base64'),
  })
  await put(store, key.key_id, sealed)
  const signer = provider.signer(key)
  expect(
    await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
  ).toBeTrue()
  expect(await store.read(key.key_id)).toBe(sealed)
  await expect(
    provider.rewrap({
      ...key,
      public_key: Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(5)).getPublicKey().toBase64(),
    })
  ).rejects.toThrow('IDENTITY_MISMATCH')
  expect(await provider.rewrap(key)).toEqual(key)
  expect(
    await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
  ).toBeTrue()
})
