// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Custody: sealed seeds, the keyring, provisioning and pairing proofs.
import { createCipheriv } from 'node:crypto'

import { expect, test } from 'bun:test'
import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'
import { verify_agent_pairing } from '@aresrpg/sdk/agent-pairing'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_key_provider, type ManagedProvider } from '../src/managed_signer.ts'
import {
  PROOF_HOLD_MS,
  request_owner_provisioning,
  request_pairing_proof,
  request_provisioning,
  run_pairing_proof,
  run_provisioning,
  type Deadline,
} from '../src/provisioning.ts'
import type { ControlStore } from '../src/store.ts'

import { fixture_google, fixture_key, fixture_provider, keyring_json, memory_store, put } from './fixture.ts'

const input = {
  id: 'fixture',
  owner: fixture_google.toSuiAddress(),
  zklogin_public_identifier: fixture_google.toBase64(),
  policy: { revision: 1, scopes: ['play'] },
}
const legacy_google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true })
const provisioned = async () => {
  const store = memory_store()
  const provider = fixture_provider()
  await request_provisioning(store, input)
  return { store, provider, bot: await run_provisioning(store, provider, input.id) }
}
/** The door's deadline as a recorder: nothing expires until the test says so. */
const manual_deadline = () => {
  const state = { armed: [] as number[], cancelled: 0, expire: () => undefined as void }
  const deadline: Deadline = (expired, ms) => {
    state.armed = [...state.armed, ms]
    state.expire = expired
    return () => {
      state.cancelled += 1
    }
  }
  return { state, deadline }
}
const no_hold: Deadline = (expired) => {
  queueMicrotask(expired)
  return () => undefined
}
const pairing = (nonce = '11111111-1111-4111-8111-111111111111') => ({
  version: 1 as const,
  network: 'mainnet' as const,
  owner: input.owner,
  zklogin_public_identifier: input.zklogin_public_identifier,
  nonce,
})

test('S16 provisioning: a lost commit reply reconciles the same id, an aborted commit keeps only the reservation, an unreadable store fails closed, a wrong key publishes nothing', async () => {
  const original = memory_store()
  const provider = fixture_provider()
  await request_provisioning(original, input)
  const aborted: ControlStore = {
    ...original,
    transaction: (keys, operation) =>
      original.transaction(keys, async (tx) => {
        await operation(tx)
        throw new Error('before commit')
      }),
  }
  await expect(run_provisioning(aborted, provider, input.id)).rejects.toThrow('before commit')
  expect(await original.scan_keys('', 20)).toEqual([`account:${input.owner}`, 'provision:fixture'])
  expect((await original.read<{ status: string }>('provision:fixture'))!.status).toBe('requested')
  const wrong = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  const forged = {
    ...provider,
    signer: () =>
      create_managed_agent_signer({
        public_key: fixture_key.getPublicKey().toRawBytes(),
        sign_digest: (bytes) => wrong.sign(bytes),
      }),
  }
  await expect(run_provisioning(original, forged, input.id)).rejects.toThrow()
  expect(await original.read('bot:fixture')).toBeNull()
  let prepares = 0
  let failed = false
  const counted = { ...provider, prepare: async (id: string) => ((prepares += 1), provider.prepare(id)) }
  const unreadable: ControlStore = {
    ...original,
    read: async <T>(name: string) => (failed ? Promise.reject(new Error('read unavailable')) : original.read<T>(name)),
    transaction: async () => {
      failed = true
      throw new Error('unknown commit')
    },
  }
  await expect(run_provisioning(unreadable, counted, input.id)).rejects.toThrow('read unavailable')
  await expect(run_provisioning(unreadable, counted, input.id)).rejects.toThrow('read unavailable')
  expect(prepares).toBe(1)
  const lost: ControlStore = {
    ...original,
    transaction: async (keys, operation) => {
      await original.transaction(keys, operation)
      throw new Error('lost commit response')
    },
  }
  const bot = await run_provisioning(lost, provider, input.id)
  expect([await original.read(`bot:${input.id}`), await original.read(bot.key_id)]).toEqual([
    bot,
    'public-test-fixture',
  ])
  const never = { ...provider, prepare: async () => Promise.reject(new Error('must not regenerate')) }
  expect(await run_provisioning(original, never, input.id)).toEqual(bot)
  const legacy = memory_store()
  await request_provisioning(legacy, {
    ...input,
    owner: legacy_google.toSuiAddress(),
    zklogin_public_identifier: legacy_google.toBase64(),
  })
  expect((await run_provisioning(legacy, provider, input.id)).owner).toBe(legacy_google.toSuiAddress())
})

