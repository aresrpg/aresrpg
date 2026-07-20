// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Block-class → collision predicates (ENG-8). SINGLE SOURCE OF TRUTH for "what does the character
// collide with vs swim in", derived from the frozen block_registry classes so adding a block never
// needs a second edit here. Solid = the `solid` class (stone/dirt/grass/sand/log/leaves/snow/glowstone);
// liquid = `liquid` (water). `foliage` (cross-quads: grass tufts, flowers) and `air` are NON-solid —
// you walk through them, exactly as the mesher treats them as non-occluding. Pure; no three, no engine.

import { get_block_by_id } from '../config/block_registry.js'

// Precompute id→class once (registry is frozen at module load). Avoids a Map lookup object churn in
// the per-frame collision hot path — a plain array indexed by id, class stored as a small int enum.
const CLASS_SOLID = 1
const CLASS_LIQUID = 2
const CLASS_OTHER = 0

/** @type {Uint8Array} id → {0 other/air/foliage, 1 solid, 2 liquid}. Sized to the max id + 1. */
const CLASS_BY_ID = (() => {
  let max_id = 0
  for (let id = 0; id < 512; id += 1) if (get_block_by_id(id)) max_id = id
  const arr = new Uint8Array(max_id + 1)
  for (let id = 0; id <= max_id; id += 1) {
    const def = get_block_by_id(id)
    if (!def) continue
    if (def.class === 'solid') arr[id] = CLASS_SOLID
    else if (def.class === 'liquid') arr[id] = CLASS_LIQUID
    else arr[id] = CLASS_OTHER
  }
  return arr
})()

/**
 * @param {number} id block id
 * @returns {boolean} true iff this block is a SOLID collider
 */
export function id_is_solid(id) {
  return id >= 0 && id < CLASS_BY_ID.length && CLASS_BY_ID[id] === CLASS_SOLID
}

/**
 * @param {number} id block id
 * @returns {boolean} true iff this block is LIQUID (swimmable)
 */
export function id_is_liquid(id) {
  return id >= 0 && id < CLASS_BY_ID.length && CLASS_BY_ID[id] === CLASS_LIQUID
}

/**
 * Builds the `{ solid_at, liquid_at }` oracle pair the controller/collision consume, from a raw
 * `sample_block(x,y,z)→id` world query (engine.sample_block, or a synthetic test closure).
 * @param {(x: number, y: number, z: number) => number} sample_block
 * @returns {import('./controller.js').ControllerEnv}
 */
export function make_block_env(sample_block) {
  return {
    solid_at: (x, y, z) => id_is_solid(sample_block(x, y, z)),
    liquid_at: (x, y, z) => id_is_liquid(sample_block(x, y, z)),
  }
}
