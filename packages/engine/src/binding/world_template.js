// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM 6 — WORLD-FROM-TEMPLATE (SPEC §4: "Worlds are admin-minted templates").
//
// The chain stores a world as a template (aresrpg_game::world::World): a seed, a biome name, a required
// level, the world bounds, the discovery-zone size + TTL, and the first-join spawn box. This seam is the
// PURE mapping from that on-chain template shape onto exactly what the ENGINE needs to instantiate the
// world: the gen recipe (create_engine({ world_config })) and the barrier bounds (engine.set_zone_bounds,
// the EXISTING core/zone_border.js world border — wired in here, never rebuilt).
//
// ── Two shape reconciliations this seam OWNS (single home) ─────────────────────────────────────────
//   • SEED: chain seed is a u64; the engine gen hashes a STRING seed (world_gen_config.seed). We convert
//     via String(seed) so both clients gen byte-identical terrain from the same template.
//   • COORDS: chain positions are u32 (x,z ≥ 0) → the world spans [0, bounds] on each axis, NOT centred
//     on the origin. We emit 0-based world_bounds and fold them (plus the template's zone size) into the
//     returned world_config's `.zones` override, so zone_view.js (seam 5) reads the template's real grid
//     without the caller re-plumbing it. (zone_view's own default is origin-centred — this override wins.)
//
// No chain awareness lives here (no ids, no package coupling — the invariant: bind to SHAPES, stable
// through the package merge, never to package ids). A plain object in → plain engine inputs out. Pure.

import { world_config_for_biome } from '../config/worlds/index.js'

// Single home for the SPEC world-size + zone-size defaults (seam 5 owns them: 500,000 blocks / 16-chunk
// zones) — imported, never re-declared, so the two numbers live in exactly one place.
import { DEFAULT_ZONE_SIZE_BLOCKS, DEFAULT_WORLD_SIZE_BLOCKS } from './zone_view.js'

/** SPEC §4 / world.move DEFAULT_SPAWN_ZONE — the first-join random-spawn box is 1000×1000 blocks. */
export const DEFAULT_SPAWN_ZONE_BLOCKS = 1000

/**
 * @typedef {object} WorldTemplate the on-chain world shape (aresrpg_game::world::World), as pushed by the
 *   RPC. Only the fields the ENGINE consumes are read; the rest (spawn tables, dungeon roster, level gate…)
 *   stay chain/UI concerns. All numeric fields tolerate number | bigint | string (RPC u32/u64 widening).
 * @property {number|bigint|string} [seed] the world's procedural seed (u64 on chain)
 * @property {string} [biome] the biome identity name (matches a WORLD_CONFIGS key; unknown → default world)
 * @property {number|bigint|string} [bounds_x] world extent on X in blocks (default 500,000)
 * @property {number|bigint|string} [bounds_z] world extent on Z in blocks (default 500,000)
 * @property {number|bigint|string} [zone_size] discovery-zone edge in blocks (default 512)
 * @property {number|bigint|string} [spawn_zone_x] first-join spawn box width in blocks (default 1000)
 * @property {number|bigint|string} [spawn_zone_z] first-join spawn box depth in blocks (default 1000)
 * @property {number|bigint|string} [required_level] level gate to enter (passthrough metadata)
 */

/** Coerce an RPC-widened numeric (number | bigint | string) to a finite Number, or `fallback`. */
function num(/** @type {unknown} */ v, /** @type {number} */ fallback) {
  if (v == null) return fallback
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * @typedef {object} WorldFromTemplate
 * @property {import('../config/world_gen_config.js').WorldGenConfig & { zones: { size_blocks: number,
 *   world_bounds: import('../core/zone_border.js').ZoneBounds } }} world_config the gen recipe to pass to
 *   create_engine — the biome recipe with the template's seed applied AND the template's zone grid folded
 *   into `.zones` (so zone_state_view reads the real world without extra plumbing).
 * @property {import('../core/zone_border.js').ZoneBounds} world_bounds the 0-based world border box to pass
 *   to engine.set_zone_bounds (the mana-barrier / soft-clamp — core/zone_border.js).
 * @property {{ width: number, depth: number }} spawn_zone the first-join spawn-roll box SIZE in blocks
 *   (the chain rolls the position; the engine just surfaces the box for the map overlay). Passthrough.
 * @property {string} biome the resolved biome name.
 * @property {number} required_level the level gate (passthrough metadata for the UI).
 */

/**
 * Derive the engine's world inputs from an on-chain world template. Pure + deterministic: the same
 * template object → deeply identical outputs on every machine, so two clients build the same world.
 *
 * REUSE: composes the existing biome registry (world_config_for_biome — the single home for
 * name→recipe) + core/zone_border.js's ZoneBounds shape; nothing new is invented, this only reconciles
 * the chain's seed/coord conventions onto them.
 *
 * @param {WorldTemplate | null | undefined} template the pushed world template (nullish → the default world).
 * @returns {WorldFromTemplate}
 */
export function world_from_template(template) {
  const t = template ?? {}
  const biome = typeof t.biome === 'string' && t.biome ? t.biome : ''

  const bounds_x = Math.max(1, Math.floor(num(t.bounds_x, DEFAULT_WORLD_SIZE_BLOCKS)))
  const bounds_z = Math.max(1, Math.floor(num(t.bounds_z, DEFAULT_WORLD_SIZE_BLOCKS)))
  const zone_size = Math.max(1, Math.floor(num(t.zone_size, DEFAULT_ZONE_SIZE_BLOCKS)))
  const spawn_w = Math.max(1, Math.floor(num(t.spawn_zone_x, DEFAULT_SPAWN_ZONE_BLOCKS)))
  const spawn_d = Math.max(1, Math.floor(num(t.spawn_zone_z, DEFAULT_SPAWN_ZONE_BLOCKS)))

  // Chain coords are u32 (≥0): the world occupies [0, bounds] on each axis, not a centred box.
  const world_bounds = { min_x: 0, min_z: 0, max_x: bounds_x, max_z: bounds_z }

  // The gen recipe: the biome's recipe (a full, upstream-validated WorldGenConfig) with the template's
  // seed applied and the template's zone grid folded in. A SHALLOW clone — never mutate the shared
  // registry recipe (ground_height's context cache is keyed by config identity; mutating a shared recipe
  // would poison every world that reuses it). Resolve ONCE per world-join, not per frame.
  const base = world_config_for_biome(biome)
  const world_config = {
    ...base,
    seed: t.seed != null ? String(t.seed) : base.seed,
    zones: { size_blocks: zone_size, world_bounds },
  }

  return {
    world_config,
    world_bounds,
    spawn_zone: { width: spawn_w, depth: spawn_d },
    biome: biome || base.name || 'default',
    required_level: Math.max(0, Math.floor(num(t.required_level, 0))),
  }
}
