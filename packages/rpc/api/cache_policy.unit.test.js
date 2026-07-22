// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { derive_zone } from '../../sim/src/zone_derive.js'

import { cache_control_for } from './cache_policy.js'

const world = {
  zone_size: 512,
  bounds_x: 500000,
  bounds_z: 500000,
  min_groups: 3,
  max_groups: 3,
  min_nodes: 0,
  max_nodes: 0,
  mobs: [{ template_id: '0xb0b', rate_bp: 100, min_group: 2, max_group: 2, level: 0 }],
  resources: [],
}

const mob_spawn_ids = (zone) =>
  derive_zone({ zone, zx: 488, zy: 488, world, team_bound: 6 })
    .filter((row) => row.kind === 'mob')
    .map((row) => row.spawn_id)

describe('read API edge cache policy', () => {
  test('caches mutable public catalogs without a stale replay window', () => {
    expect(cache_control_for('/v1/encyclopedia')).toBe('public, max-age=0, s-maxage=30, must-revalidate')
    expect(cache_control_for('/v1/shop')).toBe('public, max-age=0, s-maxage=15, must-revalidate')
    expect(cache_control_for('/v1/sales-over-time')).toBe('public, max-age=0, s-maxage=15, must-revalidate')
    expect(cache_control_for('/v1/rare-links')).toBe('public, s-maxage=30, stale-while-revalidate=120')
  })

  test.each(['/v1/parties', '/v1/owner-items', '/v1/sponsor/remaining'])(
    'keeps personal or money-sensitive route %s out of shared caches',
    (pathname) => {
      expect(cache_control_for(pathname)).toBe('no-store')
    }
  )

  test('a refresh cannot replay a prior zone generation with different spawn_ids', () => {
    const in_session_zone = {
      seed: '9876543210',
      discovered_at_ms: 2000,
      mob_bitmap: [],
      res_bitmap: [],
    }
    const cached_prior_zone = { ...in_session_zone, seed: '9876543209', discovered_at_ms: 1000 }
    const zone_cache_control = cache_control_for('/v1/zones')
    const post_refresh_zone = zone_cache_control === 'no-store' ? in_session_zone : cached_prior_zone

    expect(mob_spawn_ids(post_refresh_zone)).toEqual(mob_spawn_ids(in_session_zone))
    expect(zone_cache_control).toBe('no-store')
  })
})
