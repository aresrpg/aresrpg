// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shop purchases drive the REAL SDK over a fake transport: the composed transaction must name
// the exact Move door, split the exact payment, and pass the exact quantity — a wrong target,
// amount, or argument would have stayed green under the old collaborator fakes.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type Receipt, type SuiTransport } from '../src/client.ts'
import { buy_shop_item, claim_airdrop } from '../src/shop.ts'
import { airdrop_id, item_template_id, sale_id } from '../src/seed_ids.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const package_id = id(1)
const registry_id = id(2)
const pins = {
  package: package_id,
  template_registry: { id: registry_id, shared_version: '1' },
  item_policy: { id: id(5), shared_version: '1' },
  version: { id: id(6), shared_version: '1' },
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

/** The fake CORE transport: derived shop ids hydrate as shared objects; execution succeeds. */
const fake_client = () => {
  const hydrations: string[][] = []
  const submitted: Transaction[] = []
  return {
    hydrations,
    core: {
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

const pure_u64s = (tx: Transaction): readonly bigint[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 8) return []
    let value = 0n
    for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!)
    return [value]
  })

describe('shop SDK actions', () => {
  test('buy composes the real api::buy door with the exact split payment and quantity', async () => {
    const { client, sdk } = game()
    // capture the composed transaction at the executor door
    let composed: Transaction | null = null
    const original_execute = sdk.execute
    const capturing_sdk = { ...sdk, execute: async (tx: Transaction) => ((composed = tx), original_execute(tx)) }

    const result = await buy_shop_item(capturing_sdk as never, kiosk_cap, {
      item_type: 'pet_lootbox',
      category: 'consumable',
      price_mist: 25_000_000_000n,
      quantity: 3,
      existing_item_id: null,
    })
    expect(result).toEqual({ digest })

    // the derived sale + template ids were hydrated (and only those two)
    expect(client.hydrations[0]).toEqual([
      sale_id(registry_id, package_id, 'pet_lootbox'),
      item_template_id(registry_id, 'pet_lootbox'),
    ])
    // the composed transaction names the REAL door on the REAL package
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::buy`)
    // the payment split is price × quantity, present as a pure u64 input
    expect(pure_u64s(composed!)).toContain(75_000_000_000n)
  })

  test('refuses an impossible multi-cosmetic purchase before any effect', async () => {
    const { client, sdk } = game()
    await expect(
      buy_shop_item(sdk as never, kiosk_cap, {
        item_type: 'berserk',
        category: 'hat',
        price_mist: 220_000_000_000n,
        quantity: 2,
      })
    ).rejects.toThrow('Only stackable items')
    expect(client.hydrations).toEqual([])
  })

  test('claim composes the real api::claim_airdrop door over the derived drop id', async () => {
    const { client, sdk } = game()
    let composed: Transaction | null = null
    const original_execute = sdk.execute
    const capturing_sdk = { ...sdk, execute: async (tx: Transaction) => ((composed = tx), original_execute(tx)) }

    const result = await claim_airdrop(capturing_sdk as never, kiosk_cap, {
      drop_id: 'founders',
      item_type: 'title_veteran',
      category: 'title',
      existing_item_id: id(9),
    })
    expect(result).toEqual({ digest })
    expect(client.hydrations[0]).toEqual([
      airdrop_id(registry_id, package_id, 'founders'),
      item_template_id(registry_id, 'title_veteran'),
    ])
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::claim_airdrop`)
  })
})
