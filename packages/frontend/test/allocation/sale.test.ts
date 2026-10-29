// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  buy_check,
  buy_limits,
  create_sale_runtime,
  initial_sale,
  reduce_sale,
  spot_stage,
  type SaleTask,
} from '../../src/allocation/sale.ts'
import type { AuthSession } from '../../src/auth.ts'

const SUI = 1_000_000_000n
const proof = { index: '3', cap_mist: String(125n * SUI), siblings: ['ab'.repeat(32)] }

test('the spot stage follows the chain lifecycle and never guesses an unread claim', () => {
  const cap = 125n * SUI
  expect(spot_stage('soon', null, cap)).toBe('soon')
  expect(spot_stage('live', { quote: 40n * SUI, wallet_cap: cap }, cap)).toBe('live')
  expect(spot_stage('live', { quote: cap, wallet_cap: cap }, cap)).toBe('full')
  expect(spot_stage('funded', null, cap)).toBe('waiting')
  expect(spot_stage('complete', undefined, cap)).toBe('checking')
  expect(spot_stage('complete', null, cap)).toBe('settled')
  expect(spot_stage('cancelled', { quote: 1n, wallet_cap: cap }, cap)).toBe('claim')
})

test('Max stays inside both the spot and the wallet after its gas cushion', () => {
  const full = buy_limits(125n * SUI, 40n * SUI, (21240n * SUI) / 100n)
  expect(full).toEqual({
    remaining: 85n * SUI,
    spendable: (21220n * SUI) / 100n,
    max: 85n * SUI,
    presets: [10n * SUI, 25n * SUI, 50n * SUI],
  })
  const poor = buy_limits(125n * SUI, 40n * SUI, (2040n * SUI) / 100n)
  expect(poor.max).toBe((2020n * SUI) / 100n)
  expect(poor.presets).toEqual([10n * SUI])
  expect(buy_limits(70n * SUI, 0n, null).max).toBe(70n * SUI)
  expect(buy_limits(70n * SUI, 0n, 1n).max).toBe(0n)
})

test('an amount is ready, over the spot, or short by exactly what Add funds tops up', () => {
  const limits = buy_limits(125n * SUI, 40n * SUI, (2040n * SUI) / 100n)
  expect(buy_check(null, limits)).toEqual({ kind: 'empty' })
  expect(buy_check(86n * SUI, limits)).toEqual({ kind: 'over_cap' })
  expect(buy_check(85n * SUI, limits)).toEqual({ kind: 'short', missing: 85n * SUI - (2020n * SUI) / 100n })
  expect(buy_check(20n * SUI, limits)).toEqual({ kind: 'ready' })
})

const wallet = (purchase: (input: unknown) => Promise<{ digest: string }>) =>
  ({
    address: '0xa1',
    read_sui_balance: async () => 7n * SUI,
    blast: { purchase, claim: async () => ({ digest: 'claim' }) },
  }) as unknown as AuthSession

test('one task at a time; a stale result cannot overwrite the current one', () => {
  const buy: SaleTask = { kind: 'buy', wallet: wallet(async () => ({ digest: 'd' })), amount: SUI, proof }
  const busy = reduce_sale(initial_sale(), { type: 'request', task: buy })
  expect(reduce_sale(busy, { type: 'request', task: { kind: 'claim', wallet: buy.wallet } })).toBe(busy)
  const error = { address: '0xa1', message: 'refused' }
  expect(reduce_sale(busy, { type: 'result', sequence: 0, receipt: null, error })).toBe(busy)
  expect(reduce_sale(busy, { type: 'result', sequence: 1, receipt: null, error })).toMatchObject({ task: null, error })
})

test('a purchase signs once with the allowlist proof, then re-reads that wallet', async () => {
  const calls: unknown[] = []
  const reads: string[] = []
  const runtime = create_sale_runtime({
    commitment: async (address) => {
      reads.push(address)
      return { quote: 45n * SUI, wallet_cap: 125n * SUI }
    },
  })
  const stop = runtime.start()
  const signer = wallet(async (input) => {
    calls.push(input)
    return { digest: 'buy-digest' }
  })
  runtime.dispatch({ type: 'request', task: { kind: 'buy', wallet: signer, amount: 45n * SUI, proof } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  stop()
  expect(calls).toEqual([{ method: 'allowlisted', amount: 45n * SUI, proof }])
  const state = runtime.store.getState()
  expect(state.receipt).toEqual({ kind: 'buy', address: '0xa1', amount: 45n * SUI, digest: 'buy-digest' })
  expect(reads).toEqual(['0xa1'])
  expect(state.commitments['0xa1']).toEqual({ quote: 45n * SUI, wallet_cap: 125n * SUI })
  expect(state.balances['0xa1']).toBe(7n * SUI)
})

test('failed reads stay unknown instead of showing zero bought', async () => {
  const runtime = create_sale_runtime({
    commitment: async () => {
      throw new Error('rpc down')
    },
  })
  await runtime.refresh(['0xa1'], [])
  expect(runtime.store.getState().commitments).toEqual({})
})
