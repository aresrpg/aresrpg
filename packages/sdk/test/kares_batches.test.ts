// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { Transaction } from '@mysten/sui/transactions'

import type { Sdk } from '../src/client.ts'
import { create_kares_transaction, kares_actions } from '../src/kares_actions.ts'
import { KARES_BATCH_SIZE, plan_kares_batches } from '../src/kares_batches.ts'
import { plan_staking_withdrawal, staking_withdrawal_limit } from '../src/kares_staking.ts'

const id = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: id(index + 100000), amount: 1n }))
const context = () => {
  const hydrated: string[][] = []
  const sdk = {
    pins: {
      kares_package: id(10001),
      kares_package_original: id(10000),
      kares_currency: { id: id(10002), shared_version: '2' },
      kares_offering: { id: id(10003), shared_version: '3' },
      kares_staking_pool: { id: id(10004), shared_version: '3' },
      kares_combat_pot: { id: id(10005), shared_version: '3' },
    },
    hydrate_unknown: async (ids: readonly string[]) => {
      hydrated.push([...ids])
    },
    door_context: {
      obj: (tx: Transaction, object_id: string) => tx.objectRef({ objectId: object_id, version: '1', digest }),
    },
  } as unknown as Sdk
  return { sdk, address: id(99999), hydrated }
}

test('finance plans preserve every position and stable identity order around PTB boundaries', () => {
  for (const count of [0, 1, 49, 50, 51, 255, 256, 512, 1023]) {
    const positions = rows(count).toReversed()
    const original = [...positions]
    const batches = plan_kares_batches(positions)
    expect(batches.flat()).toEqual(rows(count))
    expect(batches.every((batch) => batch.length > 0 && batch.length <= KARES_BATCH_SIZE)).toBe(true)
    expect(batches.length).toBe(Math.ceil(count / KARES_BATCH_SIZE))
    expect(positions).toEqual(original)
  }
})

test('real claim builders reject oversized batches before reads and bound every generated PTB', async () => {
  for (const source of ['offering', 'staking'] as const) {
    for (const count of [51, 256, 1023]) {
      const ctx = context()
      await expect(
        create_kares_transaction(ctx, { kind: 'claim', source, ids: rows(count).map(({ id }) => id) })
      ).rejects.toThrow('batch')
      expect(ctx.hydrated).toEqual([])
    }
    for (const batch of plan_kares_batches(rows(256))) {
      const tx = await create_kares_transaction(context(), { kind: 'claim', source, ids: batch.map(({ id }) => id) })
      const { commands } = tx.getData()
      expect(commands.length).toBe(batch.length + 1)
      expect(commands.at(-1)?.TransferObjects?.objects.length).toBe(2 * batch.length)
      expect(commands.length).toBeLessThan(1024)
      expect(commands.at(-1)!.TransferObjects!.objects.length).toBeLessThan(512)
      // Real pinned SDK serialization, with synthetic owned refs: shape/size, not live gas certification.
      const bytes = await tx.build({ onlyTransactionKind: true })
      expect(bytes.length).toBeLessThan(16_384)
    }
  }
})

test('withdrawal batches retain the exact requested amount instead of silently truncating it', async () => {
  const positions = rows(512)
  const plan = plan_staking_withdrawal(positions, 511n)
  const batches = plan_kares_batches(plan)
  expect(batches.flat().reduce((sum, row) => sum + row.amount, 0n)).toBe(511n)
  expect(new Set(batches.flat().map(({ id }) => id)).size).toBe(511)
  for (const batch of batches) {
    const tx = await create_kares_transaction(context(), { kind: 'withdraw', withdrawals: batch })
    expect(tx.getData().commands.at(-1)?.TransferObjects?.objects.length).toBe(batch.length)
  }
  const ctx = context()
  await expect(create_kares_transaction(ctx, { kind: 'withdraw', withdrawals: plan })).rejects.toThrow('batch')
  expect(ctx.hydrated).toEqual([])
})

test('finance actions request the existing resolver estimate and execute only their reviewed batch', async () => {
  const ctx = context()
  const calls: unknown[] = []
  const sdk = {
    ...ctx.sdk,
    network: 'mainnet',
    execute: async (tx: Transaction, options: unknown) => {
      calls.push({ commands: tx.getData().commands.length, options })
      return {
        $kind: 'Transaction',
        Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, objectTypes: {} },
      }
    },
  } as unknown as Sdk
  const api = kares_actions({ sdk, address: ctx.address, client: {} as never })
  const [batch] = plan_kares_batches(rows(256))
  await api.claim_rewards(batch.map(({ id }) => id))
  await api.withdraw(rows(2), 2n)
  await api.contribute(1n)
  expect(calls).toEqual([
    { commands: 51, options: { include: { objectTypes: true }, budget: 'estimate' } },
    { commands: 3, options: { include: { objectTypes: true }, budget: 'estimate' } },
    { commands: 2, options: { include: { objectTypes: true }, budget: undefined } },
  ])
})

test('fragmented withdrawal limits require an explicitly smaller request, never silently reduce one', async () => {
  const positions = rows(200).map((row) => ({ ...row, amount: 1_000_000_000n }))
  const amount = 100_000_000_000n
  expect(staking_withdrawal_limit(positions)).toBe(50_000_000_000n)
  const plan = plan_staking_withdrawal(positions, amount)
  expect(plan.reduce((sum, row) => sum + row.amount, 0n)).toBe(amount)
  await expect(create_kares_transaction(context(), { kind: 'withdraw', withdrawals: plan })).rejects.toThrow('batch')
  const remaining = positions.slice(50)
  expect(staking_withdrawal_limit(remaining)).toBe(50_000_000_000n)
  expect(remaining.reduce((sum, row) => sum + row.amount, 0n)).toBe(150_000_000_000n)
  expect(staking_withdrawal_limit([])).toBe(0n)
  expect(staking_withdrawal_limit([{ id: id(1), amount: 70n }, ...rows(100)])).toBe(119n)
})
