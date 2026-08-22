// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The p2p escrow builder — money code that until now had no tests. Two layers:
//   • the LOCAL projections (the next rendered row, derived exactly as the contract derives it):
//     escrow arithmetic, the version bump + accept reset, the accept version pinning, drain
//   • the COMPOSED transactions: the real doors on the real package with the exact amounts

import { describe, expect, test } from 'bun:test'
import type { TradeRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'
import { trade_actions, trade_is_drained } from '../src/trade.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const package_id = id(1)
const me = id(7)
const other = id(8)

const trade_row = (overrides: Partial<TradeRow> = {}): TradeRow => ({
  id: id(20),
  a: me,
  b: other,
  version: 4,
  accept_a: false,
  accept_b: false,
  locked: false,
  sui_a: '1000',
  sui_b: '0',
  caps_a: [],
  caps_b: [],
  ...overrides,
})

const resolve_inputs: TransactionPlugin = async (transaction_data, options, next) => {
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

const fake_client = () => ({
  core: {
    resolveTransactionPlugin: () => resolve_inputs,
    getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
      objects: objectIds.map((object_id) => ({
        objectId: object_id,
        version: '1',
        digest,
        owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
      })),
    }),
    simulateTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
    executeTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
  },
})

const kiosk_cap = { objectId: id(3), kioskId: id(4), isPersonal: true } as KioskOwnerCap
const load_kiosk_cap = async () => kiosk_cap

const pins = {
  package: package_id,
  package_original: id(13),
  kiosk_package: id(9),
  version: { id: id(6), shared_version: '1' },
  item_policy: { id: id(10), shared_version: '1' },
  character_policy: { id: id(11), shared_version: '1' },
  item_protected_policy: { id: id(12), shared_version: '1' },
}

const game = () => {
  const sdk = SDK({ client: fake_client() as unknown as SuiTransport, signer: new Ed25519Keypair(), pins })
  // the Trade is a SHARED object the cache learned from its create receipt — feed it the same way
  absorb_receipt(sdk.cache, {
    effects: {
      changedObjects: [
        {
          objectId: id(20),
          idOperation: 'Created',
          outputState: 'ObjectWrite',
          outputVersion: '1',
          outputDigest: digest,
          outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        },
      ],
    },
  })
  let composed: Transaction | null = null
  const original_execute = sdk.execute
  const capturing = {
    ...sdk,
    execute: async (tx: Transaction) => {
      composed = tx
      return original_execute(tx)
    },
  }
  return { sdk: capturing, tx: () => composed! }
}

const targets = (tx: Transaction): readonly string[] =>
  tx
    .getData()
    .commands.filter((command) => command.MoveCall)
    .map((command) => {
      const { package: pkg, module, function: fn } = command.MoveCall!
      return `${pkg}::${module}::${fn}`
    })

const type_arguments = (tx: Transaction): readonly string[] =>
  tx.getData().commands.flatMap((command) => command.MoveCall?.typeArguments ?? [])

const pure_u64s = (tx: Transaction): readonly bigint[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 8) return []
    return [bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(8 * index)), 0n)]
  })

describe('escrow projections (the contract math, restated locally)', () => {
  test('every mutation bumps the version and clears both accepts', async () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ accept_a: true, accept_b: true }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const { trade } = await actions.deposit_sui(250n)
    expect(trade.version).toBe(5)
    expect(trade.accept_a).toBeFalse()
    expect(trade.accept_b).toBeFalse()
    expect(trade.sui_a).toBe('1250')
  })

  test('a withdrawal below the rendered escrow refuses before any transaction', async () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    await expect(actions.withdraw_sui(2000n)).rejects.toThrow('lower than that withdrawal')
    await expect(actions.deposit_sui(0n)).rejects.toThrow('positive')
  })

  test('the counterparty side updates side B, never side A', async () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: other, kiosk_cap: load_kiosk_cap })
    const { trade } = await actions.deposit_sui(9n)
    expect(trade.sui_b).toBe('9')
    expect(trade.sui_a).toBe('1000')
  })

  test('a stranger to the trade is refused', () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: id(9), kiosk_cap: load_kiosk_cap })
    expect(actions.deposit_sui(1n)).rejects.toThrow('not a party')
  })

  test('accept locks only when both sides accepted, and never bumps the version', async () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ accept_b: true }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const { trade } = await actions.accept()
    expect(trade.version).toBe(4)
    expect(trade.accept_a).toBeTrue()
    expect(trade.locked).toBeTrue()
  })

  test('claim zeroes the COUNTERPARTY escrow; drained needs both sides empty', async () => {
    const { sdk } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ locked: true, sui_b: '77' }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const { trade } = await actions.claim_sui()
    expect(trade.sui_b).toBe('0')
    expect(trade.sui_a).toBe('1000')
    expect(trade_is_drained(trade)).toBeFalse()
    expect(trade_is_drained(trade_row({ sui_a: '0', sui_b: '0' }))).toBeTrue()
  })
})

describe('escrow composition (the real doors)', () => {
  test('deposit_sui names the real door and splits the exact amount', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    await actions.deposit_sui(250n)
    expect(targets(tx())).toContain(`${package_id}::api::trade_deposit_sui`)
    expect(pure_u64s(tx())).toContain(250n)
  })

  test('accept pins the EXACT version this instance rendered', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ version: 4 }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    await actions.accept()
    expect(targets(tx())).toContain(`${package_id}::api::trade_accept`)
    // a stale UI accepting version 4 while the chain moved on must abort on-chain — the pin
    expect(pure_u64s(tx())).toContain(4n)
  })

  test('an item deposit lists through the kiosk purchase-cap door before parking the cap', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    await actions.deposit_item({ id: id(30), name: 'hat', item_type: 'straw_hat', category: 'hat' } as never)
    expect(targets(tx())).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::kiosk::list_with_purchase_cap'
    )
    expect(type_arguments(tx())).toContain(`${id(13)}::item::Item`)
    expect(type_arguments(tx())).not.toContain(`${package_id}::item::Item`)
    expect(targets(tx())).toContain(`${package_id}::api::trade_deposit_item_cap`)
  })

  test('a locked exchange item claims, resolves its policy, and merges into the existing stack', async () => {
    const offered = {
      object: id(30),
      kind: 'item' as const,
      name: 'Wool',
      item_type: 'wool',
      category: 'resource',
      kiosk: id(31),
    }
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ locked: true, caps_b: [offered] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const { trade } = await actions.claim_cap(offered, { id: id(32), kiosk: id(4) })
    expect(trade.caps_b).toEqual([])
    expect(targets(tx())).toContain(`${package_id}::api::trade_claim_item_cap`)
    expect(targets(tx())).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::kiosk::purchase_with_cap'
    )
    expect(targets(tx())).toContain(`${id(9)}::royalty_rule::pay`)
    expect(targets(tx())).toContain(`${package_id}::api::merge_stacks`)
  })
})