test('S16 one Google owner reserves one wallet; an alternate identity or historical second wallet is refused, never selected', async () => {
  const store = memory_store()
  const owner = {
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    authorization_id: 'not-durable',
    session_hash: 'not-durable',
  }
  const requests = await Promise.all(
    Array.from({ length: 12 }, () => request_owner_provisioning(store, owner, input.policy))
  )
  expect([new Set(requests.map(({ id }) => id)).size, JSON.stringify(requests).includes('not-durable')]).toEqual([
    1,
    false,
  ])
  const provider = fixture_provider()
  const bot = await run_provisioning(store, provider, requests[0]!.id)
  const resumed = await request_owner_provisioning(store, owner, input.policy)
  expect((await run_provisioning(store, provider, resumed.id)).address).toBe(bot.address)
  await expect(request_provisioning(store, { ...input, id: 'alternate' })).rejects.toThrow('multiple_hosted_bots')
  expect([(await store.scan_keys('provision:', 20)).length, (await store.scan_keys('identity:', 20)).length]).toEqual([
    1, 1,
  ])
  const historical = memory_store()
  const account = {
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    bot_ids: ['one', 'two'],
  }
  await put(historical, `account:${input.owner}`, account)
  await expect(request_owner_provisioning(historical, input, input.policy)).rejects.toThrow('multiple_hosted_bots')
  expect([await historical.read(`account:${input.owner}`), await historical.scan_keys('provision:', 20)]).toEqual([
    account,
    [],
  ])
})

test('S17 a pairing proof matches the fresh browser request; a reordered record still matches; a changed descriptor or a replayed nonce is refused', async () => {
  const { store, provider, bot } = await provisioned()
  const request = pairing()
  await request_pairing_proof(store, { authorization_id: 'auth', bot_id: bot.id, owner: input.owner, request }, no_hold)
  const signed = await run_pairing_proof(store, provider, `proof:auth:${request.nonce}`)
  expect((await verify_agent_pairing(request, signed.proof)).address).toBe(bot.address)
  await expect(verify_agent_pairing(pairing('22222222-2222-4222-8222-222222222222'), signed.proof)).rejects.toThrow()
  const args = { authorization_id: 'reordered', bot_id: bot.id, owner: input.owner, request }
  const result = await request_pairing_proof(store, args, no_hold)
  const key = `proof:reordered:${request.nonce}`
  await put(store, key, { ...result, request: Object.fromEntries(Object.entries(request).reverse()) })
  expect((await request_pairing_proof(store, args, no_hold)).status).toBe('pending')
  const { state, deadline } = manual_deadline()
  const replay = { authorization_id: 'auth', bot_id: bot.id, owner: input.owner, request }
  await expect(
    request_pairing_proof(store, { ...replay, owner: legacy_google.toSuiAddress() }, deadline)
  ).rejects.toThrow('PAIRING_OWNER_MISMATCH')
  await put(store, `bot:${bot.id}`, { ...bot, generation: bot.generation + 1 })
  await expect(request_pairing_proof(store, replay, deadline)).rejects.toThrow('PAIRING_REQUEST_CONFLICT')
  await expect(run_pairing_proof(store, provider, key)).rejects.toThrow('PAIRING_BOT_UNAVAILABLE')
  await put(store, `bot:${bot.id}`, bot)
  expect(state.armed.length).toBe(state.cancelled)
  expect((await request_pairing_proof(store, replay, deadline)).proof).toEqual(signed.proof)
  expect((await run_provisioning(store, provider, input.id)).address).toBe(bot.address)
})

test('S17 a proof is answered in the request that asked when this process signs, otherwise held to its deadline', async () => {
  const { store, provider, bot } = await provisioned()
  const held = { authorization_id: 'held', bot_id: bot.id, owner: input.owner, request: pairing() }
  const waiting = manual_deadline()
  const seen = { answered: false }
  const asking = request_pairing_proof(store, held, waiting.deadline).then((answer) => ((seen.answered = true), answer))
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
  expect([seen.answered, waiting.state.armed]).toEqual([false, [PROOF_HOLD_MS]])
  waiting.state.expire()
  expect((await asking).status).toBe('pending')
  await run_pairing_proof(store, provider, `proof:held:${held.request.nonce}`)
  const later = manual_deadline()
  expect([(await request_pairing_proof(store, held, later.deadline)).status, later.state.cancelled]).toEqual([
    'ready',
    1,
  ])
  // The service runtime's wiring: the store wakes this process's actor for each key that gains work.
  store.subscribe_pending!((keys) => {
    for (const key of keys) void run_pairing_proof(store, provider, key)
  })
  const request = pairing('33333333-3333-4333-8333-333333333333')
  const live = manual_deadline()
  const answer = await request_pairing_proof(
    store,
    { authorization_id: 'one', bot_id: bot.id, owner: input.owner, request },
    live.deadline
  )
  expect([answer.status, live.state.armed, live.state.cancelled]).toEqual(['ready', [PROOF_HOLD_MS], 1])
  expect((await verify_agent_pairing(request, answer.proof!)).address).toBe(bot.address)
})

