// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon keys remain stable slugs in authored content. A clickable template id comes only from a held live row.
import { describe, expect, test } from 'bun:test'

import { WORLD_CORPUS, has_world_corpus } from './world_corpus'

describe('world_corpus keeps each dungeon key republish-stable', () => {
  // RUNTIME BLOB (#196): the world corpus loads from a published asset-host blob at boot (load_world_corpus),
  // never fetched in a headless unit test — WORLD_CORPUS degrades to zero worlds here (issue #106).
  test.skipIf(!has_world_corpus())('there is authored world corpus to resolve', () => {
    expect(WORLD_CORPUS.worlds.length).toBeGreaterThan(0)
  })

  test('every corpus world exposes an authored slug, never a receipt object id', () => {
    for (const world of WORLD_CORPUS.worlds) {
      expect(typeof world.dungeon_key_slug).toBe('string')
      expect(world.dungeon_key_slug).not.toMatch(/^0x/)
    }
  })
})
