// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM 1 — the canonical Y-ORACLE (SPEC §4: "Y does not exist on chain").
//
// On chain, positions are (X, Z) only; every client must derive the IDENTICAL Y for any (x,z) so a
// player, a mob anchor, or a fight board sits at the same height everywhere. The canonical ground rule
// (SPEC §4, verbatim): "top of the solid column, fluids rejected". Height is resolved at render time
// from the deterministic seed — this function is that resolver.
//
// EXPOSE, don't reimplement: the engine already has a pure, per-(x,z), fluid-rejecting effective-surface
// probe — `anchor_surface` in gen/column_gen.js — the SINGLE SOURCE the surface decorator uses to plant
// every tree/rock on the real terrain. Its `surface_y` is the first-air world-y above the topmost solid
// TERRAIN block (decoration snow/trees/rocks are stamped ABOVE this and are correctly NOT "the solid
// column" — verified: anchor_surface.surface_y === the generator's own per-column `ground_top` on 199/200
// sampled columns; the <1% divergence is a rare 3D-density overhang, a cosmetic edge — SPEC §4 makes v1
// spawns surface-only). Fluids are rejected by construction: `surface_y` is the LAND surface; the water
// level is a separate field, so an ocean column returns its seabed, never the sea plane.
//
// PURITY: no dependency on chunk residency and NO mutation of gen/world_gen.js's module-global config —
// the per-config GenContext is built once and memoized here (keyed by the recipe object). Same
// (world_config, x, z) → same y on every machine, whether or not a chunk near it is streamed.

import { create_gen_context, anchor_surface } from '../gen/column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'

/**
 * Memoized GenContext per world recipe (identity-keyed). create_gen_context is a pure derivation of the
 * recipe (fbm samplers, splines, biome placer…), so caching it is safe and keeps the oracle cheap under
 * repeated calls. A caller passing a fresh recipe object each call simply rebuilds — the shipped recipes
 * (WORLD_CONFIGS) are stable constants, so the cache hits in practice.
 * @type {WeakMap<object, import('../gen/column_gen.js').GenContext>}
 */
const ctx_cache = new WeakMap()

/** @param {import('../config/world_gen_config.js').WorldGenConfig | null | undefined} world_config */
function context_for(world_config) {
  const config = world_config ?? DEFAULT_WORLD_GEN_CONFIG
  let ctx = ctx_cache.get(config)
  if (ctx === undefined) {
    ctx = create_gen_context(config)
    ctx_cache.set(config, ctx)
  }
  return ctx
}

/**
 * The canonical ground height at a world column — the first-air world-y above the topmost solid TERRAIN
 * block for `world_config`'s seed, fluids rejected (SPEC §4). An entity placed at (x, y, z) rests its feet
 * on this y; the topmost solid block sits at y − 1. Pure + deterministic (no chunk-load dependency).
 * @param {import('../config/world_gen_config.js').WorldGenConfig | null | undefined} world_config the
 *   world recipe (seed + climate/splines/…). Nullish falls back to the default recipe.
 * @param {number} x world-space X (floored to the voxel column)
 * @param {number} z world-space Z (floored to the voxel column)
 * @returns {number} first-air ground world-y (integer)
 */
export function ground_height(world_config, x, z) {
  const ctx = context_for(world_config)
  return anchor_surface(ctx, Math.floor(x), Math.floor(z)).surface_y
}