const message = new TextEncoder().encode('synthetic custody proof')
const signs = async (provider: ManagedProvider, key: Parameters<ManagedProvider['signer']>[0], sealed?: string) => {
  const signer = provider.signer(key, sealed)
  return signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
}
test('S14 a seed is sealed with AES-GCM and its identity as AAD; tampered, transplanted or mismatched ciphertext fails closed', async () => {
  const store = memory_store()
  const provider = create_key_provider(store, keyring_json({ v1: 9 }))
  const { key, sealed } = await provider.prepare('request')
  // Preparation writes nothing; the ciphertext proves possession before publication.
  expect([await store.scan_keys('', 20), await signs(provider, key, sealed)]).toEqual([[], true])
  await expect(provider.signer(key).sign_personal_message(message)).rejects.toThrow('MISSING')
  const stored = JSON.parse(sealed)
  expect(Object.keys(stored).toSorted()).toEqual([
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
  expect(await signs(create_key_provider(store, keyring_json({ v1: 9 })), key)).toBe(true)
  const second = await provider.prepare('second')
  await put(store, second.key.key_id, sealed)
  await expect(provider.signer(second.key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  for (const field of ['tag', 'bytes', 'nonce', 'public_key', 'encryption_key_id', 'version']) {
    await put(store, key.key_id, JSON.stringify({ ...stored, [field]: 'tampered' }))
    await expect(provider.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  }
  await put(store, key.key_id, sealed)
  await expect(
    provider.signer({ ...key, public_key: second.key.public_key }).sign_personal_message(message)
  ).rejects.toThrow('IDENTITY_MISMATCH')
  await expect(provider.signer({ ...key, key_id: 'not-a-signing-key' }).sign_personal_message(message)).rejects.toThrow(
    'IDENTITY_MISMATCH'
  )
  await expect(provider.rewrap({ ...key, key_id: 'not-a-signing-key' })).rejects.toThrow('IDENTITY_MISMATCH')
  // A seed sealed under the older key-id namespace stays readable, unrewritten and with its identity.
  const seed = new Uint8Array(32).fill(3)
  const legacy = {
    key_id: `bot:signing:${'a'.repeat(64)}:${'b'.repeat(64)}`,
    public_key: Ed25519Keypair.fromSecretKey(seed).getPublicKey().toBase64(),
  }
  const nonce = Buffer.alloc(12, 4)
  const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 9), nonce)
  cipher.setAAD(Buffer.from(JSON.stringify(['aresrpg-signing-seed', 1, legacy.key_id, legacy.public_key, 'v1'])))
  const bytes = Buffer.concat([cipher.update(seed), cipher.final()])
  const legacy_sealed = JSON.stringify({
    version: 1,
    ...legacy,
    encryption_key_id: 'v1',
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    bytes: bytes.toString('base64'),
  })
  await put(store, legacy.key_id, legacy_sealed)
  expect([await signs(provider, legacy), await store.read(legacy.key_id)]).toEqual([true, legacy_sealed])
  const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(5)).getPublicKey().toBase64()
  await expect(provider.rewrap({ ...legacy, public_key: other })).rejects.toThrow('IDENTITY_MISMATCH')
  expect(await provider.rewrap(legacy)).toEqual(legacy)
})

test('S15 keyring rotation keeps the identity and old backups; a wrong keyring or a conflict fails; configuration errors never echo a secret', async () => {
  const store = memory_store()
  const provider = create_key_provider(store, keyring_json({ v1: 9 }))
  const { key, sealed } = await provider.prepare('request')
  await put(store, key.key_id, sealed)
  const rotated = create_key_provider(store, keyring_json({ v1: 9, v2: 7 }, 'v2'))
  expect(await rotated.rewrap(key)).toEqual(key)
  const v2_only = create_key_provider(store, keyring_json({ v2: 7 }))
  await expect(provider.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  expect(await signs(v2_only, key)).toBe(true)
  await put(store, key.key_id, sealed)
  await expect(v2_only.signer(key).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
  expect(await signs(rotated, key)).toBe(true)
  await expect(
    create_key_provider(store, keyring_json({ v1: 1 }))
      .signer(key)
      .sign_personal_message(message)
  ).rejects.toThrow('UNAVAILABLE')
  const conflict: ControlStore = {
    ...store,
    transaction: async () => Promise.reject(new Error('control_transaction_conflict')),
  }
  await expect(create_key_provider(conflict, keyring_json({ v1: 9 })).rewrap(key)).rejects.toThrow('conflict')
  for (const encoded of [
    'secret malformed JSON',
    '{}',
    '{"active_key_id":"v1","keys":{"v1":"secret"}}',
    keyring_json({ v1: 9 }, 'missing'),
  ]) {
    const failure = (() => {
      try {
        create_key_provider(store, encoded)
        return null
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(failure).toBe('INVALID_SIGNING_KEYRING')
  }
})
