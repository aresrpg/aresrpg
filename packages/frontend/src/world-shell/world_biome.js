// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD BIOME — resolve + cache the bound world's on-chain `biome` (world.move's `biome: String` field,
// WorldCreated.biome) for create_session's SYNCHRONOUS engine-recipe pick (embed_voxel.js, DECISIONS
// 2026-07-12 frontend wiring lane): async resolve, then a sync cache read (`read_world_biome`) when
// create_session picks the recipe via chain/deployment.ts's `resolve_engine_recipe`.
//
// DRIFT, recorded not fixed (#1523): this header used to claim "GameWorldHost awaits resolve_world_biome
// alongside the checkpoint resolve, right after the world binding confirms bound". No such call site exists,
// and none has since before #1449 — `follow.ts` is the ONLY caller of `resolve_world_biome`, so on an
// ordinary mount `read_world_biome` finds an empty cache and the engine takes its default recipe.
//
// The biome is the World object's own chain field, so it is read from the LIVE worlds catalog
// (world_catalog.js — one home) and never from the build-time seed receipt, which freezes into the deployed
// bundle. The scoped `?kind=worlds` read is 2.9 KB, not the all-kinds envelope (#1510).

import { load_world_catalog } from './world_catalog.js'

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
    const worlds = await load_world_catalog()
    // A successful read that carries no biome for this world IS a resolved null (unseeded / Testlands).
    const biome = worlds.find((world) => world.id === world_id)?.biome ?? null
    _cache.set(world_id, biome)
    return biome
  } catch {
    // A read we could not make is not an answer — never cached, so the next resident mount retries.
    return _cache.get(world_id) ?? null
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
