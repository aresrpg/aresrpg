// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Exact mirror of engine/tests/shard_index_tests.move. The expected indexes are pinned on the Move side first;
// both FightRegistry and FightLatch selection call this single SDK implementation.
import { expect, test } from 'bun:test'

import { fight_shard_index } from '../src/deployment/aresrpg.js'

const MOVE_VECTORS = [
  ['0x0', 0],
  ['0x1', 1],
  ['0x10', 0],
  ['0x2f', 15],
  ['0x1234567890abcdefa7', 7],
]

test('Move ↔ JS shard-index parity', () => {
  for (const [id, expected] of MOVE_VECTORS)
    expect(fight_shard_index(id)).toBe(expected)
})
