// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD BIOME — resolve + cache the bound world's on-chain `biome` (world.move's `biome: String` field,
// WorldCreated.biome) for create_session's SYNCHRONOUS engine-recipe pick (embed_voxel.js, DECISIONS
// 2026-07-12 frontend wiring lane). Mirrors world_checkpoint.js's async-resolve-before-mount + sync-cache-
// read idiom: GameWorldHost awaits `resolve_world_biome` alongside the checkpoint resolve, right after the
// world binding confirms bound; create_session reads the cache synchronously (`read_world_biome`) when it
// picks the engine recipe via chain/deployment.ts's `resolve_engine_recipe`.
//
// /v1 is the read layer (CLAUDE.md "Reads through /v1" — chain-direct is for tx pre-flight only):
// get_encyclopedia('worlds') serves exactly `{ world_id, seed, biome }` per seeded world (world_levels.js)
// and is cheap — `?kind=worlds` skips the items/mobs/recipes reads server-side (packages/rpc/api/views.js
// handle_encyclopedia) — so this never fetches more than the small seeded-worlds set (1 today, ≤20 live).

import { get_encyclopedia } from '../rpc/client'
import { game_log } from '../core/log.js'

/** @type {Map<string, string | null>} */
const _cache = new Map()

/**
 * Read + CACHE `world_id`'s chain biome. Null on any read failure, an absent field, or a world not (yet)
 * in the encyclopedia (unseeded) — the translator (chain/deployment.ts `engine_recipe_for_biome`)
 * treats null as "unknown", never a crash. Idempotent; safe to await before every resident mount.
 * @param {string} world_id
 * @returns {Promise<string | null>}
 */
export async function resolve_world_biome(world_id) {
  if (!world_id) return null
  try {
    const { worlds } = await get_encyclopedia('worlds')
    const biome = worlds.find((w) => w.world_id === world_id)?.biome ?? null
    _cache.set(world_id, biome)
    return biome
  } catch (error) {
    game_log('world-biome', 'biome resolve failed — the boot recipe falls back to default', error)
    _cache.set(world_id, null)
    return null
  }
}

/**
 * The cached chain biome for `world_id` — null when unresolved/absent. The synchronous read create_session
 * uses to pick the engine recipe.
 * @param {string} world_id
 * @returns {string | null}
 */
export function read_world_biome(world_id) {
  return _cache.get(world_id) ?? null
}

/** Test-only reset of the module cache. */
export function _reset_for_test() {
  _cache.clear()
}
