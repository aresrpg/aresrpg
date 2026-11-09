// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { getZkLoginSignature, toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { Inputs, Transaction, type TransactionPlugin } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { parseSerializedSignature } from '@mysten/sui/cryptography'

import pins from '../../../pins.json'
import { create_agent_multisig } from '../src/agent_multisig.ts'
import { create_google_transaction_signer } from '../src/agent_transactions.ts'
import { owner_agent_identity, create_agent_recall_reader } from '../src/agent_recall.ts'

const read_agent_recall = (
  options: Omit<Parameters<typeof create_agent_recall_reader>[0], 'read_request'> & {
    pairing: Parameters<ReturnType<typeof create_agent_recall_reader>['read']>[0]
    request: unknown
  }
) => create_agent_recall_reader({ ...options, read_request: () => options.request }).read(options.pairing)

const agent = new Ed25519PublicKey(new Uint8Array(32).fill(9))
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const identity = create_agent_multisig({
  agent_public_key: agent,
  zklogin_public_identifier: google,
  sign_personal_message: async () => {
    throw new Error('Agent must not participate in recall')
  },
})
const pairing = {
  address: identity.address,
  multisig_public_key: identity.public_key.toBase64(),
  signer_mode: 'host-persistent' as const,
}
const request = {
  version: 1,
  nonce: '11111111-1111-4111-8111-111111111111',
  network: 'mainnet',
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
}

test('owner recall reconstructs the exact identity without an agent callback or key', () => {
  expect(owner_agent_identity(pairing, request).address).toBe(identity.address)
})
test('foreign Google owner, altered address, threshold and key order cannot authorize recall', () => {
  const other = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
  expect(() =>
    owner_agent_identity(pairing, {
      ...request,
      owner: other.toSuiAddress(),
      zklogin_public_identifier: other.toBase64(),
    })
  ).toThrow('recovery member')
  expect(() => owner_agent_identity({ ...pairing, address: other.toSuiAddress() }, request)).toThrow('recovery member')
  for (const public_key of [
    MultiSigPublicKey.fromPublicKeys({
      threshold: 2,
      publicKeys: [
        { publicKey: agent, weight: 1 },
        { publicKey: google, weight: 1 },
      ],
    }),
    MultiSigPublicKey.fromPublicKeys({
      threshold: 1,
      publicKeys: [
        { publicKey: google, weight: 1 },
        { publicKey: agent, weight: 1 },
      ],
    }),
  ])
    expect(() =>
      owner_agent_identity(
        { ...pairing, address: public_key.toSuiAddress(), multisig_public_key: public_key.toBase64() },
        request
      )
    ).toThrow()
})

