// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { cache_control_for } from './cache_policy.js'

describe('read API edge cache policy', () => {
  test('caches mutable public catalogs without a stale replay window', () => {
    expect(cache_control_for('/v1/encyclopedia')).toBe('public, max-age=0, s-maxage=30, must-revalidate')
    expect(cache_control_for('/v1/shop')).toBe('public, max-age=0, s-maxage=15, must-revalidate')
    expect(cache_control_for('/v1/rare-links')).toBe('public, s-maxage=30, stale-while-revalidate=120')
  })

  test.each(['/v1/parties', '/v1/owner-items', '/v1/sponsor/remaining'])(
    'keeps personal or money-sensitive route %s out of shared caches',
    (pathname) => {
      expect(cache_control_for(pathname)).toBe('no-store')
    }
  )
})
