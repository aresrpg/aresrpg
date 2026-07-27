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

import { invalidate_world_position, read_world_chain_anchor, spawns_input } from './spawns_adapter.js'

// ── async resolve + synchronous cache ────────────────────────────────────────────────────────────────────────
// GameWorldHost awaits `resolve_checkpoint_spawn` right before the resident mount; create_session reads the
// cached world-position synchronously (`read_checkpoint_spawn`) when it chooses the boot spawn.

/** @typedef {{x:number,z:number,time_ms:number|null}} CheckpointAnchor */
/** @type {Map<string, CheckpointAnchor | {x:number,z:number} | null>} */
const _cache = new Map()
/**
 * A receipt without a checkpoint clock is a barrier, not a canonical persistence anchor. A direct read may
 * cross it only at the receipt-proven position with a newer revision, or (for rejoin) the same revision.
 * @typedef {{
 *   token:number,x:number,z:number,chain_x:number|null,chain_z:number|null,
 *   after_time_ms:number|null,allow_equal:boolean
 * }} ReceiptBarrier
 */
/** @type {Map<string, ReceiptBarrier>} */
const _receipt_barriers = new Map()
/** @type {Map<string, number>} */
const _receipt_epochs = new Map()
/** @type {Map<string, CheckpointAnchor>} raw unsigned chain rows accepted from direct reads */
const _accepted_chain_rows = new Map()
const _key = (character_id, world_id) => `${character_id}:${world_id}`
const finite_position = (position) =>
  !!position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z))
const same_position = (a, b) =>
  finite_position(a) && finite_position(b) && Number(a.x) === Number(b.x) && Number(a.z) === Number(b.z)
const checkpoint_time = (position) => {
  const revision = Number(position?.time_ms)
  return Number.isFinite(revision) && revision > 0 ? revision : null
}
const with_checkpoint_time = (position, time_ms) => {
  if (!position) return null
  return {
    x: Number(position.x),
    z: Number(position.z),
    time_ms: checkpoint_time({ time_ms }),
  }
}

/* eslint-disable functional/no-let -- request generations are confined to this async chain-read edge. */
let receipt_token = 0
let lifecycle_epoch = 0
/* eslint-enable functional/no-let */

const receipt_epoch = (key) => _receipt_epochs.get(key) ?? 0
const bump_receipt_epoch = (key) => {
  const next = receipt_epoch(key) + 1
  _receipt_epochs.set(key, next)
  return next
}
const request_is_current = (key, epoch, lifecycle) => lifecycle === lifecycle_epoch && epoch === receipt_epoch(key)
const current_cache = (key) => _cache.get(key) ?? null
const max_checkpoint_time = (...values) => {
  const revisions = values.map((time_ms) => checkpoint_time({ time_ms })).filter((time_ms) => time_ms !== null)
  return revisions.length ? Math.max(...revisions) : null
}

const canonical_read_is_current = (key, candidate, raw) => {
  const revision = checkpoint_time(candidate)
  if (!finite_position(candidate) || revision === null) return false
  const barrier = _receipt_barriers.get(key)
  if (barrier) {
    const receipt_matches =
      same_position(candidate, barrier) ||
      (finite_position(raw) && Number(raw.x) === barrier.chain_x && Number(raw.z) === barrier.chain_z)
    if (!receipt_matches) return false
    if (barrier.after_time_ms !== null) {
      if (revision < barrier.after_time_ms) return false
      if (revision === barrier.after_time_ms) return barrier.allow_equal
    }
  }
  const current = current_cache(key)
  const current_revision = checkpoint_time(current)
  if (current_revision === null) return true
  if (revision < current_revision) return false
  const accepted_raw = _accepted_chain_rows.get(key)
  return (
    revision > current_revision ||
    same_position(candidate, current) ||
    (checkpoint_time(accepted_raw) === revision && same_position(raw, accepted_raw))
  )
}

const default_sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })

/**
 * Read + CACHE the SIGNED world-space checkpoint `{ x, z }` for (character, world). Null when no checkpoint
 * exists (pre-first-join) or on any read failure — the caller falls back to WORLD_SPAWN. Idempotent; safe to
 * await before every resident mount. Every successful read also ferries the CHAIN checkpoint into the spawns
 * core (source 'read') so the live atom's checkpoint/hunt-zone facts seed from chain truth at boot.
 * PIPELINE LAW — below-floor never regresses a receipt-proven fact: a MISS here (no checkpoint found) can be a
 * transient chain-direct read lag racing the very write it's trying to observe (the "kiosk not indexed" family,
 * here for the checkpoint DF) — right behind a join/search whose OWN receipt already seeded this key via
 * `seed_checkpoint_spawn`. A miss only writes null when the key was never seeded; it never overwrites an
 * existing entry back to null. A signed read adopts only when its checkpoint revision is not below the
 * current receipt/canonical floor; equal revisions must agree on position.
 * @param {string} character_id @param {string} world_id
 * @returns {Promise<CheckpointAnchor | null>}
 */
