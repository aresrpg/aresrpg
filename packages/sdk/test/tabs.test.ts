// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One account's lane across browser tabs: one lock orders gas resolution, signing and submission;
// each tab keeps its own uncertain-submission record, so closing a tab still drops it.

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type SuiTransport } from '../src/client.ts'
import {
  browser_transaction_lock,
  browser_transaction_storage,
  type TransactionLock,
} from '../src/transaction_execution.ts'

import { fake_client, memory_storage, pins, signer } from './helpers/transport.ts'

const lane_key = (address: string, network = 'testnet') => `aresrpg:transaction:${network}:${address}`
const account_key = lane_key(signer.toSuiAddress())
const lock_manager = () => {
  const timeline: string[] = []
  const names: string[] = []
  const holders = new Map<string, string>()
  const tails = new Map<string, Promise<void>>()
  const tab =
    (label: string): TransactionLock =>
    (name, task) => {
      names.push(name)
      const run = (tails.get(name) ?? Promise.resolve()).then(async () => {
        holders.set(name, label)
        timeline.push(`${label}:acquire`)
        try {
          return await task()
        } finally {
          holders.delete(name)
          timeline.push(`${label}:release`)
        }
      })
      tails.set(
        name,
        run.then(
          () => undefined,
          () => undefined
        )
      )
      return run
    }
  return { timeline, names, tab, holder: (name: string) => holders.get(name) ?? null }
}
const tab_client = (
  label: string,
  timeline: string[],
  options: Readonly<{ gate?: Promise<void>; lost?: boolean }> = {}
) => {
  const client = fake_client({ execution_gate: options.gate })
  const entered = Promise.withResolvers<void>()
  const resolver = client.core.resolveTransactionPlugin()
  const traced: TransactionPlugin = async (data, build, next) => {
    timeline.push(`${label}:resolve`)
    await resolver(data, build, next)
  }
  const core = {
    ...client.core,
    resolveTransactionPlugin: () => traced,
    executeTransaction: async (input: { transaction: Uint8Array }) => {
      timeline.push(`${label}:execute`)
      entered.resolve()
      if (options.lost) throw new Error('response lost')
      return client.core.executeTransaction(input)
    },
  }
  return { calls: client.calls, entered: entered.promise, transport: { core } as unknown as SuiTransport }
}
const with_window = <T>(window: unknown, read: () => T): T => {
  Reflect.set(globalThis, 'window', window)
  try {
    return read()
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
}
const browser_tab = (
  label: string,
  locks: ReturnType<typeof lock_manager>,
  options: Readonly<{
    gate?: Promise<void>
    lost?: boolean
    wallet?: Ed25519Keypair
    network?: 'testnet' | 'mainnet'
  }> = {}
) => {
  const client = tab_client(label, locks.timeline, options)
  const session = memory_storage()
  const lock = locks.tab(label)
  const navigator = { locks: { request: (name: string, task: () => Promise<unknown>) => lock(name, task) } }
  const sdk = with_window({ navigator, localStorage: memory_storage(), sessionStorage: session }, () =>
    SDK({ client: client.transport, signer: options.wallet ?? signer, network: options.network ?? 'testnet', pins })
  )
  return { sdk, client, session }
}

test('two tabs of one account never overlap; the waiting tab resolves gas only after the first finished', async () => {
  const locks = lock_manager()
  const gate = Promise.withResolvers<void>()
  const a = browser_tab('A', locks, { gate: gate.promise })
  const b = browser_tab('B', locks)
  const idle = browser_tab('C', locks)
  const first = a.sdk.execute(a.sdk.tx())
  await a.client.entered
  const second = b.sdk.execute(b.sdk.tx())
  const other_account = browser_tab('D', locks, { wallet: new Ed25519Keypair() })
  const other_network = browser_tab('E', locks, { network: 'mainnet' })
  await Promise.all([
    other_account.sdk.execute(other_account.sdk.tx()),
    other_network.sdk.execute(other_network.sdk.tx()),
  ])
  expect([locks.holder(account_key), b.client.calls.resolutions]).toEqual(['A', 0])
  expect(a.session.values.get(account_key)).toContain('"phase":"submitted"')
  expect([a.sdk, b.sdk, idle.sdk].map((tab) => tab.is_transaction_idle())).toEqual([false, false, true])
  gate.resolve()
  await Promise.all([first, second])
  const own = locks.timeline.filter((event) => /^[AB]:/.test(event))
  expect(own).toEqual([
    'A:acquire',
    'A:resolve',
    'A:execute',
    'A:release',
    'B:acquire',
    'B:resolve',
    'B:execute',
    'B:release',
  ])
  expect([a.session.values.size, b.session.values.size]).toEqual([0, 0])
})

test('a tab’s uncertain submission blocks only that tab; a host without Web Locks keeps tab storage', async () => {
  const locks = lock_manager()
  const a = browser_tab('A', locks, { lost: true })
  const b = browser_tab('B', locks)
  await expect(a.sdk.execute(a.sdk.tx())).rejects.toThrow('outcome unknown')
  expect([locks.holder(account_key), [...a.session.values.keys()]]).toEqual([null, [account_key]])
  await b.sdk.execute(b.sdk.tx())
  expect([
    b.client.calls.executions,
    b.client.calls.visibility_waits,
    b.session.reads.every((value) => value === null),
  ]).toEqual([1, [], true])
  await expect(a.sdk.execute(a.sdk.tx())).rejects.toThrow('outcome unknown')
  expect([a.sdk.is_transaction_idle(), b.sdk.is_transaction_idle(), new Set(locks.names).size]).toEqual([
    false,
    true,
    1,
  ])

  expect([browser_transaction_lock(), browser_transaction_storage()]).toEqual([null, null])
  const session = memory_storage()
  const lost = tab_client('F', [], { lost: true })
  const sdk = with_window({ navigator: {}, sessionStorage: session }, () =>
    SDK({ client: lost.transport, signer, network: 'testnet', pins })
  )
  await expect(sdk.execute(sdk.tx())).rejects.toThrow('outcome unknown')
  expect([[...session.values.keys()], sdk.is_transaction_idle()]).toEqual([[account_key], false])
})
