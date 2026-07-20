// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BAKE-THEN-STAMP for procedural trees (perf lane 2026-07-12 — schematics were loading measurably
// faster than the procedural trees). generate_tree (tree_gen.js) runs the full recursive branch/canopy
// math; the live decorator ran it once PER FOREST COLUMN (every tree unique = the load cost that was
// felt, since a forest's columns are all distinct so the per-column memo almost never hits). This module
// makes proctrees behave like the schematics they replaced: bake N deterministic variants per species
// ONCE, then the chunk-gen pick is an O(1) hash→index into that baked set — synthesis runs N×species
// times per WORLD, not once per column. Each variant is a full generate_tree with a decorrelated seed, so
// the set spans the same age/silhouette range the per-column path produced — a forest reads as
// N-variants-per-species instead of all-unique (the same trade the schematic model made — a small stamped
// set — at strictly higher variety).
//
// DETERMINISM LAW (§3.7): the baked set is a PURE fn of (seed, species, n[, overrides]); the per-column
// pick is hash_column(wx, wz, seed^SALT) — same world seed ⇒ same variant in the same place, so the gen
// worker and the main thread agree. Integer hashing only, no render imports. n<=0 ⇒ the live per-column
// generate_tree (BYTE-IDENTICAL to the pre-bake v8 world — the `?baketrees=0` escape/A-B).
//
// DEFAULT ON since GEN_VERSION 9 (ruled, DECISIONS 07-12: "just pregen a lot of different trees and
// use them as schematics"): DEFAULT_WORLD_GEN_CONFIG.trees.baked_variants = 32, plus a hash-picked
// quarter-turn rotation at the decorator (stamper rotate_offset — the free 4× lever, so 32 variants read
// as ~128 distinct trees per species). The far impostor shell mirrors the variant pick's AGE via
// SALT_TREE_VARIANT + SALT_BAKE_WZ (far_trees_gen.js) so the ring seam stays exact.

import { hash_column } from '../deco_shared.js'

import { generate_tree } from './tree_gen.js'
import { resolve_species } from './species.js'

/** @typedef {import('../schematics/loader.js').ResolvedSchematic} ResolvedSchematic */
/** @typedef {import('./species.js').SpeciesParams} SpeciesParams */

/** Decorrelated salt for the per-column variant pick — folded with the world seed (same role as the
 *  stamper's SALT_SELECT), so two worlds pick different variants at the same column. */
export const SALT_TREE_VARIANT = 0x5f356495
/** Bake-seed marker (fed as the wz ARG of a variant's generate_tree — variant i = generate_tree(seed, i,
 *  SALT_BAKE_WZ, species)) so the baked corpus draws from its own decorrelated region of the generator's
 *  hash space, decoupled from real-world anchor columns. EXPORTED for the far-shell age mirror
 *  (far_trees_gen.js derives each variant's age from this exact stream without synthesizing). */
export const SALT_BAKE_WZ = 0x3c6ef372

/** Module-global bake cache — key `${seed}|${species}|${n}|${overrides}` → the N baked variants. A pure
 *  fn of the key (re-baking yields the identical set), so this only moves generate_tree OFF the per-column
 *  hot path. Tiny: N×species×~18 KB compact ≈ a few MB for the whole roster. @type {Map<string, ResolvedSchematic[]>} */
const _bake_cache = new Map()

/**
 * Bake (or fetch cached) N deterministic variants of a species under a world seed. Each variant is a full
 * generate_tree run with a decorrelated seed, so the set spans the same age/silhouette range the live
 * per-column path produced — just N of them instead of one-per-column. `param_overrides` shallow-merges
 * onto the species record BEFORE generation (the geometry / quality-tier HOOK — e.g. a lighter-canopy
 * "medium" tier can pass a higher `leaf_hole` or lower `split_depth`; UNWIRED here, exposed for future
 * A/B). Default (undefined) ⇒ the stock species params, byte-identical to generate_tree(seed, …, species).
 * @param {number} seed world seed
 * @param {string} species species key
 * @param {number} n variant count (coerced to >=1)
 * @param {Partial<SpeciesParams>} [param_overrides] tier hook — merged onto the species params (unwired)
 * @returns {ResolvedSchematic[]}
 */
export function bake_species_variants(seed, species, n, param_overrides) {
  const count = n > 0 ? n : 1
  const ov_key = param_overrides ? JSON.stringify(param_overrides) : ''
  const key = `${seed}|${species}|${count}|${ov_key}`
  const cached = _bake_cache.get(key)
  if (cached !== undefined) return cached
  const spec = param_overrides ? { ...resolve_species(species), ...param_overrides } : species
  /** @type {ResolvedSchematic[]} */
  const set = []
  for (let i = 0; i < count; i += 1) set.push(generate_tree(seed, i, SALT_BAKE_WZ, spec))
  _bake_cache.set(key, set)
  return set
}

/**
 * The stamp-time tree for an anchor column. n>0 ⇒ bake-then-pick: an O(1) hash→index into the N baked
 * variants (the perf win — zero per-column branch math after the one-time bake). n<=0 ⇒ the live
 * per-column generate_tree (byte-identical to today). Pure & deterministic either way: the same world
 * seed yields the same variant at the same column, in every chunk that column's canopy reaches.
 * @param {number} seed world seed
 * @param {number} wx anchor column x
 * @param {number} wz anchor column z
 * @param {string} species species key
 * @param {number} n variant count (<=0 ⇒ live per-column synthesis)
 * @param {Partial<SpeciesParams>} [param_overrides] tier hook (see bake_species_variants)
 * @returns {ResolvedSchematic}
 */
export function pick_baked_tree(seed, wx, wz, species, n, param_overrides) {
  if (n <= 0) return generate_tree(seed, wx, wz, species)
  const set = bake_species_variants(seed, species, n, param_overrides)
  return set[hash_column(wx, wz, (seed ^ SALT_TREE_VARIANT) >>> 0) % set.length]
}

/** Clear the bake cache (tests, or a world reload after a config change). @returns {void} */
export function reset_tree_bake_cache() {
  _bake_cache.clear()
}
