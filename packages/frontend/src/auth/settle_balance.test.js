// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue-4 (regression: Send-SUI display stayed stale) — proves settle_balance_after_tx defeats the fullnode's
// coin-balance index lag by re-driving the store's single-writer refresh until the value CHANGES, early-stopping
// the instant it does, and giving up bounded (never an infinite loop). Pure callbacks — no store/network mocks.
import { describe, expect, test } from 'bun:test'

import { settle_balance_after_tx } from './sui_balance'

describe('settle_balance_after_tx', () => {
  test('already-fresh node → 1 refresh (early-stop the instant the value changes; zero extra load)', async () => {
    let store = 100n
    let reads = 0
    await settle_balance_after_tx(
      () => store,
      async () => {
        reads++
        store = 90n // node already reflected the tx
      },
      { attempts: 6, delay_ms: 1 }
    )
    expect(reads).toBe(1)
    expect(store).toBe(90n)
  })

  test('index lags → re-polls while stale, settles on the change (the Send-SUI staleness fix)', async () => {
    let store = 100n
    let reads = 0
    await settle_balance_after_tx(
      () => store,
      async () => {
        reads++
        if (reads >= 3) store = 90n // node catches up on the 3rd read
      },
      { attempts: 6, delay_ms: 1 }
    )
    expect(reads).toBe(3)
    expect(store).toBe(90n)
  })

  test('never settles → bounded give-up (no infinite loop; best-effort, never blanks)', async () => {
    let reads = 0
    await settle_balance_after_tx(
      () => 100n, // value never changes (e.g. persistent RPC lag)
      async () => {
        reads++
      },
      { attempts: 4, delay_ms: 1 }
    )
    expect(reads).toBe(4)
  })
})
