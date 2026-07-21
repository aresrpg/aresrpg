// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#196): prod booted `[world_corpus] joined 0 worlds / 0 mobs / 0 resources` because the world
// corpus was baked at BUILD time from seed/mainnet/*.json — files absent from this repo by design. The fix
// makes it a RUNTIME blob (world_corpus.json) fetched like spell_corpus.js / mob_catalog.js. This suite pins
// BOTH halves: (1) an absent class degrades LOUDLY to zero worlds with one honest console line and never
// throws; (2) a blob in the #196 contract shape parses to N worlds with rosters, gatherables and inversions.
//
// FIXTURE PROVENANCE: packages/frontend/src/pages/encyclopedia/world_corpus.fixture.json is a 2-world slice
// (01_first_shore, 02_verdant_hollow) CAPTURED from the real published blob —
//   quilt sMtRas-Y5ErfiAw74XCxVX6O14-GYvhqBo4NfVKsV8I · world_corpus.json · 815,759 bytes ·
//   sha256 92ff28f5ae260ea6f5dd804c83ff93b1b2a1465b304a3b56bc82c2f9a79653a8 · fetched 2026-07-21 —
// trimmed to the fields world_corpus.ts reads (the contract's verbatim `{world,mobs,resources}` trio minus
// display-only tails: mob loot/stats/hp, resource description). Its wids/mob keys/resource slugs are REAL, so
// they join to this tree's seed_manifest exactly as the full blob does — a hand-invented fixture would prove
// nothing about the join.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
  WORLD_CORPUS,
  gather_ladder_of,
  has_world_corpus,
  load_world_corpus,
  mob_corpus_of,
  set_world_corpus_for_test,
  world_corpus_for_mob,
  world_corpus_for_resource,
  type WorldCorpusBlob,
} from './world_corpus'
import fixture from './world_corpus.fixture.json'

afterEach(() => set_world_corpus_for_test()) // reset module state (pristine, retryable) between tests

describe('world corpus runtime loader (#196)', () => {
  test('absent class (unpublished — walrus_asset_url → null) → ONE console.error, zero worlds, never throws', async () => {
    set_world_corpus_for_test() // pristine + resets the once-per-session degrade latch
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    // 'world_corpus' is not a configured asset class in the offline test manifest, so the URL resolves null —
    // the exact prod symptom before the blob published (and the open-source / pre-publish state). No fetch,
    // no throw, just the loud degrade — the honest replacement for `joined 0 worlds`.
    await expect(load_world_corpus()).resolves.toBeUndefined()
    expect(WORLD_CORPUS.worlds).toEqual([])
    expect(has_world_corpus()).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[world_corpus] world knowledge inert')
    expect(spy.mock.calls[0][0]).toContain('issue #106')
    spy.mockRestore()
  })

  test('the degrade shout is deduped — a second load does not re-scream', async () => {
    set_world_corpus_for_test()
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    await load_world_corpus()
    await load_world_corpus()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('a blob in the #196 contract shape parses to N worlds with rosters, gatherables and inversions', () => {
    set_world_corpus_for_test(fixture as WorldCorpusBlob)

    const { worlds } = WORLD_CORPUS
    expect(has_world_corpus()).toBe(true)
    expect(worlds.length).toBe(Object.keys(fixture).length) // both fixture wids joined the current lineage
    // sorted ascending by the world's low band (the JOBS/WORLDS ladder ordering)
    for (let i = 1; i < worlds.length; i += 1)
      expect(worlds[i - 1].band?.[0] ?? 0).toBeLessThanOrEqual(worlds[i].band?.[0] ?? 0)

    let roster = 0
    let gatherables = 0
    for (const world of worlds) {
      expect(world.id).toMatch(/^0x[0-9a-fA-F]{64}$/) // object id joined from the seed receipt, not the blob
      expect(world.name.length).toBeGreaterThan(0)
      // every roster mob inverts back to exactly this world (world_corpus_for_mob is the bestiary "found in")
      for (const mob of world.mobs) {
        roster += 1
        expect(mob.role).not.toBe('protector') // protectors are excluded from every roster
        expect(world_corpus_for_mob(mob.id).some((w) => w.id === world.id)).toBe(true)
        const facts = mob_corpus_of(mob.id)
        expect(facts?.spells).toBeDefined() // authored xp/spell facts resolve for a roster template id
      }
      // every gatherable inverts back to this world (items-tab "found in")
      for (const resource of world.resources) {
        gatherables += 1
        expect(resource.id).toMatch(/^0x[0-9a-fA-F]{64}$/)
        expect(world_corpus_for_resource(resource.id).some((w) => w.id === world.id)).toBe(true)
      }
      // the dungeon-key slug resolved to a minted template id (DungeonsModal deep-link, no fetch)
      expect(world.dungeon_key_template_id).toMatch(/^0x[0-9a-fA-F]{64}$/)
    }
    expect(roster).toBeGreaterThan(0)
    expect(gatherables).toBeGreaterThan(0)

    // the JOBS ladders projected over the same authored rows, each row carrying the on-chain gather-xp
    const farmer = gather_ladder_of('FARMER')
    expect(farmer.length).toBeGreaterThan(0)
    for (const row of farmer) expect(row.xp).toBe(10 + Math.floor(row.level / 2))
  })

  test('set_world_corpus_for_test() with no blob resets to pristine (empty + retryable)', () => {
    set_world_corpus_for_test(fixture as WorldCorpusBlob)
    expect(has_world_corpus()).toBe(true)
    set_world_corpus_for_test()
    expect(WORLD_CORPUS.worlds).toEqual([])
    expect(has_world_corpus()).toBe(false)
  })
})