// Synthetic zk proof envelope with an explicit verification-service stub. This tests member
// selection and wallet-byte forwarding, NOT validity of a real Google proof or credential.
test('Google partial goes through the explicit verifier and wraps member 1 without agent signing', async () => {
  const tx = new Transaction()
  tx.setSender(identity.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000000)
  tx.setGasPayment([{ objectId: `0x${'3'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }])
  const signature = getZkLoginSignature({
    inputs: {
      proofPoints: { a: ['0'], b: [['0']], c: ['0'] },
      issBase64Details: {
        value: Buffer.from('"iss":"https://accounts.google.com",').toString('base64url'),
        indexMod4: 0,
      },
      headerBase64: '',
      addressSeed: '1',
    },
    maxEpoch: 1,
    userSignature: new Uint8Array(97),
  })
  let verified = false
  let accept = true
  const client = {
    core: {
      verifyZkLoginSignature: async (input: { intentScope: string; bytes: string; signature: string }) => {
        expect(input.intentScope).toBe('TransactionData')
        expect(input.bytes).toBe(toBase64(await tx.build()))
        expect(input.signature).toBe(signature)
        verified = true
        return { success: accept, errors: [] }
      },
    },
  }
  const signer = create_google_transaction_signer(
    identity,
    async (bytes) => ({ bytes: toBase64(bytes), signature }),
    client as never
  )
  const result = await signer(tx)
  expect(verified).toBe(true)
  const parsed = parseSerializedSignature(result.signature)
  expect(parsed.signatureScheme).toBe('MultiSig')
  if (parsed.signatureScheme !== 'MultiSig') throw new Error('Wrong envelope')
  expect(parsed.multisig.bitmap).toBe(2)
  expect(result.bytes).toBe(toBase64(await tx.build()))
  expect(fromBase64(result.signature)[0]).toBe(3)
  accept = false
  await expect(signer(tx)).rejects.toThrow('not valid')
})

test('Recall discovery uses the multisig and owner readers without invoking either signer', async () => {
  const owners: string[] = []
  const client = {
    core: {
      listOwnedObjects: async (input: { owner: string }) => {
        owners.push(input.owner)
        return { objects: [], hasNextPage: false, cursor: null }
      },
    },
  }
  const recall = await read_agent_recall({
    pairing,
    request,
    client: client as never,
    sign_transaction: async () => {
      throw new Error('Discovery must never sign')
    },
  })
  expect(recall.characters).toEqual([])
  expect(recall.pending).toEqual([])
  expect(owners).toContain(identity.address)
  expect(owners).toContain(request.owner)
  expect(typeof recall.transfer.prepare).toBe('function')
})

test('Recall discovers a populated personal kiosk and current equipment through real SDK readers', async () => {
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const cap_bcs = bcs.struct('SyntheticPersonalKioskCap', {
    id: bcs.Address,
    cap: bcs.option(bcs.struct('SyntheticKioskOwnerCap', { id: bcs.Address, for: bcs.Address })),
  })
  const core = {
    listOwnedObjects: async ({ owner, type }: { owner: string; type: string }) => ({
      objects:
        owner === identity.address && type.includes('PersonalKioskCap')
          ? [
              {
                objectId: id(10),
                version: '1',
                digest: '11111111111111111111111111111111',
                type,
                content: cap_bcs.serialize({ id: id(10), cap: { id: id(11), for: id(12) } }).toBytes(),
              },
            ]
          : [],
      hasNextPage: false,
      cursor: null,
    }),
    listDynamicFields: async ({ parentId }: { parentId: string }) => ({
      dynamicFields:
        parentId === id(12)
          ? [
              {
                fieldId: id(13),
                name: { type: '0x2::kiosk::Item', bcs: bcs.Address.serialize(id(14)).toBytes() },
                valueType: `${pins.package_original}::character::Character`,
              },
            ]
          : [
              {
                fieldId: id(15),
                name: { type: `${pins.package_original}::equipment::EquipmentKey`, bcs: new Uint8Array([0]) },
              },
            ],
      hasNextPage: false,
      cursor: null,
    }),
    getObjects: async () => ({
      objects: [
        {
          objectId: id(15),
          json: {
            value: {
              contents: [{ key: 'tool', value: { item: id(16) } }],
            },
          },
        },
      ],
    }),
  }
  const recall = await read_agent_recall({
    pairing,
    request,
    client: { core } as never,
    sign_transaction: async () => {
      throw new Error('Discovery must never sign')
    },
  })
  expect(recall.characters).toEqual([
    { character_id: id(14), kiosk: id(12), unequip: [{ slot: 'tool', item_id: id(16) }] },
  ])
  await expect(
    recall.transfer.prepare({
      kind: 'offer',
      character_id: id(14),
      kiosk: id(12),
      recipient: request.owner,
      unequip: [],
    })
  ).rejects.toThrow('Equipment changed')
  await expect(
    recall.transfer.prepare({
      kind: 'offer',
      character_id: id(14),
      kiosk: id(12),
      recipient: id(99),
      unequip: recall.characters[0]!.unequip,
    })
  ).rejects.toThrow('current Google owner')
})

test('session recall idle guard retains every registered multisig pending submission', async () => {
  const stored = new Map<string, string>()
  const transaction_storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value)
    },
    removeItem: (key: string) => {
      stored.delete(key)
    },
  }
  const reader = create_agent_recall_reader({
    read_request: () => request,
    transaction_storage,
    client: { core: { listOwnedObjects: async () => ({ objects: [], hasNextPage: false, cursor: null }) } } as never,
    sign_transaction: async () => {
      throw new Error('Discovery must not sign')
    },
  })
  await reader.read(pairing)
  const other = create_agent_multisig({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(7)),
    zklogin_public_identifier: google,
    sign_personal_message: async () => {
      throw new Error('unused')
    },
  })
  await reader.read({ ...pairing, address: other.address, multisig_public_key: other.public_key.toBase64() })
  expect(reader.is_transaction_idle()).toBe(true)
  const key = `aresrpg:transaction:mainnet:${identity.address}`
  stored.set(key, JSON.stringify({ digest: '11111111111111111111111111111111', phase: 'submitted' }))
  expect(reader.is_transaction_idle()).toBe(false)
  await reader.read(pairing)
  expect(reader.is_transaction_idle()).toBe(false)
  stored.delete(key)
  expect(reader.is_transaction_idle()).toBe(true)
})

test('refreshing Recall shares the signing queue and keeps reload vetoed until both jobs finish', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let signs = 0
  const resolver: TransactionPlugin = async (data, _options, next) => {
    data.inputs.forEach((input, index) => {
      if (input.UnresolvedObject)
        data.inputs[index] = Inputs.ObjectRef({
          objectId: input.UnresolvedObject.objectId,
          version: '1',
          digest: '11111111111111111111111111111111',
        })
    })
    data.gasData.price = '1'
    data.gasData.payment = [
      { objectId: `0x${'9'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' },
    ]
    await next()
  }
  const reader = create_agent_recall_reader({
    read_request: () => request,
    transaction_storage: null,
    client: {
      core: {
        listOwnedObjects: async () => ({ objects: [], hasNextPage: false, cursor: null }),
        resolveTransactionPlugin: () => resolver,
        simulateTransaction: async () => ({
          Transaction: {
            effects: {
              status: { success: true },
              gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0' },
            },
          },
        }),
        executeTransaction: async () => {
          throw new Error('Must not submit')
        },
        waitForTransaction: async () => {
          throw new Error('Must not query execution')
        },
      },
    } as never,
    sign_transaction: async () => {
      signs += 1
      entered.resolve()
      await release.promise
      throw new Error('Synthetic wallet rejection before any signature')
    },
  })
  const intent = { kind: 'cancel' as const, seller_kiosk: `0x${'4'.repeat(64)}`, purchase_cap: `0x${'5'.repeat(64)}` }
  const first = await reader.read(pairing)
  const review = await first.transfer.prepare(intent)
  const result = review.confirm().catch((error) => String(error))
  await entered.promise
  expect(reader.is_transaction_idle()).toBe(false)
  const refreshed = await reader.read(pairing)
  const next_review = await refreshed.transfer.prepare(intent)
  const next_result = next_review.confirm().catch((error) => String(error))
  // Let the second confirmation finish preflight and reach its executor queue.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(signs).toBe(1)
  expect(reader.is_transaction_idle()).toBe(false)
  release.resolve()
  expect(await result).toContain('Synthetic wallet rejection')
  expect(await next_result).toContain('Synthetic wallet rejection')
  expect(signs).toBe(2)
  expect(reader.is_transaction_idle()).toBe(true)
})

// Synthetic chain objects only. Exercise the real Recall loader and transaction builders;
// the owner wallet rejects before producing any signature or submitting to a network.
const recall_kiosk_fixture = async (kiosk_ids: readonly number[]) => {
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const cap_bcs = bcs.struct('SyntheticRecallCap', {
    id: bcs.Address,
    cap: bcs.option(bcs.struct('SyntheticRecallOwnerCap', { id: bcs.Address, for: bcs.Address })),
  })
  const signed: ReturnType<Transaction['getData']>[] = []
  const resolver: TransactionPlugin = async (data, _options, next) => {
    data.inputs.forEach((input, index) => {
      if (input.UnresolvedObject)
        data.inputs[index] = Inputs.ObjectRef({
          objectId: input.UnresolvedObject.objectId,
          version: '1',
          digest: '11111111111111111111111111111111',
        })
    })
    data.gasData.price = '1'
    data.gasData.payment = [{ objectId: id(99), version: '1', digest: '11111111111111111111111111111111' }]
    await next()
  }
  const recall = await read_agent_recall({
    pairing,
    request,
    transaction_storage: null,
    client: {
      core: {
        listOwnedObjects: async ({ owner, type }: { owner: string; type: string }) => ({
          objects:
            owner === identity.address && type.includes('PersonalKioskCap')
              ? kiosk_ids.map((kiosk) => ({
                  objectId: id(kiosk + 10),
                  version: '1',
                  digest: '11111111111111111111111111111111',
                  type,
                  content: cap_bcs
                    .serialize({ id: id(kiosk + 10), cap: { id: id(kiosk + 20), for: id(kiosk) } })
                    .toBytes(),
                }))
              : [],
          hasNextPage: false,
        }),
        listDynamicFields: async () => ({ dynamicFields: [], hasNextPage: false }),
        resolveTransactionPlugin: () => resolver,
        simulateTransaction: async () => ({
          Transaction: {
            effects: {
              status: { success: true },
              gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0' },
            },
          },
        }),
      },
    } as never,
    sign_transaction: async (tx) => {
      signed.push(tx.getData())
      throw new Error('Synthetic owner rejected before signing')
    },
  })
  return { recall, signed, id }
}

for (const kiosks of [[1, 2], []]) {
  test(`owner claim ${kiosks.length ? 'reuses the first current personal kiosk' : 'creates a kiosk only when none exists'}`, async () => {
    const { recall, signed, id } = await recall_kiosk_fixture(kiosks)
    const review = await recall.transfer.prepare({
      kind: 'claim',
      character_id: id(40),
      seller_kiosk: id(41),
      purchase_cap: id(42),
    })
    expect(signed).toHaveLength(0)
    expect(review.sender).toBe(identity.address)
    await expect(review.confirm()).rejects.toThrow('Synthetic owner rejected before signing')
    expect(signed).toHaveLength(1)
    const tx = signed[0]!
    const calls = tx.commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))
    expect(calls.some((call) => call.module === 'kiosk' && call.function === 'new')).toBe(kiosks.length === 0)
    expect(calls.some((call) => call.function === 'purchase_with_cap')).toBe(true)
    if (kiosks.length) {
      const objects = tx.inputs.flatMap((input) =>
        input.Object?.ImmOrOwnedObject ? [input.Object.ImmOrOwnedObject.objectId] : []
      )
      expect(objects).toContain(id(11))
      expect(objects).not.toContain(id(12))
    }
  })
}

test('Recall explicit kiosk lookup uses the exact cap and refuses a missing ID without falling back', async () => {
  const { recall, signed, id } = await recall_kiosk_fixture([1, 2])
  await expect(
    recall.transfer.prepare({ kind: 'offer', character_id: id(40), kiosk: id(3), recipient: request.owner })
  ).rejects.toThrow('PersonalKioskCap is unavailable')
  expect(signed).toHaveLength(0)
  const review = await recall.transfer.prepare({
    kind: 'offer',
    character_id: id(40),
    kiosk: id(2),
    recipient: request.owner,
  })
  await expect(review.confirm()).rejects.toThrow('Synthetic owner rejected before signing')
  const objects = signed[0]!.inputs.flatMap((input) =>
    input.Object?.ImmOrOwnedObject ? [input.Object.ImmOrOwnedObject.objectId] : []
  )
  expect(objects).toContain(id(12))
  expect(objects).not.toContain(id(11))
})
