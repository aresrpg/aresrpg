// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { bind_world_corpus_to_live, type CorpusWorld } from '../../../src/pages/encyclopedia/world_corpus'

const STALE_WORLD_ID = `0x${'a'.repeat(64)}`
const LIVE_WORLD_ID = `0x${'b'.repeat(64)}`
const LIVE_BOSS_ID = `0x${'c'.repeat(64)}`

test('#1623 binds a published boss roster to the current world lineage through the world seed', () => {
  const authored_world: CorpusWorld = {
    id: STALE_WORLD_ID,
    wid: '01_first_shore',
    name: 'First Shore',
    band: [1, 12],
    biome: 'archipelago',
    mobs: [
      {
        id: 'phacochef',
        name: 'Phacochef',
        element: 'earth',
        role: 'boss',
        minLevel: 12,
        maxLevel: 12,
      },
    ],
    resources: [],
  }
  const live_world = {
    world_id: LIVE_WORLD_ID,
    seed: '2151050269',
  }

  const bound = bind_world_corpus_to_live(
    [authored_world],
    [{ template_id: LIVE_BOSS_ID, name: 'Phacochef' }],
    [],
    [live_world]
  ).worlds.find((world) => world.id === LIVE_WORLD_ID)

  expect(bound?.mobs).toEqual([
    {
      ...authored_world.mobs[0],
      id: LIVE_BOSS_ID,
    },
  ])
})
