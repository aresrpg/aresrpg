// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_CONTRACT_IDS, ZkSendClient } from '@mysten/zksend'
import { bcs } from '@mysten/sui/bcs'

import { create_gift_gateway, type GiftGatewayOptions } from '../src/gift_gateway.ts'
import { gift_request_message, GIFT_GAS_LIMIT_MIST, type GiftRequest } from '../src/gift_contract.ts'
import type { GiftPolicy } from '../src/gift_provenance.ts'

import fixture from './fixtures/basecamp_gift.mainnet.json'
import transport_fixture from './fixtures/basecamp_transport.mainnet.json'

const id = (digit: string) => `0x${digit.repeat(64)}`
const signature_key = new Ed25519Keypair()
const address = signature_key.toSuiAddress()
const proof = { giftcard: fixture.voucher.objectId }
const policy: GiftPolicy = {
  ...fixture.policy,
  pins: {
    ...fixture.policy.pins,
    network: 'mainnet',
    item_policy: { id: id('4'), shared_version: '1' },
    version: { id: id('5'), shared_version: '1' },
  },
  giftcards: new Set([proof.giftcard]),
  reward_templates: new Set(),
}
const object = (object_id: string) =>
  object_id === proof.giftcard
    ? { ...fixture.voucher, owner: { AddressOwner: address, $kind: 'AddressOwner' } }
    : {
        objectId: object_id,
        version: '1',
        digest: '11111111111111111111111111111111',
        type: '0x2::test::Template',
        owner: { Shared: { initialSharedVersion: '1' }, $kind: 'Shared' },
      }
