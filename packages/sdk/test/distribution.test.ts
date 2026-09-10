// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Voucher transport and redemption drive the real SDK over a fake transport.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { PERSONAL_KIOSK_RULE_ADDRESS, type KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'
import { ZkSendClient } from '@mysten/zksend'

import { SDK, absorb_object, type Receipt, type SuiTransport } from '../src/client.ts'
import {
  canonical_zksend_gift_url,
  read_giftcards,
  transfer_giftcards,
  claim_giftcard_link,
  redeem_giftcards,
} from '../src/distribution.ts'

import { execution_receipt } from './helpers/execution_receipt.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const package_id = id(1)
const defining_package_id = id(8)
const registry_id = id(2)
const kiosk_package_id = id(7)
const seed_package_id = id(11)
const content_root_id = id(12)
const pins = {
  package: package_id,
  package_original: defining_package_id,
  kiosk_package: kiosk_package_id,
  template_registry: { id: registry_id, shared_version: '1' },
  item_policy: { id: id(5), shared_version: '1' },
  version: { id: id(6), shared_version: '1' },
  seed_package: seed_package_id,
  seed_package_original: seed_package_id,
  content_root: { id: content_root_id, shared_version: '1' },
}

const resolve_gas: TransactionPlugin = async (transaction_data, options, next) => {
  // the real Sui resolver fills gas AND resolves bare object inputs (the kiosk client leaves
  // its kiosk id unresolved on purpose) — the fake mirrors both
  transaction_data.inputs.forEach((input, index) => {
    const unresolved = (input as { UnresolvedObject?: { objectId: string } }).UnresolvedObject
    if (!unresolved) return
    transaction_data.inputs[index] = {
      $kind: 'Object',
      Object: {
        $kind: 'SharedObject',
        SharedObject: { objectId: unresolved.objectId, initialSharedVersion: '1', mutable: true },
      },
    } as never
  })
  if (!options.onlyTransactionKind) {
    transaction_data.gasData.price ??= '1000'
    transaction_data.gasData.budget ??= '5000000'
    transaction_data.gasData.payment ??= [{ objectId: id(50), version: '3', digest }]
  }
  await next()
}

/** The fake CORE transport: derived distribution ids hydrate as shared objects; execution succeeds. */
const fake_client = () => {
  const hydrations: string[][] = []
  const owned_types: string[] = []
  const submitted: Transaction[] = []
  return {
    hydrations,
    owned_types,
    core: {
      listOwnedObjects: async ({ type }: { type: string }) => {
        owned_types.push(type)
        return { objects: [], hasNextPage: false, cursor: null }
      },
      resolveTransactionPlugin: () => resolve_gas,
      getObjects: async ({ objectIds }: { objectIds: string[] }) => {
        hydrations.push([...objectIds])
        return {
          objects: objectIds.map((object_id) => ({
            objectId: object_id,
            version: '1',
            digest,
            owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
          })),
        }
      },
      simulateTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }): Promise<Receipt> =>
        execution_receipt(transaction, {
          Transaction: {
            objectTypes: { [id(80)]: `${defining_package_id}::item::Item` },
            effects: { changedObjects: [{ objectId: id(80), idOperation: 'Created', outputVersion: '10' }] },
          },
        }),
    },
  }
}

const kiosk_cap = { objectId: id(3), kioskId: id(4), isPersonal: true } as KioskOwnerCap

const game = () => {
  const client = fake_client()
  const signer = new Ed25519Keypair()
  const sdk = SDK({ network: 'testnet', client: client as unknown as SuiTransport, signer, pins })
  // the kiosk + its cap are known refs (receipt-fed in production)
  const built: Transaction[] = []
  const execute = sdk.execute.bind(sdk)
  return { client, sdk, built, execute }
}

const move_call_targets = (tx: Transaction): readonly string[] =>
  tx
    .getData()
    .commands.filter((command) => command.MoveCall)
    .map((command) => {
      const { package: pkg, module, function: fn } = command.MoveCall!
      return `${pkg}::${module}::${fn}`
    })