export async function resolve_checkpoint_spawn(character_id, world_id) {
  if (!character_id || !world_id) return null
  const key = _key(character_id, world_id)
  const epoch = receipt_epoch(key)
  const lifecycle = lifecycle_epoch
  try {
    const cp = await read_checkpoint(character_id, world_id)
    if (!request_is_current(key, epoch, lifecycle)) return current_cache(key)
    if (!cp) {
      if (!_cache.has(key)) _cache.set(key, null)
      return current_cache(key)
    }
    const sdk = await get_sdk()
    const doc = await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null)
    if (!request_is_current(key, epoch, lifecycle)) return current_cache(key)
    const world_pos = with_checkpoint_time(checkpoint_to_world(cp, doc), cp.time_ms)
    const raw = with_checkpoint_time(cp, cp.time_ms)
    if (!canonical_read_is_current(key, world_pos, raw)) return current_cache(key)
    _cache.set(key, world_pos)
    _accepted_chain_rows.set(key, raw)
    _receipt_barriers.delete(key)
    spawns_input({
      type: 'checkpoint_resolved',
      character_id,
      world_id,
      x: Number(cp.x),
      z: Number(cp.z),
      world_position: world_pos,
      source: 'read',
    })
    return world_pos
  } catch (error) {
    game_log('checkpoint', 'spawn resolve failed — falling back to WORLD_SPAWN', error)
    if (!request_is_current(key, epoch, lifecycle)) return current_cache(key)
    if (!_cache.has(key)) _cache.set(key, null)
    return current_cache(key)
  }
}

/**
 * Install a SIGNED receipt-proven world position. A receipt clock makes it canonical immediately. Without a
 * clock it becomes a barrier and bounded direct reads reconcile it: the read must match the receipt position
 * at a newer revision; rejoin may also accept an equal revision.
 * @param {string} character_id @param {string} world_id
 * @param {{
 *   x:number,z:number,time_ms?:number|null,after_time_ms?:number|null,allow_equal?:boolean,
 *   chain_x?:number|null,chain_z?:number|null
 * }} proof
 * @param {{retry_delays?:number[],sleep?:(ms:number)=>Promise<void>}} [options]
 * @returns {Promise<CheckpointAnchor | null>}
 */
