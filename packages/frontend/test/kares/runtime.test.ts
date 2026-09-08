// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { KaresSnapshotPending } from '@aresrpg/sdk/kares'

import { create_finance_runtime } from '../../src/kares/runtime.ts'

import { finance_session, finance_snapshot } from './fixture.ts'

test('a confirmed contribution retries a lagging ownership read without submitting again', async () => {
  let reads = 0
  let submissions = 0
  const snapshot = finance_snapshot()
  const session = finance_session()
  const runtime = create_finance_runtime(
    { network: 'testnet' },
    {
      ...session,
      kares: {
        ...session.kares,
        snapshot: async () => {
          reads += 1
          if (reads === 2) throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
          return { ...snapshot, kares_balance: 7n, sui_balance: 9n }
        },
        contribute: async () => {
          submissions += 1
          return { digest: 'certified-contribution', receipt: {} }
        },
      },
    }
  )
  const stop = runtime.start()
  try {
    await Bun.sleep(0)
    runtime.dispatch({ type: 'request', request: { kind: 'execute', action: { kind: 'contribute', amount: 1n } } })
    await Bun.sleep(400)
    expect(runtime.store.getState().digest).toBe('certified-contribution')
    expect(runtime.store.getState().error).toBeNull()
    expect(runtime.store.getState().snapshot).toEqual(snapshot)
    expect(submissions).toBe(1)
    expect(reads).toBe(3)
  } finally {
    stop()
  }
})

test('managed game staking refreshes positions without retaining a second balance', async () => {
  let position_reads = 0
  let balance_reads = 0
  const session = finance_session()
  const runtime = create_finance_runtime(
    { network: 'testnet', managed: true },
    {
      ...session,
      kares: {
        ...session.kares,
        staking_snapshot: async () => {
          position_reads += 1
          return finance_snapshot()
        },
        snapshot: async () => {
          balance_reads += 1
          return { ...finance_snapshot(), kares_balance: 7n, sui_balance: 9n }
        },
        stake: async () => ({ digest: 'stake-receipt', receipt: {} }),
      },
    }
  )
  const stop = runtime.start()
  try {
    await Bun.sleep(0)
    runtime.dispatch({ type: 'request', request: { kind: 'execute', action: { kind: 'stake', amount: 1n } } })
    await Bun.sleep(0)
    expect(position_reads).toBe(2)
    expect(balance_reads).toBe(0)
    expect(runtime.store.getState().balances).toBeNull()
    expect(runtime.store.getState().digest).toBe('stake-receipt')
  } finally {
    stop()
  }
})

test('stopping an old finance owner prevents delayed reads reaching a replacement', async () => {
  const deferred = Promise.withResolvers<ReturnType<typeof finance_snapshot>>()
  const session = finance_session()
  const old = create_finance_runtime(
    { network: 'testnet', managed: true },
    {
      ...session,
      kares: { ...session.kares, staking_snapshot: () => deferred.promise },
    }
  )
  const stop = old.start()
  stop()
  const replacement = create_finance_runtime(
    { network: 'testnet', managed: true },
    {
      ...session,
      kares: { ...session.kares, staking_snapshot: async () => ({ ...finance_snapshot(), address: '0xnew' }) },
    }
  )
  const stop_replacement = replacement.start()
  deferred.resolve(finance_snapshot())
  await Bun.sleep(0)
  expect(old.store.getState().snapshot).toBeNull()
  expect(replacement.store.getState().snapshot?.address).toBe('0xnew')
  stop_replacement()
})
