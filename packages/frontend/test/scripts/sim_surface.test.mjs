// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { join_live_mobs } from '../../scripts/fight_bot/sim_surface.mjs'
import encyclopedia_fixture from '../../src/rpc/fixtures/encyclopedia.json'
import world_fixture from '../../src/pages/encyclopedia/world_corpus.fixture.json'

describe('fight bot simulator mob identity', () => {
  test('joins a republished live template by stable name, never the stale receipt id', () => {
    const blob = {
      first_world: {
        mobs: [{ key: 'grimfang', name: 'Grimfang', role: 'trash', minLevel: 4 }],
      },
    }
    const live = [
      {
        template_id: `0x${'b'.repeat(64)}`,
        name: 'Grimfang',
        min_level: 4,
      },
    ]

    expect(join_live_mobs(blob, live)).toEqual([
      {
        key: 'grimfang',
        id: 'grimfang',
        name: 'Grimfang',
        level: 4,
      },
    ])
  })

  test('captured published slice matches 6 of 374 served mobs by stable name', () => {
    const joined = join_live_mobs(world_fixture, encyclopedia_fixture.mobs)
    expect(joined).toHaveLength(6)
    expect(joined.every((mob) => !mob.id.startsWith('0x'))).toBe(true)
  })
})
