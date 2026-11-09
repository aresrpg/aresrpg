// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { verify_agent_pairing } from '@aresrpg/sdk/agent-pairing'
import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'

import {
  request_provisioning,
  run_provisioning,
  request_pairing_proof,
  run_pairing_proof,
} from '../src/provisioning.ts'
import type { ControlStore } from '../src/store.ts'

import { memory_store, put } from './helpers/control_fixture.ts'
import { managed_provider_fixture } from './helpers/managed_provider_fixture.ts'

// Existing SDK fixture identity (agent_signer.test.ts), publicly known and never funded.
const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const input = {
  id: 'fixture',
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
  policy: { revision: 1, scopes: ['play'] },
}
const fixture = () => ({ store: memory_store(), provider: managed_provider_fixture() })
test('unknown commit reconciles the same creation ID and never prepares a replacement', async () => {
  const { store: original, provider } = fixture()
  await request_provisioning(original, input)
  const store: ControlStore = {
    ...original,
    transaction: async (keys, operation) => {
      await original.transaction(keys, operation)
      throw new Error('lost commit response')
    },
  }
  const bot = await run_provisioning(store, provider, input.id)
  expect(await original.read(`bot:${input.id}`)).toEqual(bot)
  expect(await original.read(bot.key_id)).toBe('public-test-fixture')
  const restarted = {
    ...provider,
    prepare: async () => {
      throw new Error('must not regenerate')
    },
  }
  expect(await run_provisioning(original, restarted, input.id)).toEqual(bot)
})
test('an aborted commit leaves no key, bot or owner index', async () => {
  const { store: original, provider } = fixture()
  await request_provisioning(original, input)
  const store: ControlStore = {
    ...original,
    transaction: (keys, operation) =>
      original.transaction(keys, async (tx) => {
        await operation(tx)
        throw new Error('before commit')
      }),
  }
  await expect(run_provisioning(store, provider, input.id)).rejects.toThrow('before commit')
  expect(await original.scan_keys('', 20)).toEqual(['provision:fixture'])
  expect((await original.read<{ status: string }>('provision:fixture'))!.status).toBe('requested')
})
test('unavailable reconciliation fails closed before any new candidate can be generated', async () => {
  const { store: original, provider } = fixture()
  await request_provisioning(original, input)
  let failed = false
  let prepares = 0
  const store: ControlStore = {
    ...original,
    read: async <T>(name: string) => {
      if (failed) throw new Error('read unavailable')
      return original.read<T>(name)
    },
    transaction: async () => {
      failed = true
      throw new Error('unknown commit')
    },
  }
  const counted = {
    ...provider,
    prepare: async (id: string) => {
      prepares += 1
      return provider.prepare(id)
    },
  }
  await expect(run_provisioning(store, counted, input.id)).rejects.toThrow('read unavailable')
  await expect(run_provisioning(store, counted, input.id)).rejects.toThrow('read unavailable')
  expect(prepares).toBe(1)
})
test('verified descriptor publishes once; proof matches fresh browser request', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  const request = {
    version: 1 as const,
    network: 'mainnet' as const,
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    nonce: '11111111-1111-4111-8111-111111111111',
  }
  await request_pairing_proof(store, { authorization_id: 'auth', bot_id: bot.id, owner: input.owner, request })
  const result = await run_pairing_proof(store, provider, `proof:auth:${request.nonce}`)
  expect((await verify_agent_pairing(request, result.proof)).address).toBe(bot.address)
  expect((await run_provisioning(store, provider, input.id)).address).toBe(bot.address)
})
test('wrong provider signature never publishes funding descriptor', async () => {
  const { store, provider: original } = fixture()
  await request_provisioning(store, input)
  const wrong = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  const provider = {
    ...original,
    signer: () =>
      create_managed_agent_signer({
        public_key: key.getPublicKey().toRawBytes(),
        sign_digest: (bytes) => wrong.sign(bytes),
      }),
  }
  await expect(run_provisioning(store, provider, input.id)).rejects.toThrow()
  expect(await store.read('bot:fixture')).toBeNull()
})
test('provisioning preserves the accepted legacy Google owner address', async () => {
  const { store, provider } = fixture()
  const legacy = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true })
  await request_provisioning(store, {
    ...input,
    owner: legacy.toSuiAddress(),
    zklogin_public_identifier: legacy.toBase64(),
  })
  const bot = await run_provisioning(store, provider, input.id)
  expect(bot.owner).toBe(legacy.toSuiAddress())
})

test('pairing request equality survives persisted JSON key reordering', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  const request = {
    version: 1 as const,
    nonce: '11111111-1111-4111-8111-111111111111',
    network: 'mainnet' as const,
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
  }
  const args = { authorization_id: 'reordered', bot_id: bot.id, owner: input.owner, request }
  const result = await request_pairing_proof(store, args)
  const key = `proof:reordered:${request.nonce}`
  await store.transaction([key], async (tx) =>
    tx.put(key, { ...result, request: Object.fromEntries(Object.entries(request).reverse()) })
  )
  expect((await request_pairing_proof(store, args)).status).toBe('pending')
})

test('a changed descriptor invalidates an already requested pairing proof', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  const request = {
    version: 1 as const,
    network: 'mainnet' as const,
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    nonce: '11111111-1111-4111-8111-111111111111',
  }
  const args = { authorization_id: 'changed', bot_id: bot.id, owner: input.owner, request }
  await request_pairing_proof(store, args)
  await put(store, `bot:${bot.id}`, { ...bot, generation: bot.generation + 1 })
  await expect(request_pairing_proof(store, args)).rejects.toThrow('PAIRING_REQUEST_CONFLICT')
  await expect(run_pairing_proof(store, provider, `proof:changed:${request.nonce}`)).rejects.toThrow(
    'PAIRING_BOT_UNAVAILABLE'
  )
})
