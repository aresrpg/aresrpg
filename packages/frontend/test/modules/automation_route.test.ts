// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { ZONE_RESEARCH_TTL_MS } from '@aresrpg/protocol'

import {
  nearest_resource,
  next_resource_zone,
  remember_empty_zone,
  resource_location_eligible,
  zone_ring,
  type RouteContext,
} from '../../src/modules/automation_route.ts'

import { automation_fixture, key, resource } from './automation_fixture.ts'

const context = (): RouteContext => ({
  world: 'nauvis',
  resource,
  zones: automation_fixture().world,
  visited: {},
  x: 50_000,
  z: 50_000,
  now_ms: 1_000,
})

test('city placement overrides biome eligibility, including city-only resources', () => {
  const row = { ...resource, biomes: ['forest'], cities: ['city'] }
  expect(resource_location_eligible(row, 'other-city', 'forest')).toBe(false)
  expect(resource_location_eligible(row, 'city', 'desert')).toBe(true)
  expect(resource_location_eligible(row, null, 'forest')).toBe(true)
  expect(resource_location_eligible({ ...row, biomes: [] }, null, 'forest')).toBe(false)
})

test('zone rings are finite, unique, and cover every perimeter cell', () => {
  expect(zone_ring(4, 5, 0)).toEqual([{ zx: 4, zz: 5 }])
  const ring = zone_ring(4, 5, 3)
  expect(ring).toHaveLength(24)
  expect(new Set(ring.map(({ zx, zz }) => `${zx}:${zz}`)).size).toBe(24)
  expect(ring.every(({ zx, zz }) => Math.max(Math.abs(zx - 4), Math.abs(zz - 5)) === 3)).toBe(true)
})

test('nearest live pack ignores other resources and consumed packs', () => {
  const current = context()
  const zones = {
    ...current.zones,
    spawns: {
      [key]: {
        mobs: [],
        resources: [
          { index: 0, item_type: resource.item_type, x: 50_001, z: 50_000, nodes: 1 },
          { index: 1, item_type: resource.item_type, x: 50_020, z: 50_000, nodes: 2 },
          { index: 2, item_type: 'other', x: 50_000, z: 50_000, nodes: 20 },
        ],
      },
    },
    zones: { [key]: { ...current.zones.zones[key]!, res_taken: [1] } },
  }
  expect(nearest_resource({ ...current, zones }, key)?.x).toBe(50_020)
})

test('visited zones survive cache eviction and become candidates again at expiry', () => {
  const current = context()
  const visited = remember_empty_zone(current, key)
  const evicted = { ...current, visited, zones: { ...current.zones, zones: {}, spawns: {} } }
  const eligible = (_world: string, _resource: typeof resource, zx: number, zz: number) =>
    zz === 97 && [97, 98].includes(zx)
  expect(next_resource_zone(evicted, eligible)?.key).toBe('nauvis:98:97')
  expect(next_resource_zone({ ...evicted, now_ms: ZONE_RESEARCH_TTL_MS + 1 }, eligible)?.key).toBe(key)
})

test('a missing population is unknown rather than exhausted', () => {
  const current = context()
  const missing = { ...current, zones: { ...current.zones, spawns: {} } }
  expect(next_resource_zone(missing, () => true)?.key).toBe(key)
})

test('search never targets an excluded biome or a coordinate outside the world', () => {
  const current = { ...context(), x: 0, z: 0 }
  const selected = next_resource_zone(current, (_world, _resource, zx, zz) => zx === 1 && zz === 0)
  expect(selected?.key).toBe('nauvis:1:0')
  expect(selected!.x).toBeGreaterThan(0)
  expect(selected!.z).toBeGreaterThan(0)
})
