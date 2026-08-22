// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'

import type { Receipt } from '../src/cache.ts'
import { marketplace_actions } from '../src/marketplace.ts'
import { stack_actions } from '../src/stacks.ts'

const id = (number: number): string => `0x${String(number).padStart(64, '0')}`
const cap = { objectId: id(3), kioskId: id(4), isPersonal: true } as KioskOwnerCap

const harness = () => {
  let composed: Transaction | null = null
  const sdk = {
    game_type_package: id(1),
    pins: {
      package: id(2),
      kiosk_package: id(5),
      item_policy: { id: id(6) },
      character_policy: { id: id(7) },
      version: { id: id(8) },
    },
    tx: () => new Transaction(),
    doors: {},
    door_context: {
      pin: (tx: Transaction) => tx.object(id(8)),
    },
    with_owner_kiosk: (
      tx: Transaction,
      _cap: KioskOwnerCap,
      compose: (kiosk: ReturnType<Transaction['object']>, owner_cap: ReturnType<Transaction['object']>) => void
    ) => compose(tx.object(cap.kioskId), tx.object(cap.objectId)),
    execute: async (tx: Transaction): Promise<Receipt> => {
      composed = tx
      return {
        $kind: 'Transaction',
        Transaction: {
          digest: 'digest',
          effects: { changedObjects: [{ objectId: id(14), idOperation: 'Created' }] },
          objectTypes: { [id(14)]: `${id(1)}::item::Item` },
        },
      }
    },
  }
  return {
    actions: marketplace_actions(sdk as never, { address: id(9), kiosk_cap: async () => cap }),
    stacks: stack_actions(sdk as never, { kiosk_cap: async () => cap }),
    tx: () => composed!,
  }
}

const targets = (transaction: Transaction): readonly string[] =>
  transaction
    .getData()
    .commands.flatMap((command) =>
      command.MoveCall ? [`${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`] : []
    )

describe('marketplace SDK', () => {
  test('a large stack becomes one legal listed lot through the composition door', async () => {
    const { actions, tx } = harness()
    const receipt = await actions.list({
      kind: 'item',
      id: id(10),
      kiosk: id(4),
      price_mist: 1_000_000_000n,
      amount: 10,
      source_amount: 57,
      merge_sources: [id(16)],
    })
    const calls = targets(tx())
    expect(calls).toContain(`${id(2)}::api::split_stack`)
    expect(calls).toContain(`${id(2)}::kiosk::list`)
    expect(calls.indexOf(`${id(2)}::api::merge_stacks`)).toBeLessThan(calls.indexOf(`${id(2)}::api::split_stack`))
    expect(receipt.listed_id).toBe(id(14))
  })

  test('an item buy proves game rules before locking and confirms every policy witness', async () => {
    const { actions, tx } = harness()
    await actions.buy({
      kind: 'item',
      id: id(10),
      kiosk: id(11),
      price_mist: 1_000_000_000n,
      existing: id(15),
      destination_kiosk: id(4),
    })
    const calls = targets(tx())
    expect(calls).toContain(`${id(2)}::listing_rule::prove`)
    expect(calls).toContain(`${id(2)}::lot_rule::prove`)
    expect(calls).toContain(`${id(5)}::royalty_rule::pay`)
    expect(calls).toContain(`${id(5)}::kiosk_lock_rule::prove`)
    expect(calls).toContain(`${id(5)}::personal_kiosk_rule::prove`)
    expect(calls).toContain(`${id(2)}::api::merge_stacks`)
    expect(calls.indexOf(`${id(2)}::transfer_policy::confirm_request`)).toBeLessThan(
      calls.indexOf(`${id(2)}::api::merge_stacks`)
    )
    expect(calls.indexOf(`${id(2)}::lot_rule::prove`)).toBeLessThan(
      calls.findIndex((target) => target.endsWith('::kiosk::lock'))
    )
    expect(calls.at(-1)).toBe(`${id(2)}::api::merge_stacks`)
  })

  test('a character buy locks, borrows, proves naked, and returns it before confirmation', async () => {
    const { actions, tx } = harness()
    await actions.buy({ kind: 'character', id: id(12), kiosk: id(13), price_mist: 2_000_000_000n })
    const calls = targets(tx())
    expect(calls).toContain(`${id(2)}::kiosk::borrow_val`)
    expect(calls).toContain(`${id(2)}::naked_rule::prove`)
    expect(calls).toContain(`${id(2)}::kiosk::return_val`)
    expect(calls.indexOf(`${id(2)}::kiosk::borrow_val`)).toBeLessThan(calls.indexOf(`${id(2)}::naked_rule::prove`))
    expect(calls.at(-1)).toBe(`${id(2)}::transfer_policy::confirm_request`)
  })

  test('owned split stacks can merge through the generic custody door', async () => {
    const { stacks, tx } = harness()
    await stacks.merge({ kiosk: id(4), target_id: id(10), source_id: id(14) })
    expect(targets(tx())).toContain(`${id(2)}::api::merge_stacks`)
  })

  test('delisting a lot merges it back into the surviving stack in the same PTB', async () => {
    const { actions, tx } = harness()
    await actions.delist({ kind: 'item', id: id(14), kiosk: id(4), existing: id(10) })
    const calls = targets(tx())
    expect(calls.findIndex((target) => target.endsWith('::kiosk::delist'))).toBeLessThan(
      calls.indexOf(`${id(2)}::api::merge_stacks`)
    )
  })
})
