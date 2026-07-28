// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD BIOME — resolve + cache the bound world's on-chain `biome` (world.move's `biome: String` field,
// WorldCreated.biome) for create_session's SYNCHRONOUS engine-recipe pick (embed_voxel.js, DECISIONS
// 2026-07-12 frontend wiring lane). Mirrors world_checkpoint.js's async-resolve-before-mount + sync-cache-
// read idiom: GameWorldHost awaits `resolve_world_biome` alongside the checkpoint resolve, right after the
// world binding confirms bound; create_session reads the cache synchronously (`read_world_biome`) when it
// picks the engine recipe via chain/deployment.ts's `resolve_engine_recipe`.
//
// The seed receipt already pins every live world id + biome synchronously. Reading that boot-resident
// projection avoids pulling the all-kinds /v1 encyclopedia payload before the player visits its route.

import { T62_WORLDS } from '../chain/deployment'

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
  const biome = T62_WORLDS.find((world) => world.id === world_id)?.biome ?? null
  _cache.set(world_id, biome)
  return biome
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
