// Block id → footstep TIMBRE bucket — subtle procedural sounds for steps depending on the block
// below. REUSE-FIRST: block_registry.js already tags every block with `sounds: { step, place, break }`
// (a footstep sound-set id — 'grass'|'dirt'|'stone'|'sand'|'water'|'wood'|'leaves'|'snow'|'none', 100%
// coverage, previously unconsumed anywhere in the app). This is the ONE home for "what does this block
// sound like" — no second id→material table duplicating block_registry's own classification.
//
// This module only maps that existing tag onto the smaller set of SYNTHESIS buckets footstep_sfx.js
// voices (soft/dull/sharp/granular/knock/muffled/wading). A tag with no bucket (a future block_registry
// step-tag this map hasn't caught up to yet) falls to 'dull' — the dirt default, never silence.

import { get_block_by_id } from '@aresrpg/engine3/player'

/** @typedef {'soft'|'dull'|'sharp'|'granular'|'knock'|'muffled'|'wading'} FootstepTimbre */

/** block_registry `sounds.step` tag → synthesis bucket. @type {Record<string, FootstepTimbre>} */
const STEP_TAG_TIMBRE = {
  grass: 'soft',
  leaves: 'soft',
  dirt: 'dull',
  stone: 'sharp',
  sand: 'granular',
  wood: 'knock',
  snow: 'muffled',
  water: 'wading',
}

/**
 * The footstep timbre for a ground block id (the block under/at the feet). Unknown/unmapped ids
 * (including 'none' = air — the on_ground gate should prevent this in practice) default to 'dull'.
 * @param {number} block_id
 * @returns {FootstepTimbre}
 */
export function resolve_footstep_class(block_id) {
  const tag = get_block_by_id(block_id)?.sounds?.step
  return STEP_TAG_TIMBRE[tag] ?? 'dull'
}

/**
 * True iff this block id sounds like water (block_registry `sounds.step === 'water'`) — the ONE liquid
 * check shared by footsteps (wading override) and water ambience (proximity probe).
 * @param {number} block_id
 * @returns {boolean}
 */
export function is_water_block(block_id) {
  return get_block_by_id(block_id)?.sounds?.step === 'water'
}
