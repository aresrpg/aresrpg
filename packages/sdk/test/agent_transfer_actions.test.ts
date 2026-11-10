// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { agent_transfer_actions } from '../src/agent_transfer_actions.ts'
import { SDK } from '../src/client.ts'
import { pre_submission_failure } from '../src/transaction_error.ts'

import { digest, fake_client, pins } from './helpers/transport.ts'

const id = `0x${'1'.repeat(64)}`
const intent = { kind: 'cancel' as const, seller_kiosk: id, purchase_cap: `0x${'2'.repeat(64)}` }
const fixture = (success = true, ambiguous = false, check_return?: () => Promise<void>) => {
  let executions = 0
  let valid = success
  const sdk = {
    network: 'mainnet',
    game_type_package: id,
    tx: () => new Transaction(),
    simulate: async () => ({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: { success: valid },
          gasUsed: { computationCost: '10', storageCost: '5', storageRebate: '2' },
        },
      },
    }),
    execute: async () => {
      executions += 1
      if (ambiguous) throw new Error('Submission outcome unknown')
      return { $kind: 'Transaction', Transaction: { digest: 'confirmed-digest' } }
    },
  }
  return {
    actions: agent_transfer_actions(sdk as never, { address: id, kiosk_cap: async () => null, check_return }),
    executions: () => executions,
    invalidate: () => {
      valid = false
    },
  }
}

test('failed simulation never produces a confirmation or submits', async () => {
  const f = fixture(false)
  await expect(f.actions.prepare(intent)).rejects.toThrow('simulation failed')
  expect(f.executions()).toBe(0)
})
test('review is immutable, has gas evidence, and confirms once with a receipt', async () => {
  const f = fixture()
  const review = await f.actions.prepare(intent)
  expect(f.executions()).toBe(0)
  expect(review.gas_mist).toBe('13')
  expect(Object.isFrozen(review.intent)).toBe(true)
  expect((await review.confirm()).digest).toBe('confirmed-digest')
  await expect(review.confirm()).rejects.toThrow('already submitted')
  expect(f.executions()).toBe(1)
})
test('uncertain submission cannot be repeated through the same review', async () => {
  const f = fixture(true, true)
  const review = await f.actions.prepare(intent)
  const error = await review.confirm().catch((error: unknown) => error)
  expect(String(error)).toContain('outcome unknown')
  expect(pre_submission_failure(error)).toBeFalse()
  await expect(review.confirm()).rejects.toThrow('Reconcile')
  expect(f.executions()).toBe(1)
})

test('operation invalidated during confirm revalidation never reaches the signer or submission', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const client = fake_client({ simulate_ok: true })
  client.core.simulateTransaction = async () => ({
    $kind: 'Transaction',
    Transaction: {
      effects: {
        status: { success: true, error: null },
        gasUsed: { computationCost: '10', storageCost: '5', storageRebate: '2' },
      },
    },
  })
  let signatures = 0
  let current = true
  let reads = 0
  const sdk = SDK({
    address: id,
    client,
    pins,
    sign_transaction: async () => {
      signatures += 1
      return { bytes: new Uint8Array([1]), signature: 'wallet-signature' }
    },
  })
  const resolved = {
    ...sdk,
    tx: () => {
      const tx = sdk.tx()
      tx.sharedObjectRef({ objectId: intent.seller_kiosk, initialSharedVersion: '1', mutable: true })
      tx.objectRef({ objectId: intent.purchase_cap, version: '1', digest })
      return tx
    },
  }
  const actions = agent_transfer_actions(resolved, {
    address: id,
    kiosk_cap: async () => null,
    check_return: async () => {
      if (++reads === 2) {
        entered.resolve()
        await release.promise
      }
    },
  })
  const review = await actions.prepare(intent)
  const pending = review
    .confirm({
      before_sign: () => {
        if (!current) throw new Error('Operation retired')
      },
    })
    .catch((error: unknown) => error)
  await entered.promise
  current = false
  release.resolve()
  const error = await pending
  expect(pre_submission_failure(error)).toBeTrue()
  expect(String(error)).toContain('Operation retired')
  expect(signatures).toBe(0)
  expect(client.calls.executions).toBe(0)
  await expect(review.confirm()).rejects.toThrow('Reconcile')
})

test('state invalidated after review blocks signing and consumes confirmation', async () => {
  const f = fixture()
  const review = await f.actions.prepare(intent)
  f.invalidate()
  await expect(review.confirm()).rejects.toThrow('simulation failed')
  expect(f.executions()).toBe(0)
  await expect(review.confirm()).rejects.toThrow('Reconcile')
})

test('recall freezes equipment inputs and refuses changes before signing', async () => {
  let changed = false
  let executions = 0
  let hydrated: readonly string[] = []
  const sdk = {
    network: 'mainnet',
    game_type_package: id,
    tx: () => new Transaction(),
    hydrate: async (ids: readonly string[]) => {
      hydrated = ids
    },
    doors: { unequip_item: (tx: Transaction) => tx.moveCall({ target: `${id}::api::unequip_item` }) },
    with_personal_kiosk: (tx: Transaction, _cap: unknown, compose: (kiosk: unknown, cap: unknown) => void) =>
      compose(tx.object(id), tx.object(`0x${'2'.repeat(64)}`)),
    simulate: async () => ({
      Transaction: {
        effects: { status: { success: true }, gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0' } },
      },
    }),
    execute: async () => {
      executions += 1
      throw new Error('Must not execute')
    },
  }
  const actions = agent_transfer_actions(sdk as never, {
    address: id,
    kiosk_cap: async () => ({ kioskId: id, objectId: id, isPersonal: true, version: '1', digest: '' }),
    check_offer: async () => {
      if (changed) throw new Error('Equipment changed')
    },
  })
  const unequip = [{ slot: 'tool', item_id: `0x${'4'.repeat(64)}` }]
  const review = await actions.prepare({
    kind: 'offer',
    character_id: `0x${'3'.repeat(64)}`,
    kiosk: id,
    recipient: `0x${'5'.repeat(64)}`,
    unequip,
  })
  expect(hydrated).toEqual([unequip[0]!.item_id])
  unequip[0]!.slot = 'weapon'
  if (review.intent.kind !== 'offer') throw new Error('Wrong intent')
  expect(review.intent.unequip![0]!.slot).toBe('tool')
  changed = true
  await expect(review.confirm()).rejects.toThrow('Equipment changed')
  expect(executions).toBe(0)
})

test('receipt ownership is checked again before submission; a consumed gear cap blocks all signing', async () => {
  let reads = 0
  const f = fixture(true, false, async () => {
    if (++reads > 1) throw new Error('Return equipment capability is missing')
  })
  const review = await f.actions.prepare(intent)
  await expect(review.confirm()).rejects.toThrow('equipment capability is missing')
  expect(f.executions()).toBe(0)
  await expect(review.confirm()).rejects.toThrow('Reconcile')
  expect(reads).toBe(2)
})
