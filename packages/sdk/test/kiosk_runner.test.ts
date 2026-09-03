// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { resolve_kiosk_cap, retry_stale_kiosk_ref } from '../src/kiosk_runner.ts'

test('a cached kiosk cap retries one fresh lookup only when another tab advanced it', async () => {
  const refreshes: boolean[] = []
  const result = await retry_stale_kiosk_ref(async (fresh) => {
    refreshes.push(fresh)
    if (!fresh) throw new Error('provided version does not match, provided: 8 actual: 0x9')
    return 'submitted'
  })

  expect(result).toBe('submitted')
  expect(refreshes).toEqual([false, true])
})

test('encoded resolver errors use the same stale-cap classifier', async () => {
  const refreshes: boolean[] = []
  await retry_stale_kiosk_ref(async (fresh) => {
    refreshes.push(fresh)
    if (!fresh) throw new Error('provided%20version%20does%20not%20match,%20provided:%208%20actual:%200x9')
    return 'submitted'
  })
  expect(refreshes).toEqual([false, true])
})

test('wire custody refreshes the mutable PersonalKioskCap before composition', async () => {
  const personal = `0x${'1'.repeat(64)}`
  const kiosk = `0x${'2'.repeat(64)}`
  let fallback_calls = 0
  const exact = {
    objectId: personal,
    kioskId: kiosk,
    isPersonal: true,
    version: '997314902',
    digest: '4ptWTLDJMjxgm48JivnNQppZ8vqFR28ewDkWR8nYYY4y',
  }
  const cap = await resolve_kiosk_cap(
    async (requested_kiosk) => {
      fallback_calls += 1
      expect(requested_kiosk).toBe(kiosk)
      return exact
    },
    { kiosk, kiosk_cap: personal }
  )

  expect(fallback_calls).toBe(1)
  expect(cap).toMatchObject({
    objectId: personal,
    kioskId: kiosk,
    isPersonal: true,
    version: '997314902',
  })
})

test('missing wire cap uses the kiosk-specific loader', async () => {
  const requested: (string | undefined)[] = []
  const expected = {
    objectId: '0xcap',
    kioskId: '0xkiosk',
    isPersonal: true,
    version: '1',
    digest: '11111111111111111111111111111111',
  }
  const cap = await resolve_kiosk_cap(
    async (kiosk) => {
      requested.push(kiosk)
      return expected
    },
    { kiosk: '0xkiosk' }
  )

  expect(requested).toEqual(['0xkiosk'])
  expect(cap).toBe(expected)
})

test('a loader result for another kiosk is refused', async () => {
  await expect(
    resolve_kiosk_cap(
      async () => ({
        objectId: '0xcap',
        kioskId: '0xother',
        isPersonal: true,
        version: '1',
        digest: '11111111111111111111111111111111',
      }),
      { kiosk: '0xwanted' }
    )
  ).rejects.toThrow('The requested PersonalKioskCap is unavailable')
})
