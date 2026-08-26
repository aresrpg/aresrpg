// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { refreshed_world_anchor } from '../src/world_anchor.ts'

const presence = (world: string, x: number, z: number) =>
  ({ character_id: '0xc', world, x, y: 0, z, riding: false, pet: null }) as never

test('same-world rereads preserve validated walking while real travel resets it', () => {
  const move_anchor = { x: 130, z: 100, at_ms: 20, blocks: 4 }
  const existing = { presence: presence('nauvis', 130, 100), move_anchor } as never
  expect(refreshed_world_anchor(existing, presence('nauvis', 100, 100), 30)).toMatchObject({
    presence: { world: 'nauvis', x: 130, z: 100 },
    move_anchor,
  })
  expect(refreshed_world_anchor(existing, presence('yakutia', 50, 60), 30)).toEqual({
    presence: presence('yakutia', 50, 60),
    move_anchor: { x: 50, z: 60, at_ms: 30, blocks: 0 },
  })
})
