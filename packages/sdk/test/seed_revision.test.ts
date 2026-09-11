// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { created_seed_row_keys, seed_ledger_after_batch, seed_sync_view, type SeedSyncRow } from '../src/seed_sync.ts'

test('zone discovery does not turn unchanged world content into a pending rewrite', () => {
  const content_id = '0x985d4453aff2f0097ee52c4278751d6e87c6488c12a926fbb14bd1a6b5c464c1'
  const gameplay_id = '0xf5ca91ff0ec5cacd089106d93c05cc926a3fbdd8937cd5dcbab0ae2fd5356ca0'
  const world: SeedSyncRow = {
    key: content_id,
    label: 'world nauvis',
    hash: 'd87398dc91eae7a7',
    kind: 'template',
    domain: 'world',
    chain_id: content_id,
    addresses: [content_id, gameplay_id],
    hydrate: [content_id],
  }
  // Mainnet capture, 2026-09-11: WorldContent 0x985d4453aff2f0097ee52c4278751d6e87c6488c12a926fbb14bd1a6b5c464c1
  // stayed at v855012005; World 0xf5ca91ff0ec5cacd089106d93c05cc926a3fbdd8937cd5dcbab0ae2fd5356ca0
  // advanced from v855012005 to v996016186 through gameplay. Authored hash stayed d87398dc91eae7a7.
  const content_revision = '855012005:2LmdKTeqgwjJMG1HaX1HugSccUzzDDF8ffLTPcLFTsPj'
  const ledger = {
    [world.key]: {
      hash: world.hash,
      label: world.label,
      revisions: {
        [content_id]: content_revision,
        [gameplay_id]: '855012005:BB9oXEV97d3HpRyHzHvp7oxuXqCzWYfpqyJmrsiqaKbP',
      },
    },
  }
  const revision = (id: string) =>
    id === content_id ? content_revision : '996016186:C49vhQ9RNff6rQnjFCGBwYmxV8E2iYhNQxcuqwpahyMj'

  const view = seed_sync_view([world], ledger, () => true, 0, revision)
  expect(view.changed).toEqual([])
  expect(view.unchanged).toBe(1)
  expect(
    seed_sync_view(
      [world],
      ledger,
      () => true,
      0,
      () => 'new:content'
    ).changed
  ).toEqual([world])
  expect(
    seed_sync_view(
      [world],
      ledger,
      () => true,
      0,
      () => null
    ).changed
  ).toEqual([world])
  expect(seed_sync_view([{ ...world, hash: 'edited' }], ledger, () => true, 0, revision).changed).toHaveLength(1)

  const recorded = seed_ledger_after_batch([world], {}, [world.key], revision)
  expect(recorded[world.key]?.revisions).toEqual({ [content_id]: content_revision })
  expect(seed_sync_view([world], recorded, () => true, 0, revision).unchanged).toBe(1)

  expect(created_seed_row_keys([world], {}, new Set([content_id]), () => true).size).toBe(0)
  expect(created_seed_row_keys([world], {}, new Set(world.addresses), () => true)).toEqual(new Set([world.key]))
})