describe('distribution SDK actions', () => {
  test('a confirmed transfer receipt prevents a lagging read from restoring the pre-transfer version', async () => {
    const { client, sdk } = game()
    const card = { id: id(78), template: id(79), amount: 1 }
    const old = { objectId: card.id, version: '1', digest, owner: { $kind: 'AddressOwner', AddressOwner: id(91) } }
    absorb_object(sdk.cache, old)
    const get_objects = client.core.getObjects
    const proof = {
      Transaction: {
        digest: 'confirmed-transfer',
        effects: {
          changedObjects: [{ objectId: card.id, outputVersion: '2', outputDigest: digest, outputState: 'ObjectWrite' }],
        },
      },
    }
    const received: string[] = []
    const capture = {
      ...sdk,
      sui_client: {
        core: {
          ...client.core,
          waitForTransaction: async ({ digest }: { digest: string }) => {
            received.push(digest)
            return proof
          },
        },
      },
      execute_personal_kiosk: async (tx: Transaction) => {
        const references = tx
          .getData()
          .inputs.flatMap((input) => (input.Object?.ImmOrOwnedObject ? [input.Object.ImmOrOwnedObject] : []))
        expect(references.find((ref) => ref.objectId === card.id)?.version).toBe('2')
        return { receipt: { digest }, kiosk_cap }
      },
    }
    client.core.getObjects = async (input) => ({
      objects: (await get_objects(input)).objects.map((row) => (row.objectId === card.id ? (old as never) : row)),
    })
    await redeem_giftcards(capture as never, kiosk_cap, [card], 'confirmed-transfer')
    expect(received).toEqual(['confirmed-transfer'])
  })

  test('redemption refreshes a cached owned voucher after another wallet transferred it', async () => {
    const { client, sdk } = game()
    const card = { id: id(78), template: id(79), amount: 5 }
    const object = {
      objectId: card.id,
      version: '1009109874',
      digest,
      owner: { $kind: 'AddressOwner', AddressOwner: id(91) },
    }
    absorb_object(sdk.cache, object)
    const original_get = client.core.getObjects
    client.core.getObjects = async (input) => ({
      objects: (await original_get(input)).objects.map((row) =>
        row.objectId === card.id ? ({ ...object, version: '1009109875' } as never) : row
      ),
    })
    let provided: string | number | undefined
    const capture = {
      ...sdk,
      execute_personal_kiosk: async (tx: Transaction) => {
        provided = tx
          .getData()
          .inputs.flatMap((input) => (input.Object?.ImmOrOwnedObject ? [input.Object.ImmOrOwnedObject] : []))
          .find((ref) => ref.objectId === card.id)?.version
        return { receipt: { digest }, kiosk_cap }
      },
    }
    await redeem_giftcards(capture as never, kiosk_cap, [card])
    expect(provided).toBe('1009109875')
  })

  test('reusable personal kiosks are queried from the OFFICIAL personal-kiosk package (never the game rules pin)', async () => {
    // 2026-08-21: querying by the game pin was blind to every real cap — wrappers are minted
    // by Mysten's network-default personal_kiosk package, the one the SDK ships
    const { client, sdk } = game()
    await sdk.get_owned_kiosks(id(99))
    expect(client.owned_types).toContain(`${PERSONAL_KIOSK_RULE_ADDRESS.testnet}::personal_kiosk::PersonalKioskCap`)
    expect(client.owned_types).not.toContain(`${kiosk_package_id}::personal_kiosk::PersonalKioskCap`)
  })

  test('redeem composes the voucher into the recipient personal kiosk', async () => {
    const { sdk } = game()
    let composed: Transaction | null = null
    const original_execute = sdk.execute_personal_kiosk
    const capturing_sdk = {
      ...sdk,
      execute_personal_kiosk: async (
        tx: Transaction,
        cap: KioskOwnerCap | null,
        options: { budget?: bigint | 'estimate' }
      ) => {
        composed = tx
        expect(options.budget).toBe('estimate')
        return original_execute(tx, cap, options)
      },
    }
    const card = { id: id(78), template: id(79), amount: 1 }

    const result = await redeem_giftcards(capturing_sdk as never, kiosk_cap, [card, { ...card, id: id(80) }])

    expect(result).toEqual({ digest: await composed!.getDigest(), kiosk_cap })
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::redeem_giftcard`)
    expect(move_call_targets(composed!).filter((target) => target.endsWith('::api::redeem_giftcard'))).toHaveLength(2)
  })

  test('a hosted zkSend claim accepts exactly one canonical Giftcard and sends it to B', async () => {
    const { sdk } = game()
    const recipient = id(88)
    const card_id = id(89)
    const template = id(90)
    const giftcard_type = `${defining_package_id}::distribution::Giftcard`
    const claimed: string[] = []
    const loaded: string[] = []
    const client = {
      network: 'testnet',
      core: {
        getObjects: async () => ({
          objects: [{ objectId: card_id, type: giftcard_type, json: { template, amount: 1 } }],
        }),
      },
    }
    const original = ZkSendClient.prototype.loadLinkFromUrl
    ZkSendClient.prototype.loadLinkFromUrl = async (url) => {
      loaded.push(url)
      return {
        assets: { nfts: [{ objectId: card_id, type: giftcard_type }], coins: [], balances: [] },
        claimAssets: async (address: string) => {
          claimed.push(address)
          return { $kind: 'Transaction', Transaction: { digest } }
        },
      } as never
    }
    try {
      const result = await claim_giftcard_link(
        client as never,
        sdk,
        'https://aresrpg.world/gift?network=testnet#$secret',
        recipient
      )
      expect(result).toEqual({ digest, giftcard: { id: card_id, template, amount: 1 } })
      expect(claimed).toEqual([recipient])
      expect(loaded).toEqual(['https://my.slush.app/claim?network=testnet#$secret'])
    } finally {
      ZkSendClient.prototype.loadLinkFromUrl = original
    }
  })

  test('giftcard URLs preserve only the bearer secret and matching network on the official claim host', () => {
    expect(canonical_zksend_gift_url('http://localhost:5173/claim?network=testnet#$secret', 'testnet')).toBe(
      'https://my.slush.app/claim?network=testnet#$secret'
    )
    expect(() => canonical_zksend_gift_url('http://localhost:5173/claim?network=testnet#$secret', 'mainnet')).toThrow(
      'belongs to testnet'
    )
    expect(canonical_zksend_gift_url('https://aresrpg.world/gift?network=testnet#$secret', 'testnet')).toBe(
      'https://my.slush.app/claim?network=testnet#$secret'
    )
    expect(() =>
      canonical_zksend_gift_url('https://aresrpg.world/airdrop?network=testnet#$secret', 'testnet')
    ).toThrow()
    expect(() => canonical_zksend_gift_url('https://aresrpg.world/gift#$secret', 'testnet')).toThrow(
      'belongs to mainnet'
    )
    expect(() => canonical_zksend_gift_url('https://aresrpg.world/gift?network=devnet#$secret', 'mainnet')).toThrow(
      'network is invalid'
    )
  })
})

test('wallet import paginates canonical cards and transfers without an airdrop Move call', async () => {
  const { sdk } = game()
  const owner = id(91)
  const recipient = id(92)
  const cards = [93, 94].map((n) => ({ id: id(n), template: id(95), amount: 1 }))
  const objects = cards.map((card) => ({
    objectId: card.id,
    version: '1',
    digest,
    type: `${defining_package_id}::distribution::Giftcard`,
    owner: { $kind: 'AddressOwner', AddressOwner: owner },
    json: { template: card.template, amount: card.amount },
  }))
  const cursors: unknown[] = []
  const client = {
    core: {
      listOwnedObjects: async ({ cursor, type }: { cursor?: string; type: string }) => {
        expect(type).toBe(objects[0]!.type)
        cursors.push(cursor)
        return { objects: [objects[cursor ? 1 : 0]], hasNextPage: !cursor, cursor: cursor ? null : 'next' }
      },
      getObjects: async () => ({ objects }),
    },
  }
  expect(await read_giftcards(client as never, sdk, owner)).toEqual(cards)
  expect(cursors).toEqual([undefined, 'next'])
  let composed: Transaction | null = null
  const capture = {
    ...sdk,
    execute: async (tx: Transaction) => {
      composed = tx
      return { $kind: 'Transaction', Transaction: { digest } }
    },
  }
  const sent = await transfer_giftcards(
    client as never,
    capture as never,
    owner,
    cards.map((card) => ({ id: card.id, recipient }))
  )
  expect(sent.giftcards).toEqual(cards)
  expect(composed!.getData().commands.map(({ $kind }) => $kind)).toEqual(['TransferObjects', 'TransferObjects'])
})

test('giftcard transfers reject duplicates, foreign types, and another owner before execution', async () => {
  const { sdk } = game()
  const owner = id(91)
  const transfer = { id: id(93), recipient: id(92) }
  let executions = 0
  const capture = {
    ...sdk,
    execute: async () => {
      executions++
      throw new Error('must not execute')
    },
  }
  await expect(transfer_giftcards({} as never, capture as never, owner, [transfer, transfer])).rejects.toThrow('twice')
  for (const [type, address] of [
    [`${id(99)}::distribution::Giftcard`, owner],
    [`${defining_package_id}::distribution::Giftcard`, id(99)],
  ]) {
    const client = {
      core: {
        getObjects: async () => ({
          objects: [
            {
              objectId: transfer.id,
              type,
              owner: { $kind: 'AddressOwner', AddressOwner: address },
              json: { template: id(95), amount: 1 },
            },
          ],
        }),
      },
    }
    await expect(transfer_giftcards(client as never, capture as never, owner, [transfer])).rejects.toThrow()
  }
  expect(executions).toBe(0)
})
