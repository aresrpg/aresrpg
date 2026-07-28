// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// follow.test.ts — proves world_to_biome resolves the REAL per-world chain biome (not the flat DEFAULT_BIOME
// 'arctic' every non-dungeon caller got before tonight's fix), and that those biome strings fan out across
// ambient_music's owned tracks — different worlds must SOUND different.
//
// world_to_biome delegates to world-shell/world_biome.js, which resolves the World object's own chain biome
// off the LIVE worlds catalog (#1510 — the value was briefly pinned to the build-time seed receipt, a second
// home for a chain field). The catalog read is spied here; the biomes it serves are the receipt's own, so
// this stays a test of the biome -> track fan-out and never of the network.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import * as rpc_client from './rpc/client'
import { seed_manifest } from './content/seed_manifest'
import { T62_WORLDS } from './chain/deployment'
import { track_for_biome } from './game/core/audio/ambient_music.js'
import { _reset_for_test } from './world-shell/world_biome.js'
import { _reset_for_test as _reset_catalog } from './world-shell/world_catalog.js'
import { use_follow, world_to_biome } from './follow'

const biome_by_id = new Map(seed_manifest.worlds.map((world) => [world.id, world.biome ?? null]))
const REAL_WORLDS = T62_WORLDS.flatMap((world) => {
  const biome = biome_by_id.get(world.id)
  return biome ? [{ ...world, biome }] : []
})

const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia')
get_encyclopedia.mockImplementation(
  async () =>
    ({
      items: [],
      mobs: [],
      recipes: [],
      worlds: REAL_WORLDS.map((world) => ({ world_id: world.id, seed: '1', biome: world.biome, required_level: 1 })),
    }) as never
)
afterAll(() => {
  get_encyclopedia.mockRestore()
})

/** Poll a predicate until true (or give up) — used to await follow()'s fire-and-forget async biome resolve
 *  without a brittle fixed setTimeout. Every step is a cheap macrotask; the loop exits the instant state lands. */
async function wait_for(predicate: () => boolean, tries = 200) {
  for (let i = 0; i < tries && !predicate(); i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  _reset_for_test()
  _reset_catalog()
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
