// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GAS-COIN PIN (<1s lane) — the per-fight-session pin that chains the wallet's gas coin across a
// fight's commits so each commit's build resolves ZERO gas round-trip. Proves: the pin applies ONLY with both a
// coin + price (all-or-nothing, else the build still resolves), chains the fresh ref from a landed receipt,
// re-reads the price on an epoch advance, and every invalidation path (equivocation / boundary) degrades to a
// clean miss (never a stale or fabricated coin).
import { afterEach, describe, expect, mock, test } from 'bun:test'

import {
  apply_pinned_gas,
  chain_gas_from_receipt,
  clear_gas_coin_cache,
  invalidate_gas_coin,
  remember_gas_coin,
  _peek_gas_cache,
} from './gas_coin_cache.js'

// A fake tx that records the exact gas it was pinned with (the real Transaction's setters, narrowed to what apply uses).
const make_tx = () => {
  const pinned = {}
  return {
    pinned,
    setGasPayment(refs) {
      pinned.payment = refs
    },
    setGasPrice(price) {
      pinned.price = price
    },
  }
}

// A landed-commit RAW receipt (the shape sign() passes: gRPC { Transaction: { epoch, effects: { gasObject } } }).
const receipt = (id, version, digest, epoch = '42') => ({
  Transaction: { epoch, effects: { gasObject: { id, outputVersion: version, outputDigest: digest } } },
})

const make_sdk = (price = '1000') => ({
  grpc_client: { core: { getReferenceGasPrice: mock(async () => ({ referenceGasPrice: price })) } },
})

afterEach(() => clear_gas_coin_cache())

describe('gas_coin_cache — apply (hit / miss)', () => {
  test('MISS on an empty cache → returns false, pins NOTHING (the commit selects gas normally)', () => {
    const tx = make_tx()
    expect(apply_pinned_gas(tx)).toBe(false)
    expect(tx.pinned).toEqual({})
  })

  test('MISS with a coin but NO price (partial) → false (all-or-nothing: a partial pin still forces a resolve)', () => {
    remember_gas_coin(receipt('0xcoin', '5', 'digA')) // coin only, no ensure_gas_price → price still null
    expect(_peek_gas_cache().price).toBeNull()
    expect(apply_pinned_gas(make_tx())).toBe(false)
  })

  test('HIT with coin + price → pins the EXACT { objectId, version, digest } ref + price, returns true', async () => {
    await chain_gas_from_receipt(make_sdk('1000'), receipt('0xcoin', '7', 'digB'))
    const tx = make_tx()
    expect(apply_pinned_gas(tx)).toBe(true)
    expect(tx.pinned.payment).toEqual([{ objectId: '0xcoin', version: '7', digest: 'digB' }])
    expect(tx.pinned.price).toBe('1000')
  })
})

describe('gas_coin_cache — chain from a landed receipt', () => {
  test('chains the fresh gas coin ref AND reads the epoch price ONCE (off the hot path)', async () => {
    const sdk = make_sdk('1000')
    await chain_gas_from_receipt(sdk, receipt('0xcoin', '9', 'digC', '42'))
    expect(_peek_gas_cache().coin).toEqual({ objectId: '0xcoin', version: '9', digest: 'digC' })
    expect(sdk.grpc_client.core.getReferenceGasPrice).toHaveBeenCalledTimes(1)
    // a SECOND commit in the same epoch chains the new coin but does NOT re-read the price
    await chain_gas_from_receipt(sdk, receipt('0xcoin', '10', 'digD', '42'))
    expect(_peek_gas_cache().coin.version).toBe('10')
    expect(sdk.grpc_client.core.getReferenceGasPrice).toHaveBeenCalledTimes(1) // still once
  })

  test('a FAILED tx receipt ({ FailedTransaction }) never chains (no coin, no price read)', async () => {
    const sdk = make_sdk()
    await chain_gas_from_receipt(sdk, { FailedTransaction: { effects: {} } })
    expect(_peek_gas_cache().coin).toBeNull()
    expect(sdk.grpc_client.core.getReferenceGasPrice).toHaveBeenCalledTimes(0)
  })

  test('EPOCH ADVANCE → the stale price is dropped and re-read at the new epoch', async () => {
    const sdk = make_sdk('1000')
    await chain_gas_from_receipt(sdk, receipt('0xcoin', '1', 'd1', '42'))
    expect(_peek_gas_cache().price).toBe('1000')
    sdk.grpc_client.core.getReferenceGasPrice = mock(async () => ({ referenceGasPrice: '1500' }))
    await chain_gas_from_receipt(sdk, receipt('0xcoin', '2', 'd2', '43')) // epoch 42 → 43
    expect(_peek_gas_cache().epoch).toBe('43')
    expect(_peek_gas_cache().price).toBe('1500') // re-read at the new reference price
  })

  test('a reference-gas-price read failure leaves price null → apply MISSES (degrades to selection, never throws)', async () => {
    const sdk = {
      grpc_client: {
        core: {
          getReferenceGasPrice: mock(async () => {
            throw new Error('rpc down')
          }),
        },
      },
    }
    await chain_gas_from_receipt(sdk, receipt('0xcoin', '3', 'd3'))
    expect(_peek_gas_cache().coin).not.toBeNull() // the coin still chained
    expect(_peek_gas_cache().price).toBeNull() // but no price → apply misses
    expect(apply_pinned_gas(make_tx())).toBe(false)
  })
})

describe('gas_coin_cache — invalidation (money safety)', () => {
  test('invalidate_gas_coin drops the COIN (equivocation guard) → apply misses; the epoch-stable price is kept', async () => {
    await chain_gas_from_receipt(make_sdk('1000'), receipt('0xcoin', '4', 'd4'))
    invalidate_gas_coin() // a non-commit tx (buy/send/crank) may have moved the coin
    expect(_peek_gas_cache().coin).toBeNull()
    expect(_peek_gas_cache().price).toBe('1000') // price survives (epoch-stable — no needless re-read)
    expect(apply_pinned_gas(make_tx())).toBe(false)
  })

  test('clear_gas_coin_cache (fight boundary) wipes coin + price + epoch', async () => {
    await chain_gas_from_receipt(make_sdk('1000'), receipt('0xcoin', '5', 'd5', '42'))
    clear_gas_coin_cache()
    expect(_peek_gas_cache()).toEqual({ coin: null, price: null, epoch: null })
  })

  test('a malformed gasObject (missing digest) never chains a partial ref', () => {
    remember_gas_coin({ Transaction: { epoch: '42', effects: { gasObject: { id: '0xc', outputVersion: '1' } } } })
    expect(_peek_gas_cache().coin).toBeNull() // no digest ⇒ not a usable ref
  })
})
