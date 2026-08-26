// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { nearest_interaction_id } from '../../src/components/SpawnNametag.tsx'

test('the spawn interaction target follows the current pose instead of an earlier path position', () => {
  const candidates = [
    { id: 'earlier', x: 0, z: 0 },
    { id: 'nearby', x: 20, z: 0 },
  ]

  expect(nearest_interaction_id(candidates, { x: 2, z: 0 })).toBe('earlier')
  expect(nearest_interaction_id(candidates, { x: 18, z: 0 })).toBe('nearby')
  expect(nearest_interaction_id(candidates, { x: 50, z: 0 })).toBeNull()
})
