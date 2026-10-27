// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  initial_checkout,
  reduce_checkout,
  checkout_locked,
  transfer_visible,
  TRANSFER_STEPS,
} from '../../src/funding/checkout_state.ts'
import { payment_rejected } from '../../src/funding/useFundingCheckout.ts'

test('unknown submission stays locked and cannot be cleared by editing the quote inputs', () => {
  const unknown = reduce_checkout(initial_checkout(), { type: 'error', error: 'timeout', uncertain: true })
  expect(checkout_locked(unknown)).toBe(true)
  expect(reduce_checkout(unknown, { type: 'reset' })).toBe(unknown)
  const refunded = reduce_checkout(unknown, { type: 'observed', status: 'refunded' })
  expect(checkout_locked(refunded)).toBe(false)
  expect(refunded.stage).toBe('refunded')
})

test('explicit wallet rejection is distinct from network failure', () => {
  expect(payment_rejected({ cause: { code: 4001 } })).toBe(true)
  expect(payment_rejected(new Error('Network timeout'))).toBe(false)
  const failed = reduce_checkout(initial_checkout(), { type: 'error', error: 'rejected' })
  expect(checkout_locked(failed)).toBe(false)
})

const funding_source = (address: string) =>
  ({ address }) as import('../../src/wallet/external_session.ts').CryptoWalletSession
const held = (asset_id: string, balance: bigint) => ({
  asset_id,
  symbol: asset_id,
  balance,
  blockchain: 'sol',
  decimals: 6,
  price: 1,
})

test('only owned tokens enter the picker, while failed reads are not an empty-wallet result', () => {
  const source = funding_source('first')
  const loading = reduce_checkout(initial_checkout(), { type: 'assets_loading', source })
  const ready = reduce_checkout(loading, {
    type: 'assets',
    source,
    assets: [held('USDC', 0n), held('SOL', 100n)],
    failed: false,
  })
  expect(ready.assets.map((asset) => asset.asset_id)).toEqual(['SOL'])
  expect(ready.asset_id).toBe('SOL')
  expect(ready.assets_status).toBe('ready')
  const failed = reduce_checkout(loading, { type: 'assets', source, assets: [], failed: true })
  expect(failed.assets_status).toBe('failed')
  const empty = reduce_checkout(loading, { type: 'assets', source, assets: [held('USDC', 0n)], failed: false })
  expect(empty.assets_status).toBe('ready')
  expect(empty.assets).toEqual([])
})

test('wallet changes reject late holdings and keep a valid selected token on refresh', () => {
  const first = funding_source('first'),
    second = funding_source('second')
  const switched = reduce_checkout(initial_checkout(), { type: 'assets_loading', source: second })
  expect(reduce_checkout(switched, { type: 'assets', source: first, assets: [held('OLD', 99n)], failed: false })).toBe(
    switched
  )
  const ready = reduce_checkout(switched, {
    type: 'assets',
    source: second,
    assets: [held('SOL', 3n), held('USDC', 5n)],
    failed: false,
  })
  expect(ready.asset_id).toBe('USDC')
  const selected = reduce_checkout(ready, { type: 'edit', field: 'asset_id', value: 'SOL' })
  expect(
    reduce_checkout(selected, {
      type: 'assets',
      source: second,
      assets: [held('SOL', 2n), held('USDC', 5n)],
      failed: false,
    }).asset_id
  ).toBe('SOL')
  const partial = reduce_checkout(selected, { type: 'assets', source: second, assets: [held('SOL', 2n)], failed: true })
  expect(partial.assets).toHaveLength(1)
  expect(partial.assets_status).toBe('failed')
})

test('provider status advances the transfer steps forward only, and time never completes a step', () => {
  const pending = reduce_checkout(initial_checkout(), { type: 'submitted', transaction: '0xabc', at: 1_000 })
  expect(pending).toMatchObject({ stage: 'pending', submitted_at: 1_000 })
  expect(TRANSFER_STEPS[pending.stage]).toEqual(['live', 'todo', 'todo'])
  expect(reduce_checkout(pending, { type: 'observed', status: 'pending' })).toBe(pending)
  const bridging = reduce_checkout(pending, { type: 'observed', status: 'bridging' })
  expect(TRANSFER_STEPS[bridging.stage]).toEqual(['done', 'live', 'todo'])
  expect(checkout_locked(bridging)).toBe(true)
  expect(reduce_checkout(bridging, { type: 'observed', status: 'pending' })).toBe(bridging)
  expect(reduce_checkout(bridging, { type: 'observed', status: 'bridging' })).toBe(bridging)
  const delivered = reduce_checkout(bridging, { type: 'observed', status: 'success' })
  expect(TRANSFER_STEPS[delivered.stage]).toEqual(['done', 'done', 'done'])
  expect(checkout_locked(delivered)).toBe(false)
  expect(reduce_checkout(delivered, { type: 'observed', status: 'refunded' })).toBe(delivered)
  expect(reduce_checkout(delivered, { type: 'reset' })).toMatchObject({ stage: 'idle', submitted_at: null })
})

test('a late provider status cannot revive an abandoned or unsent checkout', () => {
  const idle = initial_checkout()
  expect(reduce_checkout(idle, { type: 'observed', status: 'success' })).toBe(idle)
  const unknown = reduce_checkout(idle, { type: 'error', error: 'timeout', uncertain: true })
  expect(reduce_checkout(unknown, { type: 'observed', status: 'bridging' }).stage).toBe('bridging')
})

test('only local errors keep the form; signing and provider outcomes show the transfer card', () => {
  const rejected = reduce_checkout(initial_checkout(), { type: 'error', error: 'rejected' })
  expect(transfer_visible(rejected)).toBe(false)
  expect(
    transfer_visible(reduce_checkout(initial_checkout(), { type: 'stage', stage: 'signing', amount_text: '1' }))
  ).toBe(true)
  const pending = reduce_checkout(initial_checkout(), { type: 'submitted', transaction: '0xabc', at: 0 })
  const provider_failed = reduce_checkout(pending, { type: 'observed', status: 'failed' })
  expect(transfer_visible(provider_failed)).toBe(true)
  expect(TRANSFER_STEPS[provider_failed.stage]).toEqual(['done', 'failed', 'todo'])
})
