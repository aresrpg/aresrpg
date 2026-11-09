// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64 } from '@mysten/sui/utils'

import type { ControlStore } from './store.ts'

export type ManagedKey = Readonly<{ key_id: string; public_key: string }>
export type ManagedProvider = Readonly<{
  prepare: (request_id: string) => Promise<Readonly<{ key: ManagedKey; sealed: string }>>
  signer: (key: ManagedKey, sealed?: string) => ReturnType<typeof create_managed_agent_signer>
}>
export type SigningKeyring = Readonly<{
  active_key_id: string
  keys: Readonly<Record<string, Uint8Array>>
}>
type SealedKey = Readonly<{
  version: 1
  key_id: string
  public_key: string
  encryption_key_id: string
  nonce: string
  tag: string
  bytes: string
}>

/** Config errors never include the supplied secret or JSON parser's input excerpt. */
export const parse_signing_keyring = (encoded: string): SigningKeyring => {
  try {
    const data = JSON.parse(encoded) as { active_key_id: string; keys: Record<string, string> }
    const keys = Object.fromEntries(Object.entries(data.keys).map(([id, value]) => [id, Buffer.from(value, 'base64')]))
    if (!data.active_key_id || !Object.hasOwn(keys, data.active_key_id)) throw new Error()
    if (Object.entries(keys).some(([id, key]) => !id || key.length !== 32)) throw new Error()
    return { active_key_id: data.active_key_id, keys }
  } catch {
    throw new Error('INVALID_SIGNING_KEYRING')
  }
}
const aad = (record: Pick<SealedKey, 'key_id' | 'public_key' | 'encryption_key_id'>) =>
  Buffer.from(JSON.stringify(['aresrpg-signing-seed', 1, record.key_id, record.public_key, record.encryption_key_id]))
const seal = (seed: Uint8Array, key: ManagedKey, keyring: SigningKeyring): string => {
  const record = { version: 1 as const, ...key, encryption_key_id: keyring.active_key_id }
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyring.keys[keyring.active_key_id]!, nonce)
  cipher.setAAD(aad(record))
  const bytes = Buffer.concat([cipher.update(seed), cipher.final()])
  return JSON.stringify({
    ...record,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    bytes: bytes.toString('base64'),
  })
}
const open = (encoded: string, key_id: string, keyring: SigningKeyring) => {
  try {
    const record = JSON.parse(encoded) as SealedKey
    if (record.version !== 1 || record.key_id !== key_id || !Object.hasOwn(keyring.keys, record.encryption_key_id))
      throw new Error()
    const nonce = Buffer.from(record.nonce, 'base64')
    const tag = Buffer.from(record.tag, 'base64')
    if (nonce.length !== 12) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', keyring.keys[record.encryption_key_id]!, nonce, {
      authTagLength: 16,
    })
    decipher.setAAD(aad(record))
    decipher.setAuthTag(tag)
    const seed = Buffer.concat([decipher.update(Buffer.from(record.bytes, 'base64')), decipher.final()])
    try {
      if (Ed25519Keypair.fromSecretKey(seed).getPublicKey().toBase64() !== record.public_key) throw new Error()
      return { record, seed }
    } catch (error) {
      seed.fill(0)
      throw error
    }
  } catch {
    throw new Error('SIGNING_KEY_UNAVAILABLE')
  }
}
/** Prepare locally; provisioning commits the encrypted seed with its bot and owner index.
 * Only persisted descriptors may escape provisioning. Plaintext is transient in this trusted
 * process; JS/SDK memory cannot guarantee zeroization. */
export const create_key_provider = (
  store: ControlStore,
  config: SigningKeyring
): ManagedProvider & Readonly<{ rewrap: (key: ManagedKey) => Promise<ManagedKey> }> => {
  if (!config.active_key_id || !Object.hasOwn(config.keys, config.active_key_id))
    throw new Error('INVALID_SIGNING_KEYRING')
  if (Object.entries(config.keys).some(([id, value]) => !id || value.length !== 32))
    throw new Error('INVALID_SIGNING_KEYRING')
  const keyring = {
    active_key_id: config.active_key_id,
    keys: Object.fromEntries(Object.entries(config.keys).map(([id, key]) => [id, Buffer.from(key)])),
  }
  const prefix = 'bot:signing:'
  const location = (request_id: string) => {
    if (!request_id) throw new Error('SIGNING_REQUEST_REQUIRED')
    return `${prefix}${createHash('sha256').update(request_id).digest('hex')}`
  }
  const validate_key_id = (key_id: string) => {
    if (!/^bot:signing:(?:[a-f0-9]{64}:)?[a-f0-9]{64}$/.test(key_id)) throw new Error('SIGNING_KEY_IDENTITY_MISMATCH')
  }
  return {
    prepare: async (request_id) => {
      const key_id = location(request_id)
      const seed = randomBytes(32)
      try {
        const key = { key_id, public_key: Ed25519Keypair.fromSecretKey(seed).getPublicKey().toBase64() }
        return { key, sealed: seal(seed, key, keyring) }
      } finally {
        seed.fill(0)
      }
    },
    signer: (key, sealed) =>
      create_managed_agent_signer({
        public_key: fromBase64(key.public_key),
        sign_digest: async (message) => {
          validate_key_id(key.key_id)
          const encoded = sealed ?? (await store.read<string>(key.key_id))
          if (encoded === null) throw new Error('SIGNING_KEY_MISSING')
          const { record, seed } = open(encoded, key.key_id, keyring)
          try {
            if (record.public_key !== key.public_key) throw new Error('SIGNING_KEY_IDENTITY_MISMATCH')
            return await Ed25519Keypair.fromSecretKey(seed).sign(message.slice())
          } finally {
            seed.fill(0)
          }
        },
      }),
    rewrap: async (expected) => {
      const { key_id } = expected
      validate_key_id(key_id)
      return store.transaction([key_id], async (tx) => {
        const encoded = await tx.get<string>(key_id)
        if (encoded === null) throw new Error('SIGNING_KEY_MISSING')
        const { record, seed } = open(encoded, key_id, keyring)
        const key = { key_id, public_key: record.public_key }
        try {
          if (key.public_key !== expected.public_key) throw new Error('SIGNING_KEY_IDENTITY_MISMATCH')
          await tx.put(key_id, seal(seed, key, keyring))
          return key
        } finally {
          seed.fill(0)
        }
      })
    },
  }
}
