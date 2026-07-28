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
  use_world_corpus,
  world_corpus_for_mob,
  world_corpus_for_resource,
  type WorldCorpusBlob,
} from './world_corpus'
import fixture from './world_corpus.fixture.json'

afterEach(() => set_world_corpus_for_test()) // reset module state (pristine, retryable) between tests

describe('world corpus runtime loader (#196)', () => {
  test('absent class (unpublished — asset_url → null) → ONE console.error, zero worlds, never throws', async () => {
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

// THE EMPTY→POPULATED TRANSITION (the cache-law class). The corpus lands SECONDS after any surface that
// reads it has mounted, so the cache cannot be a module `let`: a React consumer that read it once would
// stay frozen on the boot-empty derivation forever (exactly what the simulator's mob picker did — it
// opened "NO RESULTS FOUND · 0/0" on a corpus that had, additionally, no loader wired at all).
// These pin the channel: a pristine cache is honestly LOADING (not "empty"), and settling it NOTIFIES.
describe('the corpus cache is a subscribable store, not frozen module state', () => {
  test('pristine reads as LOADING — absence is never published as emptiness', () => {
    set_world_corpus_for_test()
    expect(use_world_corpus.getState().status).toBe('loading')
    expect(use_world_corpus.getState().worlds).toEqual([])
  })

  test('the blob landing notifies subscribers with the populated corpus (a mounted surface re-renders)', () => {
    set_world_corpus_for_test()
    const seen: { count: number; status: string }[] = []
    const stop = use_world_corpus.subscribe((state) => seen.push({ count: state.worlds.length, status: state.status }))
    set_world_corpus_for_test(fixture as WorldCorpusBlob)
    stop()
    expect(seen).toEqual([{ count: Object.keys(fixture).length, status: 'ready' }])
  })

  test('a degraded load settles INERT, still retryable — a later load can still populate it', async () => {
    set_world_corpus_for_test()
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    await load_world_corpus() // no manifest row in the offline test manifest → the degrade path
    expect(use_world_corpus.getState().status).toBe('inert') // settled, so the UI stops saying LOADING
    spy.mockRestore()
    set_world_corpus_for_test(fixture as WorldCorpusBlob) // …and a later landing still populates
    expect(use_world_corpus.getState().status).toBe('ready')
    expect(has_world_corpus()).toBe(true)
  })
})

// SEAM S2 (docs/design/simulator_rebuild_spec.md §3): the Fight-side mob truth (MobSpec's base_hp/ap/mp/stats —
// mob.move:52-62) reaches the client ONLY through this blob, and the projection used to drop it on the floor.
// The authored vocabulary is the seeder's (`hp`/`ap`/`mp`/`stats`, defaults 30/6/3 — move/scripts/
// apply_xp_payload.mjs `desired_state_by_key`); it surfaces under the CHAIN names the consumers read.
// Both halves are pinned: carried when authored, ABSENT (never zero-filled) when not, so a consumer can tell
// "unpublished" from "published as 0" and degrade loudly instead of presenting a fabricated combat block.
const with_mob_fields = (blob: WorldCorpusBlob, wid: string, key: string, fields: Record<string, unknown>) => ({
  ...blob,
  [wid]: { ...blob[wid], mobs: blob[wid].mobs.map((mob) => (mob.key === key ? { ...mob, ...fields } : mob)) },
})

const mob_named = (name: string) => WORLD_CORPUS.worlds.flatMap((world) => world.mobs).find((mob) => mob.name === name)

describe('mob combat block (seam S2)', () => {
  test('an authored combat block projects onto the roster row under the chain names', () => {
    set_world_corpus_for_test(
      with_mob_fields(fixture as WorldCorpusBlob, '01_first_shore', 'alley_bunny', {
        hp: 42,
        ap: 5,
        mp: 4,
        stats: { strength: 12, fire_resistance: 3 },
      })
    )
    const bunny = mob_named('Alley Bunny')
    expect(bunny).toBeDefined()
    expect(bunny?.base_hp).toBe(42)
    expect(bunny?.ap).toBe(5)
    expect(bunny?.mp).toBe(4)
    expect(bunny?.stats).toEqual({ strength: 12, fire_resistance: 3 })
  })

  test('an unauthored combat block leaves the fields ABSENT — never a fabricated zero', () => {
    set_world_corpus_for_test(fixture as WorldCorpusBlob) // the captured blob carries no combat tail
    const bunny = mob_named('Alley Bunny')
    expect(bunny).toBeDefined()
    expect(bunny?.base_hp).toBeUndefined()
    expect(bunny?.ap).toBeUndefined()
    expect(bunny?.mp).toBeUndefined()
    expect(bunny?.stats).toBeUndefined()
  })
})
