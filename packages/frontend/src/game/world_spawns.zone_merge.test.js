// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_spawns_store, spawn_rows } from '@aresrpg/world/spawns_zones'

const world_id = `0x${'a'.repeat(64)}`
const template_id = `0x${'b'.repeat(64)}`
const world_doc = { zone_size: 100, bounds_x: 1000, bounds_z: 1000 }
const mob = (spawn_id, x, z) => ({ spawn_id, kind: 'mob', x, z, template_id, size: 3 })
const spawn_keys = (state) =>
  spawn_rows(state)
    .map(({ key }) => key)
    .sort()

describe('#1486 — a chain-direct search result replaces only its zone', () => {
  test('zone B rows replace zone B while zone A groups survive, idempotently', () => {
    const store = create_spawns_store()
    const fold = (input) => store.getState().input(input, 10_000)
    fold({ type: 'world_bound', world_id })
    fold({ type: 'world_doc', doc: world_doc })
    fold({
      type: 'zones_rows_snapshot',
      version: 1,
      zones: [{ zx: 6, zy: 5, discovered_at_ms: 1 }],
      cells: [{ zx: 6, zy: 5, rows: [mob('b-old', 620, 540)] }],
    })

    fold({ type: 'zone_rows', zx: 5, zy: 5, proven: true, rows: [mob('a', 520, 540)] })
    fold({ type: 'zone_rows', zx: 6, zy: 5, proven: true, rows: [mob('b', 620, 540)] })

    expect(spawn_keys(store.getState())).toEqual(['5:5:mob:a', '6:5:mob:b'])

    fold({ type: 'zone_rows', zx: 6, zy: 5, proven: true, rows: [mob('b', 620, 540)] })
    expect(spawn_keys(store.getState())).toEqual(['5:5:mob:a', '6:5:mob:b'])
  })
})
