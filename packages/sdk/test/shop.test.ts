// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shop purchases drive the REAL SDK over a fake transport: the composed transaction must name
// the exact Move door, split the exact payment, and pass the exact quantity — a wrong target,
// amount, or argument would have stayed green under the old collaborator fakes.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { PERSONAL_KIOSK_RULE_ADDRESS, type KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type Receipt, type SuiTransport } from '../src/client.ts'
import { buy_shop_item, claim_airdrop } from '../src/shop.ts'
import { airdrop_id, item_template_id, sale_id } from '../src/seed_ids.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const package_id = id(1)
const registry_id = id(2)
const kiosk_package_id = id(7)
const pins = {
  package: package_id,
  kiosk_package: kiosk_package_id,
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

const pure_u64s = (tx: Transaction): readonly bigint[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 8) return []
    let value = 0n
    for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!)
    return [value]
  })

const pure_u32s = (tx: Transaction): readonly number[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 4) return []
    return [bytes.reduceRight((value, byte) => value * 256 + byte, 0)]
  })

describe('shop SDK actions', () => {
  test('reusable personal kiosks are queried from the OFFICIAL personal-kiosk package (never the game rules pin)', async () => {
    // 2026-08-21: querying by the game pin was blind to every real cap — wrappers are minted
    // by Mysten's network-default personal_kiosk package, the one the SDK ships
    const { client, sdk } = game()
    await sdk.get_owned_kiosks(id(99))
    expect(client.owned_types).toContain(`${PERSONAL_KIOSK_RULE_ADDRESS.testnet}::personal_kiosk::PersonalKioskCap`)
    expect(client.owned_types).not.toContain(`${kiosk_package_id}::personal_kiosk::PersonalKioskCap`)
  })

  test('buy composes the real api::buy door with the exact split payment and quantity', async () => {
    const { client, sdk } = game()
    // capture the composed transaction at the executor door
    let composed: Transaction | null = null
    const original_execute = sdk.execute_personal_kiosk
    const capturing_sdk = {
      ...sdk,
      execute_personal_kiosk: async (tx: Transaction, cap: KioskOwnerCap | null) => {
        composed = tx
        return original_execute(tx, cap)
      },
    }

    const result = await buy_shop_item(capturing_sdk as never, kiosk_cap, {
      item_type: 'pet_lootbox',
      category: 'consumable',
      price_mist: 25_000_000_000n,
      quantity: 3,
      existing_item_id: null,
    })
    expect(result).toEqual({ digest, kiosk_cap })

    // the derived sale + template ids were hydrated (and only those two)
    expect(client.hydrations[0]).toEqual([
      sale_id(registry_id, package_id, 'pet_lootbox'),
      item_template_id(registry_id, 'pet_lootbox'),
    ])
    // the composed transaction names the REAL door on the REAL package
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::buy`)
    // calls target the game's rules-lineage pin (v3) — the lineage-split law (client.ts)
    expect(move_call_targets(composed!)).toContain(`${kiosk_package_id}::personal_kiosk::borrow_val`)
    expect(move_call_targets(composed!)).toContain(`${kiosk_package_id}::personal_kiosk::return_val`)
    // the payment split is price × quantity, present as a pure u64 input
    expect(pure_u64s(composed!)).toContain(75_000_000_000n)
  })

  test('buys multiple non-stackable cosmetics through distinct calls in one PTB', async () => {
    const { client, sdk } = game()
    let composed: Transaction | null = null
    const original_execute = sdk.execute_personal_kiosk
    const capturing_sdk = {
      ...sdk,
      execute_personal_kiosk: async (tx: Transaction, cap: KioskOwnerCap | null) => {
        composed = tx
        return original_execute(tx, cap)
      },
    }

    const result = await buy_shop_item(capturing_sdk as never, kiosk_cap, {
      item_type: 'berserk',
      category: 'hat',
      price_mist: 220_000_000_000n,
      quantity: 3,
    })

    expect(result).toEqual({ digest, kiosk_cap })
    expect(client.hydrations).toHaveLength(1)
    expect(move_call_targets(composed!).filter((target) => target === `${package_id}::api::buy`)).toHaveLength(3)
    expect(pure_u32s(composed!).filter((quantity) => quantity === 1)).toHaveLength(1)
    expect(pure_u64s(composed!).filter((payment) => payment === 220_000_000_000n)).toHaveLength(3)
  })

  test('refuses a non-stackable quantity that would overfill one PTB', async () => {
    const { client, sdk } = game()

    expect(
      buy_shop_item(sdk, kiosk_cap, {
        item_type: 'berserk',
        category: 'hat',
        price_mist: 220_000_000_000n,
        quantity: 401,
      })
    ).rejects.toThrow('at most 400')
    expect(client.hydrations).toEqual([])
  })

  test('the maximum non-stackable quantity stays below the conservative command budget', async () => {
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

    await buy_shop_item(capturing_sdk as never, kiosk_cap, {
      item_type: 'berserk',
      category: 'hat',
      price_mist: 220_000_000_000n,
      quantity: 400,
    })

    expect(composed!.getData().commands.length).toBeLessThan(1_000)
  })

  test('claim composes the real api::claim_airdrop door over the derived drop id', async () => {
    const { client, sdk } = game()
    let composed: Transaction | null = null
    const original_execute = sdk.execute_personal_kiosk
    const capturing_sdk = {
      ...sdk,
      execute_personal_kiosk: async (tx: Transaction, cap: KioskOwnerCap | null) => {
        composed = tx
        return original_execute(tx, cap)
      },
    }

    const result = await claim_airdrop(capturing_sdk as never, kiosk_cap, {
      drop_id: 'founders',
      item_type: 'title_veteran',
      category: 'title',
      existing_item_id: id(9),
    })
    expect(result).toEqual({ digest, kiosk_cap })
    expect(client.hydrations[0]).toEqual([
      airdrop_id(registry_id, package_id, 'founders'),
      item_template_id(registry_id, 'title_veteran'),
    ])
    expect(move_call_targets(composed!)).toContain(`${package_id}::api::claim_airdrop`)
  })
})
