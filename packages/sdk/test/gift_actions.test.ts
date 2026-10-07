// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, mock, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { Transaction, TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { MAINNET_CONTRACT_IDS, ZkSendClient } from '@mysten/zksend'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { SDK, sui_transport } from '../src/client.ts'
import { create_gift_actions } from '../src/gift_actions.ts'

import capture from './fixtures/basecamp_transport.mainnet.json'
import fixture from './fixtures/basecamp_gift.mainnet.json'

const id = (digit: string) => `0x${digit.repeat(64)}`

test('QR transfer signs with the bearer key and uses only the same-origin Enoki gateway', async () => {
  const key = new Ed25519Keypair()
  const recipient = id('2')
  const url = `https://aresrpg.world/claim#$${toBase64(decodeSuiPrivateKey(key.getSecretKey()).secretKey)}`
  const status = { stage: 'available', proof: { giftcard: capture.object.objectId } }
  const resolver: TransactionPlugin = async (data, _options, next) => {
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
  }
  const client = {
    network: 'mainnet',
    core: {
      getDynamicField: async () => ({
        dynamicField: {
          ...capture.field.dynamicField,
          value: { ...capture.field.dynamicField.value, bcs: fromBase64(capture.field.dynamicField.value.bcs) },
        },
      }),
      getObjects: async () => ({ objects: [capture.object] }),
      resolveTransactionPlugin: () => resolver,
      simulateTransaction: async () => ({ Transaction: { effects: { status: { success: true } } } }),
      waitForTransaction: async ({ digest }: { digest: string }) => ({
        Transaction: {
          digest,
          effects: { status: { success: true }, changedObjects: [] },
          events: [],
          objectTypes: {},
        },
      }),
    },
  } as unknown as SuiGrpcClient
  const link = await new ZkSendClient(client).loadLinkFromUrl(url)
  const tx = link.createClaimTransaction(recipient)
  tx.setGasOwner(id('6'))
  tx.setGasBudget(10_000_000)
  tx.setGasPrice(1000)
  tx.setGasPayment([{ objectId: id('7'), version: '1', digest: '11111111111111111111111111111111' }])
  const bytes = await tx.build({ client })
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const fetch_original = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input, init) => {
    requests.push(String(input))
    expect(String(input)).toBe('/api/gift')
    const body = JSON.parse(String(init?.body))
    if (body.request) {
      expect(body.request).toMatchObject({
        action: 'transfer',
        address: recipient,
        sender: key.toSuiAddress(),
        proof: status.proof,
      })
      expect(JSON.stringify(body)).not.toContain(new URL(url).hash)
      return Response.json({ bytes: toBase64(bytes), digest, status })
    }
    expect(body.digest).toBe(digest)
    expect((await verifyTransactionSignature(bytes, body.signature)).toSuiAddress()).toBe(key.toSuiAddress())
    return Response.json({ digest })
  }) as typeof fetch
  try {
    const sdk = SDK({
      client: sui_transport(client),
      address: recipient,
      network: 'mainnet',
      pins: { ...fixture.policy.pins, network: 'mainnet' },
    })
    const actions = create_gift_actions(sdk, recipient, async () => ({ signature: 'recipient-intent' }))
    expect(await actions.transfer(url, status.proof)).toEqual({ digest })
    expect(requests).toEqual(['/api/gift', '/api/gift'])
  } finally {
    globalThis.fetch = fetch_original
  }
})

test('checking gift status does not ask the wallet to generate a zkLogin proof', async () => {
  const sign = mock(async () => {
    throw new Error('Status must not request signing')
  })
  const fetch_original = globalThis.fetch
  globalThis.fetch = (async (_input, init) => {
    expect(JSON.parse(String(init?.body)).signature).toBeUndefined()
    return Response.json({ stage: 'missing', proof: null })
  }) as typeof fetch
  try {
    const sdk = { network: 'mainnet', recover_pending_transaction: async () => false } as unknown as ReturnType<
      typeof SDK
    >
    expect(await create_gift_actions(sdk, id('2'), sign).status(null)).toEqual({ stage: 'missing', proof: null })
    expect(sign).not.toHaveBeenCalled()
  } finally {
    globalThis.fetch = fetch_original
  }
})
