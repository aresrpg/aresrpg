// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { SDK } from '../src/client.ts'
import { mastery_actions } from '../src/mastery.ts'
import {
  KARES_UNIT,
  MASTERY_PURCHASE_LIMIT,
  mastery_purchase_maximum,
  valid_mastery_purchase_quantity,
} from '../src/kares_economics.ts'

import { fake_client, id, signer } from './helpers/transport.ts'
import { kares_test_pins } from './helpers/kares.ts'

const fixture = () => {
  const base = SDK({
    client: fake_client({ simulate_ok: true }),
    signer,
    transaction_storage: null,
    pins: {
      ...kares_test_pins,
      package: id(20),
      package_original: id(21),
      seed_package_original: id(22),
      content_root: { id: id(23), shared_version: '1' },
      version: { id: id(24), shared_version: '1' },
      item_policy: { id: id(25), shared_version: '1' },
    },
  })
  const submitted: { transaction: ReturnType<Transaction['getData']>; budget: unknown }[] = []
  const sdk = {
    ...base,
    with_owner_kiosk: (tx: Transaction, _cap: unknown, compose: (tx: unknown, cap: unknown) => void) =>
      compose(tx.object(id(26)), tx.object(id(27))),
    execute: async (tx: Transaction, options: { budget?: unknown }) => {
      submitted.push({ transaction: tx.getData(), budget: options.budget })
      return { Transaction: { digest: 'one-certified-batch' } }
    },
  }
  const actions = mastery_actions(sdk as never, { address: signer.toSuiAddress(), kiosk_cap: async () => null })
  return { actions, submitted }
}

test('quantity bounds use exact token units and reject invalid amounts', () => {
  expect(mastery_purchase_maximum(3_999n * KARES_UNIT, 2n)).toBe(1)
  expect(mastery_purchase_maximum(4_000n * KARES_UNIT, 2n)).toBe(2)
  expect(mastery_purchase_maximum(10_000_000n * KARES_UNIT, 2n)).toBe(MASTERY_PURCHASE_LIMIT)
  expect(mastery_purchase_maximum(5n, 0n)).toBe(0)
  for (const count of [0, -1, 1.5, NaN, Infinity, MASTERY_PURCHASE_LIMIT + 1])
    expect(valid_mastery_purchase_quantity(count)).toBe(false)
})

test('multiple KARES redemptions share one transaction and each pays the exact authored price', async () => {
  const { actions, submitted } = fixture()
  const result = await actions.redeem({
    item_type: 'resource_crate',
    existing: id(28),
    payment: 'kares',
    expected_cost: 2n,
    count: 3,
  })
  expect(result.digest).toBe('one-certified-batch')
  expect(result.mastery).toBeNull()
  expect(submitted).toHaveLength(1)
  expect(submitted[0].budget).toBe('estimate')
  const calls = submitted[0].transaction.commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))
  expect(calls).toHaveLength(3)
  expect(
    calls.every(
      (call) =>
        call.function === 'redeem_mastery_offer_token' && call.typeArguments[0] === kares_test_pins.kares_coin_type
    )
  ).toBe(true)
  const payments = submitted[0].transaction.commands.flatMap((command) =>
    command.$Intent ? [command.$Intent.data.balance] : []
  )
  expect(payments.map(String)).toEqual(['2000000000000', '2000000000000', '2000000000000'])
})

test('invalid batch counts and batched point payments cannot submit', async () => {
  const { actions, submitted } = fixture()
  for (const count of [0, 1.5, MASTERY_PURCHASE_LIMIT + 1])
    await expect(
      actions.redeem({ item_type: 'resource_crate', existing: null, payment: 'kares', expected_cost: 2n, count })
    ).rejects.toThrow('quantity')
  await expect(
    actions.redeem({ item_type: 'resource_crate', existing: null, payment: 'mastery', count: 2 })
  ).rejects.toThrow('one item')
  expect(submitted).toHaveLength(0)
})
