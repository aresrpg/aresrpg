// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gifts: a printed link is judged before any network read, giftcards move in bounded batches, admin
// links refuse foreign custody, and a captured redemption proves exactly one crate.

import { expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { SuiClientTypes } from '@mysten/sui/client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import { create_admin_giftcard_links } from '../src/admin_auth.ts'
import { SDK } from '../src/client.ts'
import { inspect_giftcard_link, redeem_giftcards, transfer_giftcards } from '../src/distribution.ts'
import { validate_gift_voucher } from '../src/gift_chain.ts'
import { GiftError } from '../src/gift_contract.ts'
import { gift_redemption, verified_gift_package, type GiftPolicy, type GiftReceipt } from '../src/gift_provenance.ts'

import gift from './fixtures/basecamp_gift.mainnet.json'
import { digest, fake_client, id, pins, signer, type FakeClient } from './helpers/transport.ts'

const game_pins = { ...pins, package_original: id(1), kiosk_package: id(20) }
const kiosk_cap = (): KioskOwnerCap => ({ objectId: id(300), kioskId: id(4), isPersonal: true, version: '1', digest })
const game = (client: FakeClient = fake_client()) => ({
  client,
  sdk: SDK({ client, signer, pins: game_pins, transaction_storage: null }),
})
const targets = (tx: Transaction) =>
  tx.getData().commands.flatMap(({ MoveCall }) => (MoveCall ? [`${MoveCall.module}::${MoveCall.function}`] : []))
const submitted = (client: FakeClient) => Transaction.from(client.calls.submitted.at(-1)!)
const me = signer.toSuiAddress()

test('a malformed or truncated printed link is invalid before any network read; a well-formed one reaches the chain', async () => {
  const reads: string[] = []
  const chain = {
    network: 'mainnet',
    core: new Proxy(
      {},
      {
        get: (_target, method) => async () => {
          reads.push(String(method))
          throw new Error('network reached')
        },
      }
    ),
  } as unknown as SuiGrpcClient
  const { sdk } = game()
  const key = toBase64(new Uint8Array(32).fill(7))
  for (const link of [
    'https://my.slush.app/claim#$garbage',
    `https://my.slush.app/claim#$${key.slice(0, 20)}`,
    'https://my.slush.app/claim#$',
    'https://my.slush.app/wallet#$' + key,
  ]) {
    const error = await inspect_giftcard_link(chain, sdk, link).catch((failure: unknown) => failure)
    expect([error instanceof GiftError, (error as GiftError).code]).toEqual([true, 'invalid'])
  }
  expect(reads).toEqual([])
  const reached = await inspect_giftcard_link(chain, sdk, `https://my.slush.app/claim#$${key}`).catch(
    (failure: unknown) => failure
  )
  expect(reached instanceof GiftError).toBe(false)
  expect(reads.length).toBeGreaterThan(0)
})

test('giftcards move 1..100 at a time without duplicates; admin links refuse foreign custody and reused keys', async () => {
  const { client, sdk } = game()
  const card = { id: id(78), template: id(79), amount: 1 }
  await redeem_giftcards(sdk, kiosk_cap(), [card, { ...card, id: id(80) }])
  expect(targets(submitted(client)).filter((target) => target === 'api::redeem_giftcard')).toHaveLength(2)
  await expect(redeem_giftcards(sdk, kiosk_cap(), [card, card])).rejects.toThrow('twice')
  await expect(
    redeem_giftcards(
      sdk,
      kiosk_cap(),
      Array.from({ length: 101 }, (_, index) => ({ ...card, id: id(400 + index) }))
    )
  ).rejects.toThrow('1..100')
  await expect(
    transfer_giftcards({} as never, sdk, me, [
      { id: id(93), recipient: id(92) },
      { id: id(93), recipient: id(92) },
    ])
  ).rejects.toThrow('twice')
  const foreign = {
    core: {
      getObjects: async () => ({
        objects: [
          {
            objectId: id(93),
            type: `${id(99)}::distribution::Giftcard`,
            owner: { $kind: 'AddressOwner', AddressOwner: me },
            json: { template: id(95), amount: 1 },
          },
        ],
      }),
    },
  }
  await expect(transfer_giftcards(foreign as never, sdk, me, [{ id: id(93), recipient: id(92) }])).rejects.toThrow()
  expect(client.calls.executions).toBe(1)

  const links = (owner: string) => {
    const reads: number[] = []
    const sent: Transaction[] = []
    const reader = {
      network: 'testnet',
      core: {
        getObjects: async ({ objectIds }: { objectIds: string[] }) => {
          reads.push(objectIds.length)
          return {
            objects: objectIds.map((object_id) => ({
              objectId: object_id,
              version: '1',
              digest,
              type: `${id(2)}::distribution::Giftcard`,
              owner: { $kind: 'AddressOwner', AddressOwner: owner },
            })),
          }
        },
      },
    } as unknown as SuiGrpcClient
    const context = {
      address: id(1),
      client: reader,
      game_type_package: id(2),
      execute: async (tx: Transaction) => {
        sent.push(tx)
        return { $kind: 'Transaction', Transaction: { digest } }
      },
    }
    return { reads, sent, context }
  }
  const cards = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: id(index + 3), key: Ed25519Keypair.generate().getSecretKey() }))
  const signed = links(id(1))
  const result = await create_admin_giftcard_links(signed.context, cards(100))
  expect([new Set(result.urls).size, signed.reads, signed.sent[0]?.getData().commands.length]).toEqual([
    100,
    [50, 50, 50, 50],
    200,
  ])
  const foreign_custody = links(id(9))
  await expect(create_admin_giftcard_links(foreign_custody.context, cards(2))).rejects.toThrow(
    'owned by the connected signer'
  )
  const key = Ed25519Keypair.generate().getSecretKey()
  await expect(
    create_admin_giftcard_links(signed.context, [
      { id: id(3), key },
      { id: id(4), key },
    ])
  ).rejects.toThrow('reuse a bearer key')
  await expect(
    create_admin_giftcard_links(signed.context, [
      { id: id(3), key },
      { id: id(3), key: Ed25519Keypair.generate().getSecretKey() },
    ])
  ).rejects.toThrow('reuse an object')
  expect([foreign_custody.sent.length, signed.sent.length]).toEqual([0, 1])
})

