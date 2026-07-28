// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1523): the ordinary GameWorldHost resident mount must resolve the bound world's live biome
// beside its checkpoint before mount_scene synchronously selects the engine recipe. The chain edge is a
// mocked /v1 worlds read; the cache and recipe translator are real.

import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { resolve_engine_recipe } from '../chain/deployment'
import * as rpc_client from '../rpc/client'

import { _reset_for_test as reset_world_catalog } from './world_catalog.js'
import { _reset_for_test, read_world_biome, resolve_world_biome } from './world_biome.js'

const WORLD = '0xemberfall'
const CHAIN_BIOME = 'ash_steppe'
const host_source = readFileSync(new URL('../GameWorldHost.tsx', import.meta.url), 'utf8')
let get_encyclopedia

beforeEach(() => {
  _reset_for_test()
  reset_world_catalog()
  get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia').mockResolvedValue({
    items: [],
    mobs: [],
    recipes: [],
    worlds: [{ world_id: WORLD, biome: CHAIN_BIOME, required_level: 3 }],
  })
})

afterEach(() => {
  get_encyclopedia.mockRestore()
})

test('ordinary resident mount resolves the chain biome before the engine recipe sync read', async () => {
  expect(read_world_biome(WORLD)).toBeNull()

  // Simulate the ordinary mount barrier: the checkpoint and biome reads settle before mount_scene enters
  // create_session and performs its synchronous cache read.
  await Promise.all([Promise.resolve(null), resolve_world_biome(WORLD)])
  const chain_biome_at_recipe_selection = read_world_biome(WORLD)
  expect(chain_biome_at_recipe_selection).toBe(CHAIN_BIOME)
  expect(resolve_engine_recipe({ url_biome: null, chain_biome: chain_biome_at_recipe_selection })).toBe('ember_steppe')
  expect(get_encyclopedia).toHaveBeenCalledWith('worlds', undefined)

  // Pin the real composition-root seam, not only the resolver in isolation.
  expect(host_source).toContain("import { resolve_world_biome } from './world-shell/world_biome.js'")
  const checkpoint_at = host_source.indexOf('resolve_checkpoint_spawn(char_id, world)')
  const biome_at = host_source.indexOf('resolve_world_biome(world)', checkpoint_at)
  const mount_at = host_source.indexOf('game.mount_scene(host.current, character', checkpoint_at)
  expect(checkpoint_at).toBeGreaterThan(-1)
  expect(biome_at).toBeGreaterThan(checkpoint_at)
  expect(mount_at).toBeGreaterThan(biome_at)
})
