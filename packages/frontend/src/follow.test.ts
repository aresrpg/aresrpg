// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// follow.test.ts — proves world_to_biome resolves the REAL per-world chain biome (not the flat DEFAULT_BIOME
// 'arctic' every non-dungeon caller got before tonight's fix), and that those biome strings fan out across
// ambient_music's owned tracks — different worlds must SOUND different.
//
// world_to_biome delegates to world-shell/world_biome.js's seed-receipt projection — the SAME synchronous
// resolver embed_voxel.js's engine-recipe pick uses, without pulling the all-kinds encyclopedia at boot.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { T62_WORLDS } from './chain/deployment'
import { track_for_biome } from './game/core/audio/ambient_music.js'
import { _reset_for_test } from './world-shell/world_biome.js'
import { use_follow, world_to_biome } from './follow'

const REAL_WORLDS = T62_WORLDS.filter(
  (world): world is (typeof T62_WORLDS)[number] & { biome: string } => world.biome != null
)

/** Poll a predicate until true (or give up) — used to await follow()'s fire-and-forget async biome resolve
 *  without a brittle fixed setTimeout. Every step is a cheap macrotask; the loop exits the instant state lands. */
async function wait_for(predicate: () => boolean, tries = 200) {
  for (let i = 0; i < tries && !predicate(); i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  _reset_for_test()
})

describe('world_to_biome — real per-world chain biome (not the flat arctic default)', () => {
  test('resolves the REAL biome for 5 distinct seeded worlds (spot check)', async () => {
    for (const w of [REAL_WORLDS[0], REAL_WORLDS[4], REAL_WORLDS[9], REAL_WORLDS[14], REAL_WORLDS[19]]) {
      expect(await world_to_biome(w.id)).toBe(w.biome)
    }
  })

  test('null world_id -> the DEFAULT_BIOME fallback (arctic), no fetch needed', async () => {
    expect(await world_to_biome(null)).toBe('arctic')
  })

  test('an unseeded/unknown world_id -> the DEFAULT_BIOME fallback', async () => {
    expect(await world_to_biome('0xnot-a-seeded-world')).toBe('arctic')
  })
})

describe('world -> biome -> track — the full audible-per-biome pipeline', () => {
  test('every one of the 20 real seeded worlds resolves its OWN biome, fanning out across >=4 distinct tracks', async () => {
    const table = await Promise.all(
      REAL_WORLDS.map(async (w) => {
        const biome = await world_to_biome(w.id)
        return { world: w.label, biome, track: track_for_biome(biome) }
      })
    )

    // every world resolves its real chain biome, never the arctic fallback masking a lookup miss
    for (let i = 0; i < table.length; i++) expect(table[i].biome).toBe(REAL_WORLDS[i].biome)

    const distinct_tracks = new Set(table.map((r) => r.track))
    expect(distinct_tracks.size).toBeGreaterThanOrEqual(4)
  })
})

describe('use_follow().follow — threads the real world_id into the armed zone biome', () => {
  afterEach(() => use_follow.getState().unfollow())

  test("follow(character, world_id) resolves + stores that world's real (non-arctic) biome", async () => {
    const non_arctic = REAL_WORLDS.find((w) => w.biome !== 'archipelago' && track_for_biome(w.biome) !== 'arctic')!
    use_follow.getState().follow(null, non_arctic.id)
    await wait_for(() => use_follow.getState().biome !== null)
    expect(use_follow.getState().world_id).toBe(non_arctic.id)
    expect(use_follow.getState().biome).toBe(non_arctic.biome)
  })

  test('a later follow() for a different world wins over a slower in-flight resolve (no stale biome apply)', async () => {
    const [, first, second] = REAL_WORLDS
    use_follow.getState().follow(null, first.id)
    use_follow.getState().follow(null, second.id) // fired before the first resolve can land
    await wait_for(() => use_follow.getState().biome !== null)
    expect(use_follow.getState().world_id).toBe(second.id)
    expect(use_follow.getState().biome).toBe(second.biome)
  })
})
