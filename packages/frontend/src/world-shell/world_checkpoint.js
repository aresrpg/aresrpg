// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHECKPOINT SPAWN — the frontend EDGE (D770a W2): the async chain read + the synchronous boot cache.
// The pure half (checkpoint_to_world / resolve_boot_spawn / AGREE_RADIUS_M) lives in @aresrpg/world
// (packages/world/src/checkpoint.js) — one home for the boot-arbiter rule; this file owns exactly the
// effects: the RPC read, the (character, world)-keyed cache create_session reads synchronously, and the
// ferry that publishes every resolved checkpoint into the spawns core atom (checkpoint_resolved input).

import { get_world } from '@aresrpg/sdk/game'
import { checkpoint_to_world } from '@aresrpg/world/checkpoint'

import { read_checkpoint } from '../chain/read_checkpoint.js'
import { get_sdk } from '../chain/sdk'
import { game_log } from '../core/log.js'

import { spawns_input } from './spawns_adapter.js'

// ── async resolve + synchronous cache ────────────────────────────────────────────────────────────────────────
// GameWorldHost awaits `resolve_checkpoint_spawn` right before the resident mount; create_session reads the
// cached world-position synchronously (`read_checkpoint_spawn`) when it chooses the boot spawn.

/** @type {Map<string, { x: number, z: number } | null>} */
const _cache = new Map()
const _key = (character_id, world_id) => `${character_id}:${world_id}`

/**
 * Read + CACHE the SIGNED world-space checkpoint `{ x, z }` for (character, world). Null when no checkpoint
 * exists (pre-first-join) or on any read failure — the caller falls back to WORLD_SPAWN. Idempotent; safe to
 * await before every resident mount. Every successful read also ferries the CHAIN checkpoint into the spawns
 * core (source 'read') so the live atom's checkpoint/hunt-zone facts seed from chain truth at boot.
 * PIPELINE LAW — below-floor never regresses a receipt-proven fact: a MISS here (no checkpoint found) can be a
 * transient chain-direct read lag racing the very write it's trying to observe (the "kiosk not indexed" family,
 * here for the checkpoint DF) — right behind a join/search whose OWN receipt already seeded this key via
 * `seed_checkpoint_spawn`. A miss only writes null when the key was never seeded; it never overwrites an
 * existing entry back to null. A confirmed checkpoint always adopts (chain truth wins once it actually answers).
 * @param {string} character_id @param {string} world_id
 * @returns {Promise<{ x: number, z: number } | null>}
 */
export async function resolve_checkpoint_spawn(character_id, world_id) {
  if (!character_id || !world_id) return null
  const key = _key(character_id, world_id)
  try {
    const cp = await read_checkpoint(character_id, world_id)
    if (!cp) {
      if (!_cache.has(key)) _cache.set(key, null)
      return _cache.get(key) ?? null
    }
    const sdk = await get_sdk()
    const doc = await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null)
    const world_pos = checkpoint_to_world(cp, doc)
    _cache.set(key, world_pos)
    spawns_input({ type: 'checkpoint_resolved', world_id, x: Number(cp.x), z: Number(cp.z), source: 'read' })
    return world_pos
  } catch (error) {
    game_log('checkpoint', 'spawn resolve failed — falling back to WORLD_SPAWN', error)
    if (!_cache.has(key)) _cache.set(key, null)
    return _cache.get(key) ?? null
  }
}

/**
 * Seed the boot-spawn cache straight from a JOIN tx's OWN receipt (WorldJoined carries the proven chain
 * position — see game/core/world_joined.js) — the pipeline-law fast path: the client already holds this proof
 * the instant its own tx confirms, so the synchronous boot-spawn read (`read_checkpoint_spawn`) never has to
 * wait on — or race — the separate chain-direct re-read above. Idempotent and order-independent with
 * `resolve_checkpoint_spawn`: a later chain read still adopts on confirmation, and a later miss never erases
 * this (the non-regression rule above).
 * @param {string} character_id @param {string} world_id @param {{ x: number, z: number }} chain_pos UNSIGNED chain coords
 * @returns {Promise<{ x: number, z: number } | null>}
 */
export async function seed_checkpoint_spawn(character_id, world_id, chain_pos) {
  if (!character_id || !world_id || !chain_pos) return null
  const x = Number(chain_pos.x)
  const z = Number(chain_pos.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  try {
    const sdk = await get_sdk()
    const doc = await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null)
    const world_pos = checkpoint_to_world({ x, z }, doc)
    if (!world_pos) return null
    _cache.set(_key(character_id, world_id), world_pos)
    spawns_input({ type: 'checkpoint_resolved', world_id, x, z, source: 'receipt' })
    return world_pos
  } catch (error) {
    game_log('checkpoint', 'receipt-seeded spawn resolve failed', error)
    return null
  }
}

/**
 * The cached SIGNED world-space checkpoint `{ x, z }` for (character, world) — null when unresolved or absent.
 * The synchronous read create_session uses to seed the boot spawn.
 * @param {string} character_id @param {string} world_id
 * @returns {{ x: number, z: number } | null}
 */
export function read_checkpoint_spawn(character_id, world_id) {
  return _cache.get(_key(character_id, world_id)) ?? null
}

/** Test-only reset of the module cache. */
export function _reset_for_test() {
  _cache.clear()
}
