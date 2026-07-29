// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  WORLD_CORPUS,
  world_corpus_for_mob,
  world_corpus_for_resource,
  is_listed_mob_role,
  has_world_corpus,
} from './world_corpus'

describe('world_corpus_for_mob', () => {
  // RUNTIME BLOB (#196): the world corpus loads from a published asset-host blob at boot (load_world_corpus),
  // never fetched in a headless unit test — WORLD_CORPUS degrades to zero worlds here (issue #106). This
  // full-corpus case runs only where the blob is seeded (set_world_corpus_for_test / a content-bearing CI).
  test.skipIf(!has_world_corpus())(
    'EVERY authored roster mob inverts to exactly its own manifest world (all 20 worlds)',
    () => {
      const { worlds } = WORLD_CORPUS
      for (const world of worlds) {
        for (const mob of world.mobs ?? []) {
          const hits = world_corpus_for_mob(mob.name)
          const here = hits.find((h) => h.id === world.id)
          expect(here?.wid).toBe(world.wid)
          expect(here?.name).toBe(world.name)
        }
      }
    }
  )

  test('returns an honest empty list for an unknown/non-living template id', () => {
    expect(world_corpus_for_mob('0xnot-a-current-mob')).toEqual([])
    expect(world_corpus_for_mob(null)).toEqual([])
  })

  // design ruling 2026-07-19 (the ambrine precedent): resource PROTECTORS are excluded from every world roster.
  test('the protector role never joins a world roster; every other authored role lists', () => {
    expect(is_listed_mob_role('protector')).toBe(false)
    expect(is_listed_mob_role('archi')).toBe(true)
    expect(is_listed_mob_role('trash')).toBe(true)
    expect(is_listed_mob_role(null)).toBe(true)
    for (const world of WORLD_CORPUS.worlds) for (const mob of world.mobs ?? []) expect(mob.role).not.toBe('protector')
  })
})

// FEATURE: the encyclopedia gatherable pages get a clickable "FOUND IN" world list —
// the exact mob-page idiom, inverted over the SAME authored corpus rows the worlds tab renders.
describe('world_corpus_for_resource', () => {
  // RUNTIME BLOB (#196): the world corpus loads from a published asset-host blob at boot (load_world_corpus),
  // never fetched in a headless unit test — WORLD_CORPUS degrades to zero worlds here (issue #106). This
  // full-corpus case runs only where the blob is seeded (set_world_corpus_for_test / a content-bearing CI).
  test.skipIf(!has_world_corpus())('EVERY authored gatherable inverts to each world that places it', () => {
    const { worlds } = WORLD_CORPUS
    let checked = 0
    for (const world of worlds)
      for (const resource of world.resources ?? []) {
        const hits = world_corpus_for_resource(resource.name)
        const here = hits.find((h) => h.id === world.id)
        expect(here?.wid).toBe(world.wid)
        expect(here?.name).toBe(world.name)
        checked += 1
      }
    expect(checked).toBeGreaterThan(0)
  })

  test('a re-placed lower-tier node lists every placing world exactly once', () => {
    for (const world of WORLD_CORPUS.worlds)
      for (const resource of world.resources ?? []) {
        const ids = world_corpus_for_resource(resource.name).map((w) => w.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
  })

  test('returns an honest empty list for an unknown/non-resource template id', () => {
    expect(world_corpus_for_resource('0xnot-a-current-resource')).toEqual([])
    expect(world_corpus_for_resource(null)).toEqual([])
  })
})
