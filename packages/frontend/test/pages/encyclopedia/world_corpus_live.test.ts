// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, test } from 'bun:test'
import { world_seed } from '@aresrpg/sdk/world-seed'

import {
  bind_world_corpus_to_live,
  set_world_corpus_for_test,
  use_world_corpus,
  type WorldCorpusBlob,
} from '../../../src/pages/encyclopedia/world_corpus'

const LIVE_WORLD_ID = `0x${'d'.repeat(64)}`
const LIVE_WID = '21_new_dawn'

afterEach(() => set_world_corpus_for_test())

test('#1331 derives a newly published world from the runtime artifact without a bundled seed receipt', () => {
  const published_blob: WorldCorpusBlob = {
    [LIVE_WID]: {
      world: { name: 'New Dawn', band: [201, 210], biome: 'aurora', resources: [] },
      mobs: [{ key: 'new_dawn_boss', name: 'Dawn Regent', role: 'boss', minLevel: 210, maxLevel: 210 }],
      resources: [],
    },
  }

  set_world_corpus_for_test(published_blob)
  const bound = bind_world_corpus_to_live(
    use_world_corpus.getState().worlds,
    [],
    [],
    [{ world_id: LIVE_WORLD_ID, seed: world_seed(LIVE_WID) }]
  )

  expect(bound.worlds.map(({ id, wid }) => ({ id, wid }))).toEqual([{ id: LIVE_WORLD_ID, wid: LIVE_WID }])
})
