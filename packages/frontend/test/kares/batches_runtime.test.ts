// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { plan_kares_batches } from '@aresrpg/sdk/kares'

import { create_finance_runtime } from '../../src/kares/runtime.ts'

import { finance_session, finance_snapshot } from './fixture.ts'

const contributions = Array.from({ length: 101 }, (_, index) => ({
  id: `0x${index.toString(16).padStart(64, '0')}`,
  version: '1',
  amount: 1n,
}))

test('each reviewed batch needs a new click, refresh retains unsubmitted holdings, and a failure stops there', async () => {
  let remaining = [...contributions]
  const calls: string[][] = []
  const base = finance_session()
  const runtime = create_finance_runtime(
    { network: 'testnet' },
    {
      ...base,
      kares: {
        ...base.kares,
        snapshot: async () => ({
          ...finance_snapshot(),
          contributions: remaining,
          kares_balance: 0n,
          sui_balance: 10n,
        }),
        claim_offering: async (ids: readonly string[]) => {
          calls.push([...ids])
          if (calls.length === 2) throw new Error('transaction second-batch outcome is unknown')
          remaining = remaining.filter(({ id }) => !ids.includes(id))
          return { digest: 'first-batch', receipt: {} }
        },
      },
    }
  )
  const stop = runtime.start()
  try {
    await Bun.sleep(0)
    const request = (ids: readonly string[]) =>
      runtime.dispatch({
        type: 'request',
        request: { kind: 'execute', action: { kind: 'claim_offering', ids } },
      })
    const first = plan_kares_batches(contributions)[0].map(({ id }) => id)
    request(first)
    request(first)
    await Bun.sleep(0)
    expect(calls).toEqual([first])
    expect(runtime.store.getState().snapshot!.contributions).toHaveLength(51)
    expect(runtime.store.getState().snapshot!.contributions.some(({ id }) => first.includes(id))).toBe(false)
    const second = plan_kares_batches(remaining)[0].map(({ id }) => id)
    request(second)
    await Bun.sleep(0)
    expect(calls).toEqual([first, second])
    expect(runtime.store.getState().error).toContain('unknown')
    await Bun.sleep(0)
    expect(calls).toHaveLength(2)
    expect(remaining).toHaveLength(51)
  } finally {
    stop()
  }
})

test('account teardown during a batch never starts another batch or publishes the old receipt', async () => {
  const receipt = Promise.withResolvers<{ digest: string; receipt: {} }>()
  let submissions = 0
  const base = finance_session()
  const runtime = create_finance_runtime(
    { network: 'testnet' },
    {
      ...base,
      kares: {
        ...base.kares,
        snapshot: async () => ({ ...finance_snapshot(), contributions, kares_balance: 0n, sui_balance: 10n }),
        claim_offering: async () => {
          submissions += 1
          return receipt.promise
        },
      },
    }
  )
  const stop = runtime.start()
  await Bun.sleep(0)
  runtime.dispatch({
    type: 'request',
    request: {
      kind: 'execute',
      action: {
        kind: 'claim_offering',
        ids: plan_kares_batches(contributions)[0].map(({ id }) => id),
      },
    },
  })
  stop()
  receipt.resolve({ digest: 'old-wallet-batch', receipt: {} })
  await Bun.sleep(0)
  expect(submissions).toBe(1)
  expect(runtime.store.getState().digest).toBeNull()
})
