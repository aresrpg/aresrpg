// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (dungeon-modal deep-link): the DungeonsModal deep-links the entry-key name to its
// encyclopedia item page, and must resolve the key's TEMPLATE id WITHOUT a fetch — even in the no-key branch.
// CorpusWorld.dungeon_key_template_id is that resolution (world.json `dungeonKey` slug → seed_manifest.items);
// the field did not exist at HEAD (undefined). This pins that every authored world resolves it to a real id.
import { describe, expect, test } from 'bun:test'

import { WORLD_CORPUS, has_world_corpus } from './world_corpus'

describe('world_corpus resolves each world dungeon-key template id (no fetch, no chain read)', () => {
  // RUNTIME BLOB (#196): the world corpus loads from a published Walrus blob at boot (load_world_corpus),
  // never fetched in a headless unit test — WORLD_CORPUS degrades to zero worlds here (issue #106).
  test.skipIf(!has_world_corpus())('there is authored world corpus to resolve', () => {
    expect(WORLD_CORPUS.worlds.length).toBeGreaterThan(0)
  })

  test('every corpus world resolves its dungeon key to a minted 0x template object id', () => {
    for (const world of WORLD_CORPUS.worlds) {
      expect(typeof world.dungeon_key_template_id).toBe('string')
      expect(world.dungeon_key_template_id).toMatch(/^0x[0-9a-fA-F]{64}$/)
    }
  })
})
