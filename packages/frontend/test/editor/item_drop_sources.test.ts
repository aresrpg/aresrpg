// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { item_drop_sources } from '../../src/editor/ItemDropSources.tsx'

const mob = {
  mob_type: 'example',
  name: 'Example mob',
  level_min: 2,
  level_max: 8,
  loot: [{ item_type: 'ore', chance_bp: 1234, min_qty: 1, max_qty: 3 }],
}

test('item drop sources use exact authored rates and quantities, excluding unrelated items', () => {
  expect(item_drop_sources([mob], 'ore')).toEqual([
    {
      key: 'example:0',
      mob_type: 'example',
      name: 'Example mob',
      level_min: 2,
      level_max: 8,
      chance_bp: 1234,
      min_qty: 1,
      max_qty: 3,
    },
  ])
  expect(item_drop_sources([mob], 'other')).toEqual([])
})

test('unsaved loot edits replace the displayed rate without changing the original row', () => {
  const changed = [{ ...mob, loot: [{ ...mob.loot[0]!, chance_bp: 7500 }] }]
  expect(item_drop_sources(changed, 'ore')[0]?.chance_bp).toBe(7500)
  expect(item_drop_sources([mob], 'ore')[0]?.chance_bp).toBe(1234)
  expect(item_drop_sources([{ ...mob, loot: [] }], 'ore')).toEqual([])
})

test('missing and incomplete drafts do not crash or match blank item identities', () => {
  expect(item_drop_sources(undefined, 'ore')).toEqual([])
  expect(item_drop_sources([null, {}, { loot: [null] }], 'ore')).toEqual([])
  expect(item_drop_sources([{ loot: [{ item_type: '' }] }], '')).toEqual([])
})
