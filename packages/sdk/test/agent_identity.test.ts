// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Who may sign for an agent: the fixed 1-of-2 multisig of the agent key and the owner's Google identity,
// a pairing that refuses foreign owners, a member signer that signs only the exact reviewed bytes, and a
// connection whose stale authorization can never close a newer socket.

import { expect, test } from 'bun:test'
import { toSerializedSignature } from '@mysten/sui/cryptography'
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'
import { ZkLoginPublicIdentifier, toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_connection } from '../src/agent_connection.ts'
import { create_agent_multisig } from '../src/agent_multisig.ts'
import { agent_pairing_message, parse_agent_pairing_request, verify_agent_pairing } from '../src/agent_pairing.ts'
import { create_agent_transaction_signer } from '../src/agent_transactions.ts'
import { create_wallet_binding } from '../src/wallet_standard.ts'

import { digest, id } from './helpers/transport.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const agent_key = new Ed25519PublicKey(new Uint8Array(32).fill(1))
const refusing = async () => {
  throw new Error('not signing')
}

test('an agent identity is the fixed 1-of-2 multisig and pairing refuses a foreign owner, scheme or issuer', async () => {
  const identity = create_agent_multisig({
    agent_public_key: agent_key,
    zklogin_public_identifier: google,
    sign_personal_message: refusing,
  })
  const legacy = create_agent_multisig({
    agent_public_key: agent_key,
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true }),
    sign_personal_message: refusing,
  })
  expect([
    identity.address,
    identity.public_key.getThreshold(),
    identity.public_key.getPublicKeys().map(({ weight }) => weight),
  ]).toEqual([legacy.address, 1, [1, 1]])
  expect(() =>
    create_agent_multisig({
      agent_public_key: google,
      zklogin_public_identifier: google,
      sign_personal_message: refusing,
    })
  ).toThrow('ordinary keypair')
  const message = new TextEncoder().encode('aresrpg::test-challenge')
  const zero_signature = (public_key = agent_key) =>
    toSerializedSignature({ signatureScheme: 'ED25519', signature: new Uint8Array(64), publicKey: public_key })
  const signing = (sign: (bytes: Uint8Array) => Promise<{ bytes: string; signature: string }>) =>
    create_agent_multisig({
      agent_public_key: agent_key,
      zklogin_public_identifier: google,
      sign_personal_message: sign,
    })
  const input = message.slice()
  await expect(
    signing(async (bytes) => ({ bytes: toBase64(bytes.fill(0)), signature: zero_signature() })).sign_personal_message(
      input
    )
  ).rejects.toThrow('different personal-message bytes')
  expect(input).toEqual(message)
  await expect(
    signing(async (bytes) => ({
      bytes: toBase64(bytes),
      signature: zero_signature(new Ed25519PublicKey(new Uint8Array(32).fill(2))),
    })).sign_personal_message(message)
  ).rejects.toThrow('configured agent member')
  await expect(
    signing(async (bytes) => ({ bytes: toBase64(bytes), signature: zero_signature() })).sign_personal_message(message)
  ).rejects.toThrow()
  await expect(
    signing(async (bytes) => ({
      bytes: toBase64(bytes),
      signature: toBase64(new Uint8Array([5])),
    })).sign_personal_message(message)
  ).rejects.toThrow('zkLogin partial signatures are unsupported')

  const forbidden = {
    features: {
      'standard:events': { on: () => () => undefined },
      'enoki:getSession': { getSession: refusing },
      'sui:signPersonalMessage': { signPersonalMessage: refusing },
      'sui:signTransaction': { signTransaction: refusing },
    },
  } as unknown as Wallet
  const binding = create_wallet_binding(
    forbidden,
    {
      address: google.toSuiAddress(),
      publicKey: google.toRawBytes(),
      chains: ['sui:mainnet'],
      features: [],
    } as WalletAccount,
    'mainnet'
  )
  const request = parse_agent_pairing_request(binding.read_agent_pairing_request(crypto.randomUUID()))
  expect([request.owner, request.zklogin_public_identifier]).toEqual([google.toSuiAddress(), google.toBase64()])
  const key = new Ed25519Keypair()
  const response = {
    signer_mode: 'disposable' as const,
    agent_public_key: key.getPublicKey().toBase64(),
    signature: (await key.signPersonalMessage(agent_pairing_message(request))).signature,
  }
  const paired = create_agent_multisig({
    agent_public_key: key.getPublicKey(),
    zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(request.zklogin_public_identifier)),
    sign_personal_message: (bytes) => key.signPersonalMessage(bytes),
  })
  expect((await verify_agent_pairing(request, response)).address).toBe(paired.address)
  binding.dispose()
  const testnet = create_wallet_binding(
    forbidden,
    {
      address: google.toSuiAddress(),
      publicKey: google.toRawBytes(),
      chains: ['sui:testnet'],
      features: [],
    } as WalletAccount,
    'testnet'
  )
  expect(() => testnet.read_agent_pairing_request(crypto.randomUUID())).toThrow('INVALID_PAIRING_REQUEST')
  testnet.dispose()
  const { 'enoki:getSession': _enoki, ...ordinary_features } = forbidden.features as Record<string, unknown>
  const plain = { features: ordinary_features } as unknown as Wallet
  const ordinary = create_wallet_binding(
    plain,
    { address: id(1), publicKey: new Uint8Array(32), chains: ['sui:mainnet'], features: [] } as WalletAccount,
    'mainnet'
  )
  expect(ordinary.read_agent_pairing_request(crypto.randomUUID())).toBeNull()
  ordinary.dispose()
  // A wallet prepares its proof on the first signature and does not share one in flight: two
  // signatures asked at once (the game login and the agent check, at sign-in) run one after the other.
  let signing_now = 0
  let overlapped = false
  const slow_sign = async ({ message }: Readonly<{ message: Uint8Array }>) => {
    signing_now += 1
    overlapped ||= signing_now > 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    signing_now -= 1
    if (message[0] === 0) throw new Error('refused')
    return { bytes: toBase64(message), signature: 'signed' }
  }
  const queued = create_wallet_binding(
    {
      features: { ...ordinary_features, 'sui:signPersonalMessage': { signPersonalMessage: slow_sign } },
    } as unknown as Wallet,
    { address: id(1), publicKey: new Uint8Array(32), chains: ['sui:mainnet'], features: [] } as WalletAccount,
    'mainnet'
  )
  const [refused_first, second, third] = await Promise.allSettled(
    [0, 1, 2].map((byte) => queued.sign_personal_message(new Uint8Array([byte])))
  )
  expect([refused_first.status, second.status, third.status]).toEqual(['rejected', 'fulfilled', 'fulfilled'])
  expect(overlapped).toBe(false)
  queued.dispose()
  const other = toZkLoginPublicIdentifier(1n, 'https://example.com', { legacyAddress: false })
  for (const [address, public_key] of [
    [`0x${'ab'.repeat(32)}`, google.toSuiBytes()],
    [google.toSuiAddress(), new Uint8Array([0, ...google.toRawBytes()])],
    [other.toSuiAddress(), other.toSuiBytes()],
  ] as const) {
    const refused = create_wallet_binding(
      forbidden,
      { address, publicKey: public_key, chains: ['sui:mainnet'], features: [] } as WalletAccount,
      'mainnet'
    )
    expect(() => refused.read_agent_pairing_request(crypto.randomUUID())).toThrow()
    refused.dispose()
  }
})