export async function confirm_checkpoint_spawn(character_id, world_id, proof, options = {}) {
  if (!character_id || !world_id || !proof) return null
  const x = Number(proof.x)
  const z = Number(proof.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const key = _key(character_id, world_id)
  const prior = current_cache(key)
  const prior_revision = checkpoint_time(prior)
  const exact_revision = checkpoint_time(proof)
  const claimed_floor = checkpoint_time({ time_ms: proof.after_time_ms })
  const existing_barrier = _receipt_barriers.get(key)
  const floor = max_checkpoint_time(prior_revision, claimed_floor, existing_barrier?.after_time_ms)

  if (exact_revision !== null) {
    if (
      (floor !== null && exact_revision < floor) ||
      (prior_revision !== null && exact_revision === prior_revision && !same_position(proof, prior))
    )
      return prior
    bump_receipt_epoch(key)
    _receipt_barriers.delete(key)
    _accepted_chain_rows.delete(key)
    const exact = { x, z, time_ms: exact_revision }
    _cache.set(key, exact)
    return exact
  }

  bump_receipt_epoch(key)
  _receipt_barriers.delete(key)
  _accepted_chain_rows.delete(key)
  const receipt = { x, z, time_ms: null }
  _cache.set(key, receipt)
  const chain_x = proof.chain_x == null ? null : Number(proof.chain_x)
  const chain_z = proof.chain_z == null ? null : Number(proof.chain_z)
  const barrier = {
    token: ++receipt_token,
    x,
    z,
    chain_x: Number.isFinite(chain_x) ? chain_x : null,
    chain_z: Number.isFinite(chain_z) ? chain_z : null,
    after_time_ms: floor,
    allow_equal: proof.allow_equal === true,
  }
  _receipt_barriers.set(key, barrier)
  const delays = options.retry_delays ?? [250, 750, 1_500, 3_000]
  const sleep = options.sleep ?? default_sleep
  for (let attempt = 0; ; attempt += 1) {
    if (_receipt_barriers.get(key)?.token !== barrier.token) return current_cache(key)
    await resolve_checkpoint_spawn(character_id, world_id)
    if (_receipt_barriers.get(key)?.token !== barrier.token) return current_cache(key)
    if (attempt >= delays.length) return current_cache(key)
    await sleep(delays[attempt])
  }
}

/**
 * Ferry one active search/gather/claim receipt through the reducer door, then reconcile its position with the
 * checkpoint cache. Capturing the prior revision before dispatch is essential because the receipt invalidates
 * that adapter anchor synchronously.
 * @param {{type:string,character_id:string,world_id:string,x:number,z:number,time_ms?:number|null} & Record<string, any>} input
 */
export function publish_checkpoint_receipt(input) {
  const { character_id, world_id, x, z, time_ms } = input
  const after_time_ms = read_world_chain_anchor(character_id, world_id)?.time_ms ?? null
  spawns_input(input)
  return confirm_checkpoint_spawn(character_id, world_id, { x, z, time_ms, after_time_ms })
}

/** Narrow renderer seam for the timestamp-less MobGroupClaimed checkpoint receipt. */
export function publish_claim_checkpoint_receipt(character_id, world_id, key, fight_id, row) {
  return publish_checkpoint_receipt({
    type: 'claim_receipt',
    character_id,
    world_id,
    key,
    fight_id,
    x: Number(row?.x),
    z: Number(row?.z),
  })
}

/**
 * Seed the boot cache from a JOIN tx's OWN `WorldJoined` proof. The event uses unsigned chain coordinates, so
 * this edge converts it once, deletes the previous visit's local row, and starts receipt reconciliation.
 * @param {string} character_id @param {string} world_id
 * @param {{x:number,z:number,time_ms?:number|null,first_join?:boolean}} chain_pos UNSIGNED chain coords
 * @returns {Promise<CheckpointAnchor | null>}
 */
export async function seed_checkpoint_spawn(character_id, world_id, chain_pos) {
  if (!character_id || !world_id || !finite_position(chain_pos)) return null
  await invalidate_world_position(character_id, world_id)
  try {
    const sdk = await get_sdk()
    const doc = await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null)
    const world_pos = with_checkpoint_time(checkpoint_to_world(chain_pos, doc), chain_pos.time_ms)
    if (!world_pos) return null
    const prior_revision = checkpoint_time(current_cache(_key(character_id, world_id)))
    const confirmation = confirm_checkpoint_spawn(character_id, world_id, {
      ...world_pos,
      after_time_ms: prior_revision,
      allow_equal: chain_pos.first_join !== true,
      chain_x: Number(chain_pos.x),
      chain_z: Number(chain_pos.z),
    })
    spawns_input({
      type: 'checkpoint_resolved',
      character_id,
      world_id,
      x: Number(chain_pos.x),
      z: Number(chain_pos.z),
      world_position: world_pos,
      source: 'receipt',
    })
    void confirmation
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
 * @returns {CheckpointAnchor | {x:number,z:number} | null}
 */
export function read_checkpoint_spawn(character_id, world_id) {
  return _cache.get(_key(character_id, world_id)) ?? null
}

/**
 * Commit an arrived owned follower's SESSION position into the existing checkpoint/spawn cache. Transit is a
 * session presentation protocol, so this deliberately creates no new PTB shape and never publishes into the
 * active character's spawns atom. The returned receipt is the edge acknowledgement that re-enters the group
 * reducer as `follow_checkpoint_written`; only that receipt makes the follower render beside its leader.
 * @param {string} character_id @param {string} world_id @param {{x:number,z:number}} world_pos
 * @returns {Promise<{character_id:string,world_id:string,position:{x:number,z:number}}>}
 */
export async function write_follow_checkpoint(character_id, world_id, world_pos) {
  const x = Number(world_pos?.x)
  const z = Number(world_pos?.z)
  if (!character_id || !world_id || !Number.isFinite(x) || !Number.isFinite(z))
    throw new Error('Invalid follow checkpoint')
  const position = { x, z }
  _cache.set(_key(character_id, world_id), position)
  return { character_id, world_id, position }
}

/** Test-only reset of the module cache. */
export function _reset_for_test() {
  lifecycle_epoch += 1
  _cache.clear()
  _receipt_barriers.clear()
  _receipt_epochs.clear()
  _accepted_chain_rows.clear()
}
