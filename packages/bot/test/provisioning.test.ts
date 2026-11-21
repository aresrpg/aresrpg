// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { verify_agent_pairing } from '@aresrpg/sdk/agent-pairing'
import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'

import {
  PROOF_HOLD_MS,
  request_provisioning,
  request_owner_provisioning,
  run_provisioning,
  request_pairing_proof,
  run_pairing_proof,
  type Deadline,
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
/** A hold that ends at once: for a test that asks with no actor to sign and does not test the hold. */
const no_hold: Deadline = (expired) => {
  queueMicrotask(expired)
  return () => undefined
}
/** The door's deadline as a recorder: nothing expires until the test says so, and no wall time passes. */
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
const fresh_request = (nonce = '11111111-1111-4111-8111-111111111111') => ({
  version: 1 as const,
  network: 'mainnet' as const,
  owner: input.owner,
  zklogin_public_identifier: input.zklogin_public_identifier,
  nonce,
})
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
test('an aborted commit preserves only the owner request reservation, never a funding destination', async () => {
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
  expect(await original.scan_keys('', 20)).toEqual([`account:${input.owner}`, 'provision:fixture'])
  expect(await original.read(`account:${input.owner}`)).toMatchObject({ bot_ids: [input.id] })
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
  await request_pairing_proof(store, { authorization_id: 'auth', bot_id: bot.id, owner: input.owner, request }, no_hold)
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
  const result = await request_pairing_proof(store, args, no_hold)
  const key = `proof:reordered:${request.nonce}`
  await store.transaction([key], async (tx) =>
    tx.put(key, { ...result, request: Object.fromEntries(Object.entries(request).reverse()) })
  )
  expect((await request_pairing_proof(store, args, no_hold)).status).toBe('pending')
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
  await request_pairing_proof(store, args, no_hold)
  await put(store, `bot:${bot.id}`, { ...bot, generation: bot.generation + 1 })
  await expect(request_pairing_proof(store, args, no_hold)).rejects.toThrow('PAIRING_REQUEST_CONFLICT')
  await expect(run_pairing_proof(store, provider, `proof:changed:${request.nonce}`)).rejects.toThrow(
    'PAIRING_BOT_UNAVAILABLE'
  )
})

// Regression (2026-11-21): the door always answered `pending` first and the browser then slept a
// fixed second, on every owner check and every connection.
test('a custody proof is answered in the request that asked for it when this process signs', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  // The service runtime's wiring: the store wakes this process's actor for each key that gains work.
  store.subscribe_pending!((keys) => {
    for (const key of keys) void run_pairing_proof(store, provider, key)
  })
  const request = fresh_request()
  const { state, deadline } = manual_deadline()
  const answer = await request_pairing_proof(
    store,
    { authorization_id: 'one', bot_id: bot.id, owner: input.owner, request },
    deadline
  )
  expect(answer.status).toBe('ready')
  expect((await verify_agent_pairing(request, answer.proof!)).address).toBe(bot.address)
  // The answer ended the hold: its deadline was armed once, never expired, and was cancelled.
  expect(state.armed).toEqual([PROOF_HOLD_MS])
  expect(state.cancelled).toBe(1)
})

test('with no actor to sign, a proof request is held to its deadline and then says pending', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  const args = { authorization_id: 'held', bot_id: bot.id, owner: input.owner, request: fresh_request() }
  const { state, deadline } = manual_deadline()
  const seen = { answered: false }
  const asking = request_pairing_proof(store, args, deadline).then((answer) => {
    seen.answered = true
    return answer
  })
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
  expect(seen.answered).toBe(false)
  expect(state.armed).toEqual([PROOF_HOLD_MS])
  state.expire()
  expect((await asking).status).toBe('pending')
  // Signed later (the actor's next pass): the next request reads the stored proof and holds nothing.
  await run_pairing_proof(store, provider, `proof:held:${args.request.nonce}`)
  const later = manual_deadline()
  expect((await request_pairing_proof(store, args, later.deadline)).status).toBe('ready')
  expect(later.state.cancelled).toBe(1)
})

test('a proof nonce is one request: replayed for another request it is refused at once, before any hold', async () => {
  const { store, provider } = fixture()
  await request_provisioning(store, input)
  const bot = await run_provisioning(store, provider, input.id)
  const request = fresh_request()
  const args = { authorization_id: 'replay', bot_id: bot.id, owner: input.owner, request }
  await request_pairing_proof(store, args, no_hold)
  const signed = await run_pairing_proof(store, provider, `proof:replay:${request.nonce}`)
  const legacy = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true })
  const { state, deadline } = manual_deadline()
  // The same nonce under another descriptor of the same bot: the stored proof is never handed over.
  await put(store, `bot:${bot.id}`, { ...bot, generation: bot.generation + 1 })
  await expect(request_pairing_proof(store, args, deadline)).rejects.toThrow('PAIRING_REQUEST_CONFLICT')
  await put(store, `bot:${bot.id}`, bot)
  // The same nonce for another owner or another account identity never reaches the record.
  await expect(request_pairing_proof(store, { ...args, owner: legacy.toSuiAddress() }, deadline)).rejects.toThrow(
    'PAIRING_OWNER_MISMATCH'
  )
  // No refused request was left held, and the one stored proof still answers only its own nonce.
  expect(state.armed.length).toBe(state.cancelled)
  await expect(
    verify_agent_pairing(fresh_request('22222222-2222-4222-8222-222222222222'), signed.proof)
  ).rejects.toThrow()
  expect((await request_pairing_proof(store, args, deadline)).proof).toEqual(signed.proof)
})

test('one Google owner reserves one request and refuses alternate identities without creating another key', async () => {
  const { store, provider } = fixture()
  const owner = {
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    authorization_id: 'not-durable',
    session_hash: 'not-durable',
  }
  const requests = await Promise.all(
    Array.from({ length: 12 }, () => request_owner_provisioning(store, owner, input.policy))
  )
  expect(new Set(requests.map(({ id }) => id)).size).toBe(1)
  expect(JSON.stringify(requests)).not.toContain('not-durable')
  const first = requests[0]!
  const bot = await run_provisioning(store, provider, first.id)
  const resumed = await request_owner_provisioning(store, owner, input.policy)
  expect((await run_provisioning(store, provider, resumed.id)).address).toBe(bot.address)
  await expect(request_provisioning(store, { ...input, id: 'alternate' })).rejects.toThrow('multiple_hosted_bots')
  expect(await store.scan_keys('provision:', 20)).toHaveLength(1)
  expect(await store.scan_keys('identity:', 20)).toHaveLength(1)
})

test('historical multiple wallets block the upsert without selecting or deleting either', async () => {
  const { store } = fixture()
  const account = {
    owner: input.owner,
    zklogin_public_identifier: input.zklogin_public_identifier,
    bot_ids: ['one', 'two'],
  }
  await put(store, `account:${input.owner}`, account)
  await expect(request_owner_provisioning(store, input, input.policy)).rejects.toThrow('multiple_hosted_bots')
  expect(await store.read(`account:${input.owner}`)).toEqual(account)
  expect(await store.scan_keys('provision:', 20)).toEqual([])
})