test('the agent member signer refuses a wrong sender, changed bytes and another member before signing', async () => {
  const identity = create_agent_multisig({
    agent_public_key: agent_key,
    zklogin_public_identifier: google,
    sign_personal_message: refusing,
  })
  const foreign = new Transaction()
  foreign.setSender(id(10))
  await expect(create_agent_transaction_signer(identity, refusing)(foreign)).rejects.toThrow('sender mismatch')
  const tx = new Transaction()
  tx.setSender(identity.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000000)
  tx.setGasPayment([{ objectId: id(50), version: '1', digest }])
  const original = await tx.build()
  await expect(
    create_agent_transaction_signer(identity, async (bytes) => ({ bytes: toBase64(bytes.fill(0)), signature: '' }))(tx)
  ).rejects.toThrow('changed transaction bytes')
  expect(await tx.build()).toEqual(original)
  const intruder = new Ed25519Keypair()
  const other_member = create_agent_transaction_signer(identity, async (bytes) => intruder.signTransaction(bytes))
  await expect(other_member(tx)).rejects.toThrow()
  const member = new Ed25519Keypair()
  const own = create_agent_multisig({
    agent_public_key: member.getPublicKey(),
    zklogin_public_identifier: google,
    sign_personal_message: refusing,
  })
  const own_tx = new Transaction()
  own_tx.setSender(own.address)
  own_tx.setGasPrice(1)
  own_tx.setGasBudget(1000000)
  own_tx.setGasPayment([{ objectId: id(50), version: '1', digest }])
  const signed = await create_agent_transaction_signer(own, async (bytes) => member.signTransaction(bytes))(own_tx)
  expect(signed.bytes).toBe(toBase64(await own_tx.build()))
})

test('a stale connect authorization that rejects late never closes the newer agent socket', async () => {
  const closed: string[] = []
  const first = Promise.withResolvers<void>()
  let calls = 0
  const connection = create_agent_connection({
    endpoint: 'ws://localhost:8080/',
    origin: 'https://app.aresrpg.world',
    signer: { address: id(9), sign_personal_message: async () => ({ bytes: '', signature: '' }) },
    authorize: async (stage) => {
      calls += 1
      if (stage === 'connect' && calls === 1) await first.promise
    },
    transport: { open: () => ({ send: () => {}, close: (_code, reason) => void closed.push(reason) }) },
  })
  const stale = connection.connect()
  await connection.connect()
  expect(connection.state().status).toBe('connecting')
  first.reject(new Error('authorization withdrawn'))
  await stale
  expect([connection.state().status, closed]).toEqual(['connecting', []])
})
