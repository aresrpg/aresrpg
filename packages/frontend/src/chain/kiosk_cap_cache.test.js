// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// kiosk_cap_cache tests — kill the per-flow-open getOwnedKiosks discovery query with a
// client-side cache (S-51 owned-object law). Pure injection, ZERO mock.module (house convention — a
// process-global mock segfaults/order-flickers the suite when shared modules double-mock, per the codebase's
// own bun mock.module law): every test builds its own `sdk` spy object.
import { describe, expect, it, beforeEach } from 'bun:test'

import { get_personal_cap, get_personal_caps, invalidate } from './kiosk_cap_cache.js'

const ADDR_A = '0xalice'
const ADDR_B = '0xbob'
const CAP_A = { kioskId: '0xkiosk_a', objectId: '0xcap_a', isPersonal: true }
const CAP_A2 = { kioskId: '0xkiosk_a2', objectId: '0xcap_a2', isPersonal: true } // a 2nd personal kiosk for A
const SHARED = { kioskId: '0xkiosk_shared', objectId: '0xcap_shared', isPersonal: false } // must be filtered

function make_sdk(caps) {
  let calls = 0
  return {
    calls: () => calls,
    kiosk_client: {
      getOwnedKiosks: async () => {
        calls += 1
        return { kioskOwnerCaps: caps }
      },
    },
  }
}

// A caps read whose result changes across calls — models the fresh-wallet transition (a just-minted
// PersonalKioskCap not yet in the owned-object index → indexed). Returns sequence[i] on the i-th call; the
// last entry sticks for every further call.
function flipping_sdk(sequence) {
  let calls = 0
  return {
    calls: () => calls,
    kiosk_client: {
      getOwnedKiosks: async () => {
        const caps = sequence[Math.min(calls, sequence.length - 1)]
        calls += 1
        return { kioskOwnerCaps: caps }
      },
    },
  }
}

// invalidate() with no args clears EVERYTHING — reset between tests so cases can't leak into each other via
// the module-global cache (this is exactly the behavior wallet-switch relies on in production).
beforeEach(() => invalidate())

describe('get_personal_cap', () => {
  it('resolves the first personal cap, filtering out non-personal ones', async () => {
    const sdk = make_sdk([SHARED, CAP_A])
    const cap = await get_personal_cap(sdk, ADDR_A)
    expect(cap).toEqual(CAP_A)
  })

  it('resolves the exact kiosk_id when given', async () => {
    const sdk = make_sdk([CAP_A, CAP_A2])
    const cap = await get_personal_cap(sdk, ADDR_A, CAP_A2.kioskId)
    expect(cap).toEqual(CAP_A2)
  })

  it('returns null when the wallet holds no personal kiosk', async () => {
    const sdk = make_sdk([SHARED])
    const cap = await get_personal_cap(sdk, ADDR_A)
    expect(cap).toBeNull()
  })

  it('is cache-first: a second call for the same address makes ZERO further client calls', async () => {
    const sdk = make_sdk([CAP_A])
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_A, CAP_A.kioskId)
    expect(sdk.calls()).toBe(1)
  })

  it('caches per-address independently (a 2nd wallet still fires its own read)', async () => {
    const sdk = make_sdk([CAP_A]) // shared sdk instance across both addresses in this test
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_B)
    expect(sdk.calls()).toBe(2)
  })

  it('never memoizes a failed read — the next call retries', async () => {
    let attempt = 0
    const sdk = {
      kiosk_client: {
        getOwnedKiosks: async () => {
          attempt += 1
          if (attempt === 1) throw new Error('transient RPC hiccup')
          return { kioskOwnerCaps: [CAP_A] }
        },
      },
    }
    await expect(get_personal_cap(sdk, ADDR_A)).rejects.toThrow('transient RPC hiccup')
    const cap = await get_personal_cap(sdk, ADDR_A)
    expect(cap).toEqual(CAP_A)
    expect(attempt).toBe(2)
  })

  it('invalidate(address) drops only that address, leaving others cached', async () => {
    const sdk = make_sdk([CAP_A])
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_B)
    expect(sdk.calls()).toBe(2)

    invalidate(ADDR_A)
    await get_personal_cap(sdk, ADDR_A) // re-fetches
    await get_personal_cap(sdk, ADDR_B) // still cached
    expect(sdk.calls()).toBe(3)
  })

  it('invalidate() with no address clears everything (wallet switch/disconnect)', async () => {
    const sdk = make_sdk([CAP_A])
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_B)
    expect(sdk.calls()).toBe(2)

    invalidate()
    await get_personal_cap(sdk, ADDR_A)
    await get_personal_cap(sdk, ADDR_B)
    expect(sdk.calls()).toBe(4)
  })
})

// ── THE CACHE LAW (DECISIONS 08:12: never cache absence without an invalidation edge) ─────────────────
// A wallet's PersonalKioskCap is soulbound-stable ONCE minted (header line 6), so a NON-EMPTY caps read is
// memoized for the whole session (the buy-fix guarantee). But the empty→populated transition (header line 8)
// — a just-minted cap still lagging the owned-object index on a fresh wallet — has NO invalidation edge on
// character-create / world-join (only buy + wallet-reset call invalidate). Memoizing that [] froze the absence
// FOREVER, nulling the resolved cap for SEVEN gameplay callers. So an empty resolve is returned honestly to the
// current caller but NEVER persisted; the next call re-reads live. Single-flight (in-flight dedup) is preserved.
describe('get_personal_caps — absence is never memoized (THE CACHE LAW)', () => {
  it('an empty resolve is NOT memoized: the next call re-reads live and sees a just-created cap', async () => {
    const sdk = flipping_sdk([[], [CAP_A]]) // read 1: cap not yet indexed; read 2: it has landed
    expect(await get_personal_cap(sdk, ADDR_A)).toBeNull() // honest absence to the current caller
    expect(await get_personal_cap(sdk, ADDR_A)).toEqual(CAP_A) // RED at HEAD: the frozen [] stays null forever
    expect(sdk.calls()).toBe(2) // one fresh live read per resolve — the empty was evicted, never persisted
  })

  it('a NON-EMPTY resolve IS memoized (buy-fix guarantee): repeat resolves make ZERO further reads', async () => {
    const sdk = flipping_sdk([[CAP_A], [CAP_A2]]) // a 2nd, differing read would prove a re-read — it must NOT happen
    expect(await get_personal_cap(sdk, ADDR_A)).toEqual(CAP_A)
    expect(await get_personal_cap(sdk, ADDR_A)).toEqual(CAP_A) // still the memoized first read, never the flipped one
    expect(sdk.calls()).toBe(1)
  })

  it('single-flight: two concurrent cold calls share ONE in-flight load, even when it resolves empty', async () => {
    const sdk = flipping_sdk([[]]) // resolves empty — the self-evict must not break the concurrent dedup
    const [a, b] = await Promise.all([get_personal_caps(sdk, ADDR_A), get_personal_caps(sdk, ADDR_A)])
    expect(a).toEqual([])
    expect(b).toEqual([])
    expect(sdk.calls()).toBe(1) // both awaited the SAME in-flight load — dedup survives the empty-evict
  })
})
