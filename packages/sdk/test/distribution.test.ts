// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Airdrop claims drive the real SDK over a fake transport: the composed transaction must name
// the exact Move door and derived objects.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { PERSONAL_KIOSK_RULE_ADDRESS, type KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'
import { ZkSendClient } from '@mysten/zksend'

import { SDK, type Receipt, type SuiTransport } from '../src/client.ts'
import { canonical_zksend_gift_url, claim_airdrop, claim_giftcard_link, redeem_giftcard } from '../src/distribution.ts'
import { airdrop_id, item_template_id } from '../src/seed_ids.ts'

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
      executeTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
    },
  }
}

const kiosk_cap = { objectId: id(3), kioskId: id(4), isPersonal: true } as KioskOwnerCap

const game = () => {
  const client = fake_client()
  const signer = new Ed25519Keypair()
  const sdk = SDK({ client: client as unknown as SuiTransport, signer, pins })
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
  test('reusable personal kiosks are queried from the OFFICIAL personal-kiosk package (never the game rules pin)', async () => {
    // 2026-08-21: querying by the game pin was blind to every real cap — wrappers are minted
    // by Mysten's network-default personal_kiosk package, the one the SDK ships
    const { client, sdk } = game()
    await sdk.get_owned_kiosks(id(99))
    expect(client.owned_types).toContain(`${PERSONAL_KIOSK_RULE_ADDRESS.testnet}::personal_kiosk::PersonalKioskCap`)
    expect(client.owned_types).not.toContain(`${kiosk_package_id}::personal_kiosk::PersonalKioskCap`)
  })

  test('claim composes the real api::claim_airdrop door over the derived drop id', async () => {
    const { client, sdk } = game()
    let composed: Transaction | null = null
    const recipient = id(77)
    const giftcard = id(78)
    const template = item_template_id(content_root_id, seed_package_id, 'vaporeon')
    const capturing_sdk = {
      ...sdk,
      execute: async (tx: Transaction) => {
        composed = tx
        return {
          $kind: 'Transaction',
          Transaction: {
            digest,
            events: [
              { type: `${package_id}::distribution::GiftcardMinted`, json: { giftcard, template, amount: 1 } },
              {
                type: `${package_id}::distribution::AirdropClaimed`,
                json: { giftcard, recipient, drop_id: 'vaporeon_holders', claimer: id(76), remaining: '21' },
              },
            ],
          },
        }
      },
    }

    const result = await claim_airdrop(capturing_sdk as never, {
      drop_id: 'vaporeon_holders',
      item_type: 'vaporeon',
      recipient,
    })
    expect(result).toEqual({
      digest,
      giftcard: { id: giftcard, template, amount: 1 },
    })
    expect(client.hydrations[0]).toEqual([
      airdrop_id(content_root_id, defining_package_id, 'vaporeon_holders'),
      template,
    ])
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::claim_airdrop`)
  })

  test('redeem composes the voucher into the recipient personal kiosk', async () => {
    const { sdk } = game()
    let composed: Transaction | null = null
    const original_execute = sdk.execute_personal_kiosk
    const capturing_sdk = {
      ...sdk,
      execute_personal_kiosk: async (tx: Transaction, cap: KioskOwnerCap | null) => {
        composed = tx
        return original_execute(tx, cap)
      },
    }
    const card = { id: id(78), template: id(79), amount: 1 }

    const result = await redeem_giftcard(capturing_sdk as never, kiosk_cap, { card, category: 'consumable' })

    expect(result).toEqual({ digest, kiosk_cap })
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::redeem_giftcard`)
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