// Captured mainnet object 0x5acf…6d5a v1034707540 and tx 5SCHg…GGuc, 2026-10-07.
test('a captured basecamp redemption proves its exact crate; forged, failed or foreign receipts prove nothing', () => {
  const receipt = (): GiftReceipt => {
    const copy = structuredClone(gift.redeem) as unknown as GiftReceipt
    copy.Transaction!.transaction = Transaction.from(gift.redeem.Transaction.bcs).getData()
    return copy
  }
  const card = String(gift.redeem.Transaction.events[0]!.json!.giftcard)
  const { sender } = gift.redeem.Transaction.transaction
  const proof = { giftcard: card, redeem: gift.redeem.Transaction.digest }
  const current: GiftPolicy = {
    ...gift.policy,
    pins: { ...gift.policy.pins, network: 'mainnet' },
    giftcards: new Set([card, gift.voucher.objectId]),
    reward_templates: new Set(),
  }
  const policy = verified_gift_package(current, gift.package_lineage.id, gift.package_lineage.original)
  validate_gift_voucher(policy, gift.voucher as unknown as SuiClientTypes.Object<{ json: true }>)
  expect(gift_redemption(policy, sender, proof, receipt())).toEqual({
    stage: 'crate',
    proof,
    crate: '0x2458af09ad8778e1f6990c90c3d57b9a406f2efe880b3b5025590d3a9306b577',
    kiosk: '0x1b07fba3f12dd29206933ad62d443ec0883561ede9299919d0b6561663bfa374',
  })
  expect(() => validate_gift_voucher({ ...policy, giftcards: new Set() }, gift.voucher as never)).toThrow()
  expect(() => gift_redemption(policy, sender, { ...proof, giftcard: gift.voucher.objectId }, receipt())).toThrow()
  const extra = receipt()
  extra.Transaction!.transaction.commands.push({ TransferObjects: { objects: [], address: { Input: 0 } } })
  const forged = receipt()
  forged.Transaction!.events[0]!.eventType = '0x2::distribution::GiftcardRedeemed'
  forged.Transaction!.events[0]!.packageId = '0x2'
  const failed = receipt()
  failed.Transaction!.effects.status = { success: false, error: { message: 'aborted' } } as never
  for (const refused of [extra, forged, failed]) expect(() => gift_redemption(policy, sender, proof, refused)).toThrow()
  expect(() => verified_gift_package(current, gift.package_lineage.id, '0x2')).toThrow()
  const upgraded = receipt()
  upgraded.Transaction!.events[0]!.eventType = `${gift.package_lineage.id}::distribution::GiftcardRedeemed`
  expect(gift_redemption(policy, sender, proof, upgraded).stage).toBe('crate')
})
