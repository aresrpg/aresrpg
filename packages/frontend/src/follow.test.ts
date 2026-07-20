// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// follow.test.ts — proves world_to_biome resolves the REAL per-world chain biome (not the flat DEFAULT_BIOME
// 'arctic' every non-dungeon caller got before tonight's fix), and that those biome strings fan out across
// ambient_music's owned tracks — different worlds must SOUND different.
//
// world_to_biome now delegates to world-shell/world_biome.js's resolve_world_biome — the SAME /v1
// encyclopedia-worlds resolver embed_voxel.js's engine-recipe pick already uses (one home, no second lookup
// table — REUSE-FIRST, world_biome.js itself is untouched). That module's only I/O is rpc/client.ts's
// get_encyclopedia, so this mocks global.fetch exactly like address_name.test.tsx's get_names coverage
// (ZERO mock.module — process-global collision law) instead of touching the shared rpc/client module.
//
// The 20 seeded world_id -> biome pairs mirror chain/deployment.ts's own T62_WORLDS / BIOME_ENGINE_RECIPE
// tables verbatim (that file's own comment: "the seed corpus... and the live /v1 encyclopedia worlds view
// were cross-checked and AGREE on every one of the 20 strings"). deployment.ts is READ-ONLY here (the
// wiring lane owns it) — just the source of the real world_id/biome pairing for this fixture; no /v1 server
// was reachable in this sandbox to curl directly.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { track_for_biome } from './game/core/audio/ambient_music.js'
import { _reset_for_test } from './world-shell/world_biome.js'
import { use_follow, world_to_biome } from './follow'

const REAL_WORLDS: { label: string; id: string; biome: string }[] = [
  {
    label: 'First Shore',
    id: '0x6efb4a45ac658b952f4a44a6008a925fc54360a4e6a73d5b7c6459427104c912',
    biome: 'archipelago',
  },
  {
    label: 'Verdant Hollow',
    id: '0x3cff87c2333044ff1f87c228be382dbcdde67330480b7952513b9cdb883a7036',
    biome: 'canyon',
  },
  {
    label: 'Emberfall Steppe',
    id: '0xbf98b893841a1bb4cd27084a5e3ba285fc18732c51f3f448650c5ab9ef0f5180',
    biome: 'ash_steppe',
  },
  { label: 'Mistral Heights', id: '0xc346c9c578c379195ab51a47de8fe712338832c7b110214f145d1bff91e3eae8', biome: 'mesa' },
  { label: 'Drowned Fen', id: '0xf262ba5e1d180273cd53af00594770919e8ab6b5c4a4fb6e2b5e591d6f0bf204', biome: 'swamp' },
  {
    label: 'Pandora Reach',
    id: '0x67a575f1984cef935a4813ffa8464a4cfe4b32a063b0071c530a78f5e48237d5',
    biome: 'floating_islands',
  },
  {
    label: 'Cinderforge Depths',
    id: '0x32072009dc8bad9b7f8c4aba956af9ba2a2d6083934707bbddfac930b1340ae2',
    biome: 'magma_foundry',
  },
  { label: 'Palewood', id: '0x57a0e116d813d0bff7962cbe7dfe8737a81dd930f0e9f7123ae26f05e5797c05', biome: 'pale_forest' },
  {
    label: 'Coral Throne',
    id: '0x5f965b61478ce53ef6aeb47ce4f12fb8ebd519a47d1e6eab11711d979cbc9f83',
    biome: 'reef_city',
  },
  {
    label: 'Sunspire Dunes',
    id: '0xd375ac77776a9bd8b39ad92564fc527c5c33ff906f2098461243594288f2070c',
    biome: 'glass_desert',
  },
  { label: 'Rootheart', id: '0xede08b8f966113bb01f55c5b46b37f75d4bd643a91ab835c856146c0100d387c', biome: 'world_tree' },
  {
    label: 'Static Fields',
    id: '0x8319b72e07ce3a4d8134268ac766781409557fc21ad4f0f64898fc67106541c7',
    biome: 'storm_plateau',
  },
  {
    label: 'Mirrormere',
    id: '0xfd156b2331b1e220eea7105c4835cebdfc30915ccd53e23d2f4273ddf33a4815',
    biome: 'frost_lake',
  },
  {
    label: 'Charnel Marches',
    id: '0x5ae97a34dbabf9fc64ca58199f719d2973212d41b5e0a930eb8c47aefb89727d',
    biome: 'ashen_marsh',
  },
  {
    label: 'Silent Atoll',
    id: '0x9d135edb36ae3a893374819fb7382e7740e4e79b680b3d0fdbaa1a63ea365cd4',
    biome: 'dead_calm_sea',
  },
  {
    label: 'The Sundering',
    id: '0x7b19aa1577c266ffb2ac92fc52720560f592e33e454557e3a4d33af04a512992',
    biome: 'sundered_waste',
  },
  {
    label: 'Obsidian Choir',
    id: '0xe5ee3aaa8b94090b8b7890e24399d619f2acbd1f994896bec027eda45003d1bf',
    biome: 'volcanic_cathedral',
  },
  {
    label: 'Abyssal Weald',
    id: '0xd450ef1b9d469a8228293567bc52e18b78785b6972855220c255c86b8a7fbc47',
    biome: 'abyssal_forest',
  },
  {
    label: 'Hollow Crown',
    id: '0x72e849c4c4ab57c21c16b23fa6ab8708fe558110e22ef55ed156b7e9f55e4812',
    biome: 'celestial_ruin',
  },
  {
    label: 'Zenith Scar',
    id: '0xb4d7860029fa62ed7de5a9c8643aaa0ba63cbe41ac2fa7cf2f7cc8ffbc8563c3',
    biome: 'fractured_zenith',
  },
]

const original_fetch = global.fetch

// The real /v1/encyclopedia?kind=worlds row shape (rpc/views.ts RpcEncyclopedia.worlds: {world_id, seed, biome}).
function mock_worlds_endpoint() {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v1/encyclopedia')) {
      const worlds = REAL_WORLDS.map((w, i) => ({ world_id: w.id, seed: i, biome: w.biome }))
      return new Response(JSON.stringify({ items: [], mobs: [], worlds, recipes: [] }), { status: 200 })
    }
    throw new Error(`unexpected fetch in follow.test.ts: ${url}`)
  }) as unknown as typeof fetch
}

/** Poll a predicate until true (or give up) — used to await follow()'s fire-and-forget async biome resolve
 *  without a brittle fixed setTimeout. Every step is a cheap macrotask; the loop exits the instant state lands. */
async function wait_for(predicate: () => boolean, tries = 200) {
  for (let i = 0; i < tries && !predicate(); i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  _reset_for_test()
  mock_worlds_endpoint()
})

afterEach(() => {
  global.fetch = original_fetch
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
