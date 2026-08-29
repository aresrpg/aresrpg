// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { absorb_receipt, type Receipt } from '../src/cache.ts'
import { SDK, type SuiTransport } from '../src/client.ts'
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
  phase: 'negotiating',
  offer_revision: 4,
  accept_a: false,
  accept_b: false,
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

const kiosk_cap = (kiosk = id(4)): KioskOwnerCap =>
  ({ objectId: id(Number(BigInt(kiosk) % 100n) + 200), kioskId: kiosk, isPersonal: true }) as KioskOwnerCap
const load_kiosk_cap = async (kiosk?: string) => kiosk_cap(kiosk)

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

const pure_u64s = (tx: Transaction): readonly bigint[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 8) return []
    return [bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(8 * index)), 0n)]
  })

const item_cap = (object: number, item_type = 'wool', kiosk = 31): TradeCapRow => ({
  object: id(object),
  name: item_type,
  level: 1,
  amount: 10,
  item_type,
  category: 'resource',
  kiosk: id(kiosk),
})

describe('revision-pinned offer projections', () => {
  test('join advances the request into negotiation', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ phase: 'requested', offer_revision: 0 }),
      address: other,
      kiosk_cap: load_kiosk_cap,
    })
    const receipt = await actions.join()
    expect(receipt.trade).toMatchObject({ phase: 'negotiating', offer_revision: 1 })
    expect(targets(tx())).toContain(`${package_id}::trade::join`)
    expect(pure_u64s(tx())).toContain(0n)
  })

  test('setting the total SUI sends only the delta and projects the exact new offer', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    const receipt = await actions.set_sui(1250n)
    expect(receipt.trade).toMatchObject({ sui_a: '1250', offer_revision: 5, accept_a: false, accept_b: false })
    expect(targets(tx())).toContain(`${package_id}::trade::put_sui`)
    expect(pure_u64s(tx())).toEqual(expect.arrayContaining([250n, 4n]))
  })

  test('a deposited item projects one cap and pins the rendered revision', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    const receipt = await actions.deposit_item({
      id: id(30),
      name: 'Wool',
      level: 1,
      amount: 10,
      item_type: 'wool',
      category: 'resource',
      kiosk: id(31),
    } as never)
    expect(receipt.trade.caps_a.map(({ object }) => object)).toEqual([id(30)])
    expect(receipt.trade.offer_revision).toBe(5)
    expect(pure_u64s(tx())).toContain(4n)
  })

  test('one offer commit withdraws, splits, adds, and changes SUI through sequential revisions', async () => {
    const offered = item_cap(30, 'old', 31)
    const item = {
      id: id(40),
      name: 'Wool',
      level: 1,
      amount: 10,
      item_type: 'wool',
      category: 'resource',
      kiosk: id(31),
    }
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ caps_a: [offered] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const receipt = await actions.commit_offer({
      additions: [{ item, amount: 4 }],
      removals: [{ cap: offered }],
      sui: 1250n,
    })

    expect(receipt.offer_revision).toBe(7)
    expect(targets(tx())).toEqual(
      expect.arrayContaining([
        `${package_id}::api::trade_take_i`,
        `${package_id}::api::split_stack`,
        `${package_id}::api::trade_put_i`,
        `${package_id}::trade::put_sui`,
      ])
    )
    expect(targets(tx()).some((target) => target.endsWith('::kiosk::list_with_purchase_cap'))).toBeTrue()
    const { commands } = tx().getData()
    const split_index = commands.findIndex((command) => command.MoveCall?.function === 'split_stack')
    const listing = commands.find((command) => command.MoveCall?.function === 'list_with_purchase_cap')
    expect(listing?.MoveCall?.arguments[2]).toEqual({ Result: split_index, $kind: 'Result' })
    expect(pure_u64s(tx())).toEqual(expect.arrayContaining([4n, 5n, 6n, 250n]))
  })

  test('a removed offer stack merges into its existing inventory stack in the same PTB', async () => {
    const offered = item_cap(30, 'wool', 31)
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ caps_a: [offered] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const receipt = await actions.commit_offer({
      additions: [],
      removals: [{ cap: offered, target: { id: id(40), kiosk: id(31), amount: 5 } }],
      sui: 1000n,
    })

    expect(receipt.offer_revision).toBe(5)
    const calls = targets(tx())
    const take = calls.indexOf(`${package_id}::api::trade_take_i`)
    const returned = calls.findIndex((target) => target.endsWith('::kiosk::return_purchase_cap'))
    const merged = calls.indexOf(`${package_id}::api::merge_stacks`)
    expect(take).toBeGreaterThanOrEqual(0)
    expect(returned).toBeGreaterThan(take)
    expect(merged).toBeGreaterThan(returned)
  })

  test('later removals cannot turn an earlier staged amount into a whole-stack listing', async () => {
    const first = item_cap(30, 'wool', 31)
    const second = item_cap(32, 'wool', 31)
    const target = {
      id: id(40),
      name: 'Wool',
      level: 1,
      amount: 15,
      item_type: 'wool',
      category: 'resource',
      kiosk: id(31),
    }
    const merge_target = { id: target.id, kiosk: target.kiosk, amount: 5 }
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ caps_a: [first, second] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    await actions.commit_offer({
      additions: [{ item: target, amount: 15 }],
      removals: [
        { cap: first, target: merge_target },
        { cap: second, target: merge_target },
      ],
      sui: 1000n,
    })

    const { commands } = tx().getData()
    const split_index = commands.findIndex((command) => command.MoveCall?.function === 'split_stack')
    const listing = commands.find((command) => command.MoveCall?.function === 'list_with_purchase_cap')
    expect(split_index).toBeGreaterThanOrEqual(0)
    expect(listing?.MoveCall?.arguments[2]).toEqual({ Result: split_index, $kind: 'Result' })
  })

  test('offer validation rejects duplicate removals and cumulative merge overflow', async () => {
    const first = item_cap(30, 'wool', 31)
    const second = item_cap(32, 'wool', 31)
    const actions = trade_actions(game().sdk as never, {
      trade: trade_row({ caps_a: [first, second] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    await expect(
      actions.commit_offer({ additions: [], removals: [{ cap: first }, { cap: first }], sui: 1000n })
    ).rejects.toThrow('removed twice')
    const target = { id: id(40), kiosk: id(31), amount: 0xffff_ffff - 15 }
    await expect(
      actions.commit_offer({
        additions: [],
        removals: [
          { cap: first, target },
          { cap: second, target },
        ],
        sui: 1000n,
      })
    ).rejects.toThrow('cannot absorb')
  })

  test('accept pins the rendered offer revision', async () => {
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, { trade: trade_row(), address: me, kiosk_cap: load_kiosk_cap })
    await actions.accept()
    expect(targets(tx())).toContain(`${package_id}::trade::accept`)
    expect(pure_u64s(tx())).toContain(4n)
  })
})

describe('terminal shrinking transactions', () => {
  test('mixed settlement claims caps and SUI once without transferring GasCoin', async () => {
    const wool = item_cap(30, 'wool', 31)
    const wool_dust = item_cap(34, 'wool', 33)
    const ore = item_cap(32, 'ore', 32)
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ phase: 'settling', offer_revision: 5, sui_b: '500', caps_b: [wool, ore, wool_dust] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const receipt = await actions.settle_all({ [ore.object]: { id: id(41), kiosk: id(5) } })
    expect(receipt.delta).toEqual({
      trade: id(20),
      phase: 'settling',
      offer_revision: 5,
      remove_caps: [id(30), id(32), id(34)],
      clear_sui: 'b',
      closed: false,
    })
    expect(targets(tx()).filter((target) => target === `${package_id}::api::trade_get_i`)).toHaveLength(3)
    expect(targets(tx()).filter((target) => target === `${package_id}::api::merge_stacks`)).toHaveLength(2)
    expect(targets(tx())).toContain(`${package_id}::trade::claim_sui`)
    const transfers = tx()
      .getData()
      .commands.filter((command) => command.TransferObjects)
    expect(JSON.stringify(transfers)).not.toContain('GasCoin')
  })

  test('incoming stacks coalesce cumulatively without crossing the u32 amount cap', async () => {
    const huge = { ...item_cap(30), amount: 4_294_967_293 }
    const dust_a = { ...item_cap(31), amount: 2 }
    const dust_b = { ...item_cap(32), amount: 2 }
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ phase: 'settling', caps_b: [dust_b, huge, dust_a] }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    await actions.settle_all({})
    expect(targets(tx()).filter((target) => target === `${package_id}::api::merge_stacks`)).toHaveLength(1)
  })

  test('cancelling recovers the callers whole offer and leaves the counterparty recovery durable', async () => {
    const own_cap = item_cap(30)
    const other_cap = item_cap(31)
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ caps_a: [own_cap], caps_b: [other_cap], sui_a: '500' }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    const receipt = await actions.cancel_and_recover()
    expect(receipt.delta).toMatchObject({
      phase: 'cancelled',
      offer_revision: 5,
      remove_caps: [id(30)],
      clear_sui: 'a',
      closed: false,
    })
    expect(targets(tx())).toEqual(
      expect.arrayContaining([
        `${package_id}::trade::cancel`,
        `${package_id}::api::trade_recover_i`,
        `${package_id}::trade::recover_sui`,
      ])
    )
  })

  test('the maximum manifest remains one composed transaction', async () => {
    const offered = Array.from({ length: 20 }, (_, index) => item_cap(100 + index))
    const { sdk, tx } = game()
    const actions = trade_actions(sdk as never, {
      trade: trade_row({ phase: 'settling', caps_b: offered }),
      address: me,
      kiosk_cap: load_kiosk_cap,
    })
    await actions.settle_all({})
    expect(targets(tx()).filter((target) => target === `${package_id}::api::trade_get_i`)).toHaveLength(20)
    expect(targets(tx()).filter((target) => target === `${package_id}::api::merge_stacks`)).toHaveLength(19)
    expect((await tx().build({ onlyTransactionKind: true })).length).toBeLessThan(128 * 1024)
  })

  test('drained derives from the authoritative row', () => {
    expect(trade_is_drained(trade_row())).toBeFalse()
    expect(trade_is_drained(trade_row({ sui_a: '0' }))).toBeTrue()
  })
})
