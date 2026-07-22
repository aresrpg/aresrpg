// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BUILD #180 — RED-FIRST: the HISTORY tab's COLLECT box must show exactly when real money is waiting, and
// must sum EVERY personal kiosk the wallet owns (multi-kiosk truth), never just the first. Pure injection,
// ZERO mock.module (house convention — kiosk_cap_cache.test.js's law: a process-global mock
// segfaults/order-flickers the suite when shared modules double-mock): `read_kiosk` is stubbed directly at
// its own seam, never @mysten/kiosk's internal BCS parse.
import { describe, expect, it, beforeEach } from 'bun:test'

import { get_kiosk_profits, has_collectible_profits } from './read_kiosk_profits.js'
import { invalidate } from './kiosk_cap_cache.js'

const ADDR = '0xalice'
const CAP_A = { kioskId: '0xkiosk_a', objectId: '0xcap_a', isPersonal: true }
const CAP_B = { kioskId: '0xkiosk_b', objectId: '0xcap_b', isPersonal: true }

function make_sdk(caps) {
  return {
    kiosk_client: { getOwnedKiosks: async () => ({ kioskOwnerCaps: caps }) },
    grpc_client: {},
  }
}

function reader(by_kiosk_id) {
  return async (_client, kiosk_id) => ({ profits: by_kiosk_id[kiosk_id] ?? '0' })
}

// kiosk_cap_cache is a module-global cache keyed by address — reset between tests (mirrors
// kiosk_cap_cache.test.js) so one test's caps can never leak into the next.
beforeEach(() => invalidate())

describe('get_kiosk_profits — multi-kiosk truth', () => {
  it('sums profits across every personal kiosk the wallet owns, not just the first', async () => {
    const sdk = make_sdk([CAP_A, CAP_B])
    const result = await get_kiosk_profits(sdk, ADDR, reader({ '0xkiosk_a': '1000000000', '0xkiosk_b': '250000000' }))
    expect(result.total_mist).toBe(1_250_000_000n)
    expect(result.kiosk_ids.slice().sort()).toEqual(['0xkiosk_a', '0xkiosk_b'])
  })

  it('a kiosk sitting at zero is excluded from the collect target list, but the other still counts', async () => {
    const sdk = make_sdk([CAP_A, CAP_B])
    const result = await get_kiosk_profits(sdk, ADDR, reader({ '0xkiosk_a': '0', '0xkiosk_b': '500000000' }))
    expect(result.total_mist).toBe(500_000_000n)
    expect(result.kiosk_ids).toEqual(['0xkiosk_b'])
  })

  it('a wallet with zero personal kiosks reads zero without ever calling the kiosk reader', async () => {
    const sdk = make_sdk([])
    let calls = 0
    const result = await get_kiosk_profits(sdk, ADDR, async () => {
      calls += 1
      return { profits: '999' }
    })
    expect(result).toEqual({ total_mist: 0n, kiosk_ids: [] })
    expect(calls).toBe(0)
  })

  it('reads every kiosk (order-independent — proves it is not silently dropping a second/third kiosk)', async () => {
    const sdk = make_sdk([CAP_A, CAP_B])
    const seen = []
    await get_kiosk_profits(sdk, ADDR, async (_client, kiosk_id) => {
      seen.push(kiosk_id)
      return { profits: '100' }
    })
    expect(seen.slice().sort()).toEqual(['0xkiosk_a', '0xkiosk_b'])
  })

  it('a failed kiosk read throws — never silently under-reports real money as zero', async () => {
    const sdk = make_sdk([CAP_A])
    await expect(
      get_kiosk_profits(sdk, ADDR, async () => {
        throw new Error('transient RPC hiccup')
      })
    ).rejects.toThrow('transient RPC hiccup')
  })
})

describe('has_collectible_profits — the box/dot visibility boundary', () => {
  it('zero profits never shows the box', () => {
    expect(has_collectible_profits(0n)).toBe(false)
  })

  it('the smallest possible balance (1 mist) already shows it — no hidden floor', () => {
    expect(has_collectible_profits(1n)).toBe(true)
  })

  it('a real multi-SUI balance shows it', () => {
    expect(has_collectible_profits(5_000_000_000n)).toBe(true)
  })
})