const resolver: TransactionPlugin = async (_data, _options, next) => next()
const client = {
  network: 'mainnet',
  core: {
    getObject: async ({ objectId }: { objectId: string }) => ({ object: object(objectId) }),
    getObjects: async ({ objectIds }: { objectIds: string[] }) => ({ objects: objectIds.map(object) }),
    listOwnedObjects: async () => ({ objects: [], hasNextPage: false, cursor: null }),
    resolveTransactionPlugin: () => resolver,
    simulateTransaction: async () => ({ Transaction: { effects: { status: { success: true } } } }),
  },
} as unknown as SuiGrpcClient
const http = (body: object, origin = 'https://aresrpg.world') =>
  new Request('https://aresrpg.world/api/gift', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const signed = async (request: GiftRequest) => ({
  request,
  signature: (await signature_key.signPersonalMessage(gift_request_message(request))).signature,
})
const request: GiftRequest = { action: 'redeem', network: 'mainnet', address, time: 1000, proof }
const setup = (modify?: (transaction: Transaction) => void, rpc_client = client) => {
  const sponsored: unknown[] = []
  const executed: unknown[] = []
  const options: GiftGatewayOptions = {
    policy,
    client: rpc_client,
    now: () => 1000,
    sponsor: () => ({
      createSponsoredTransaction: async (input) => {
        sponsored.push(input)
        const tx = Transaction.fromKind(fromBase64(input.transactionKindBytes))
        tx.setSender(input.sender!)
        tx.setGasOwner(id('6'))
        tx.setGasBudget(10_000_000)
        tx.setGasPrice(1000)
        tx.setGasPayment([{ objectId: id('7'), version: '1', digest: '11111111111111111111111111111111' }])
        modify?.(tx)
        const bytes = await tx.build()
        return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
      },
      executeSponsoredTransaction: async (input) => {
        executed.push(input)
        return { digest: input.digest }
      },
    }),
  }
  return { serve: create_gift_gateway(options), sponsored, executed }
}

test('the SDK supplies exact call targets and the recipient after validating an owned campaign voucher', async () => {
  const test = setup()
  const response = await test.serve(http(await signed(request)))
  expect(response.status).toBe(200)
  expect(test.sponsored).toHaveLength(1)
  expect(test.sponsored[0]).toMatchObject({ sender: address, network: 'mainnet', allowedAddresses: [address] })
  const targets = (test.sponsored[0] as { allowedMoveCallTargets: string[] }).allowedMoveCallTargets
  expect(targets).toContain(`${policy.pins.package}::api::redeem_giftcard`)
  expect(targets).toContain(`${policy.pins.kiosk_package}::personal_kiosk::new`)
  expect(targets.some((target) => target.includes('create_character'))).toBe(false)
  const value = (await response.json()) as { bytes: string }
  expect(Transaction.from(value.bytes).getData().gasData.owner).toBe(id('6'))
  expect(test.executed).toEqual([])
})

test('unsigned, expired, cross-origin and cross-network intents cannot reach the sponsor', async () => {
  const test = setup()
  expect((await test.serve(http({ request, signature: 'invalid' }))).status).toBe(401)
  expect((await test.serve(http(await signed({ ...request, time: -400_000 })))).status).toBe(401)
  expect((await test.serve(http(await signed({ ...request, network: 'testnet' })))).status).toBe(401)
  expect((await test.serve(http(await signed(request), 'https://foreign.invalid'))).status).toBe(403)
  expect(test.sponsored).toEqual([])
})

test('the server rejects arbitrary transaction bytes, another voucher and the wrong operation', async () => {
  const test = setup()
  expect((await test.serve(http({ ...(await signed(request)), transactionKindBytes: 'untrusted' }))).status).toBe(400)
  expect((await test.serve(http(await signed({ ...request, proof: { giftcard: id('9') } })))).status).toBe(403)
  expect((await test.serve(http(await signed({ ...request, action: 'open' })))).status).toBe(403)
  expect(test.sponsored).toEqual([])
})

test('the sponsor cannot alter the approved intent, charge the recipient, or exceed the gas ceiling', async () => {
  for (const modify of [
    (tx: Transaction) => tx.setGasOwner(address),
    (tx: Transaction) => tx.setGasBudget(GIFT_GAS_LIMIT_MIST + 1n),
    (tx: Transaction) => {
      tx.moveCall({ target: `${id('8')}::attacker::call` })
    },
  ]) {
    const test = setup(modify)
    expect((await test.serve(http(await signed(request)))).status).toBe(503)
    expect(test.executed).toEqual([])
  }
})

test('execution forwards only the previously sponsored digest and user signature, once', async () => {
  const test = setup()
  const { digest } = fixture.redeem.Transaction
  expect((await test.serve(http({ digest, signature: 'transaction-signature' }))).status).toBe(200)
  expect(test.executed).toEqual([{ digest, signature: 'transaction-signature' }])
  expect(test.sponsored).toEqual([])
  expect((await test.serve(http({ digest, signature: 's', bytes: 'arbitrary' }))).status).toBe(400)
  expect(test.executed).toHaveLength(1)
})

test('oversized and malformed bodies fail before any sponsorship call', async () => {
  const test = setup()
  expect((await test.serve(http({ padding: 'x'.repeat(25_000) }))).status).toBe(400)
  const invalid = new Request('https://aresrpg.world/api/gift', {
    method: 'POST',
    headers: { origin: 'https://aresrpg.world' },
    body: '{',
  })
  expect((await test.serve(invalid)).status).toBe(400)
  expect(test.sponsored).toEqual([])
})

// Captured mainnet bag 0x93109e…68b4 and voucher 0x5acf01…6d5a, version 1034707540, 2026-10-08.
const transport_client = (extra_asset = false): SuiGrpcClient =>
  ({
    network: 'mainnet',
    core: {
      ...client.core,
      getObject: async () => ({ object: transport_fixture.object }),
      getDynamicField: async ({ name }: { name: { bcs: Uint8Array } }) => {
        if (bcs.Address.parse(name.bcs) !== transport_fixture.sender) throw new Error('Unknown bag')
        const field = transport_fixture.field.dynamicField
        return { dynamicField: { ...field, value: { ...field.value, bcs: fromBase64(field.value.bcs) } } }
      },
      getObjects: async () => ({
        objects: extra_asset
          ? [transport_fixture.object, { ...transport_fixture.object, objectId: id('9') }]
          : [transport_fixture.object],
      }),
      resolveTransactionPlugin: () =>
        (async (data, _options, next) => {
          data.inputs.forEach((input, index) => {
            if (input.UnresolvedObject)
              data.inputs[index] = {
                $kind: 'Object',
                Object: {
                  $kind: 'SharedObject',
                  SharedObject: {
                    objectId: MAINNET_CONTRACT_IDS.bagStoreId,
                    initialSharedVersion: '1',
                    mutable: true,
                  },
                },
              }
          })
          await next()
        }) satisfies TransactionPlugin,
    },
  }) as unknown as SuiGrpcClient

test('Enoki sponsors only the captured one-card transport to the authenticated recipient', async () => {
  const rpc_client = transport_client()
  const service = setup(undefined, rpc_client)
  const intent: GiftRequest = { ...request, action: 'transfer', sender: transport_fixture.sender }
  const response = await service.serve(http(await signed(intent)))
  expect(response.status).toBe(200)
  expect(service.sponsored).toHaveLength(1)
  expect(service.sponsored[0]).toMatchObject({ sender: transport_fixture.sender, allowedAddresses: [address] })
  const value = (await response.json()) as { bytes: string }
  const tx = Transaction.from(value.bytes)
  expect(tx.getData().sender).toBe(transport_fixture.sender)
  expect(tx.getData().commands.map((command) => command.$kind)).toEqual([
    'MoveCall',
    'MoveCall',
    'TransferObjects',
    'MoveCall',
  ])
  // Compare the complete kind with the official SDK claim builder; the test never calls claimAssets().
  const link = new ZkSendClient(rpc_client).getLink({ keypair: signature_key })
  const captured = await new ZkSendClient(rpc_client).loadLink({ address: transport_fixture.sender })
  link.assets = captured.assets
  const expected = await link.createClaimTransaction(address).build({ client: rpc_client, onlyTransactionKind: true })
  expect(toBase64(await tx.build({ onlyTransactionKind: true }))).toBe(toBase64(expected))
  expect(service.executed).toEqual([])
})

test('another bag, extra assets, altered recipients and recipient-paid gas are refused', async () => {
  const intent: GiftRequest = { ...request, action: 'transfer', sender: transport_fixture.sender }
  const wrong = setup(undefined, transport_client())
  expect((await wrong.serve(http(await signed({ ...intent, sender: id('9') })))).status).toBe(403)
  expect(wrong.sponsored).toEqual([])
  const extra = setup(undefined, transport_client(true))
  expect((await extra.serve(http(await signed(intent)))).status).toBe(403)
  expect(extra.sponsored).toEqual([])
  for (const modify of [
    (tx: Transaction) => tx.setGasOwner(address),
    (tx: Transaction) => {
      tx.transferObjects([], id('9'))
    },
  ]) {
    const service = setup(modify, transport_client())
    expect((await service.serve(http(await signed(intent)))).status).toBe(503)
    expect(service.executed).toEqual([])
  }
})

test('public status reads need no wallet proof and cannot allocate sponsorship', async () => {
  const service = setup()
  const response = await service.serve(http({ request: { ...request, action: 'status' } }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ stage: 'voucher', proof })
  expect((await service.serve(http({ request }))).status).toBe(400)
  expect(service.sponsored).toEqual([])
  expect(service.executed).toEqual([])
})
