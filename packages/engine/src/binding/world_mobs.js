// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM 7 — WORLD MOB-GROUP rendering feed (SPEC §8: "groups of 1–6 spawn at their discovered point and
// roam near it — never far", with the aging progress bar in the group's nametag).
//
// The chain stores a discovered mob group (aresrpg_game::zones::MobGroupSpawn) as an ANCHOR (x, z) + a
// `group_size` (1–6) + a `spawned_at_ms` (for aging) + a `group_seed` (the composition seed every mob's
// level/archimob is derived from). It does NOT store per-member positions — those would be dead storage.
// So the individual members' layout around the anchor is a CLIENT-side DETERMINISTIC scatter: seeded off
// the SAME `group_seed` the chain composes from, every client renders the identical arrangement, and a bot
// gains nothing (it reads the same public anchor). This module is that pure derivation + the bounded roam
// + the nametag aging math.
//
// RENDERING STAYS APP-SIDE (like remote_players.js / ambient_mobs.js): the engine owns no id→object map;
// the app mounts each member's GLB at the placement this feed computes. Providing an Object3D factory here
// would DUPLICATE the frontend's mob mounting (reuse-first) — so this is DATA ONLY: pure, deterministic,
// headless. That is exactly what the two-client determinism acceptance needs ("identical mob placements").

import { rng_seed, rng_next, rng_range, hash_anchor } from './prng.js'
import { ground_height } from './ground_height.js'

/** SPEC §8 — a group is 1 to 6 individuals. */
export const MAX_GROUP_SIZE = 6
/** Cluster radius (blocks) the members scatter within around the anchor — "spawn at their discovered
 *  point". Not a chain value (positions aren't stored); a cosmetic tuning const, overridable per call. */
export const MOB_SCATTER_RADIUS_BLOCKS = 4
/** Bounded wander radius (blocks) off each member's spawn spot — SPEC §8 "roam near it — never far".
 *  Overridable per call. */
export const MOB_ROAM_RADIUS_BLOCKS = 2
/** SPEC §8 — a live group gains +1% loot & XP per hour alive… */
export const AGING_RATE_PER_HOUR = 0.01
/** …capped at +100% at 100 hours. */
export const AGING_CAP_HOURS = 100

const TAU = Math.PI * 2
/** Slow, incommensurate wander frequencies (rad/s) so the roam reads organic and doesn't visibly loop. */
const ROAM_FREQ_X = 0.31
const ROAM_FREQ_Z = 0.23

/** Reduce a seed (number | bigint | string — RPC u64 widening) to a uint32 for the PRNG. Mirrors the
 *  foundation port's low-32 behaviour (prng.js works in low-32 arithmetic). @param {number|bigint|string} v */
function to_u32(v) {
  if (typeof v === 'bigint') return Number(v & 0xffffffffn) >>> 0
  const n = Number(v)
  return Number.isFinite(n) ? n >>> 0 : 0
}

/** Coerce an RPC-widened numeric (number | bigint | string) to a finite Number, or `fallback`. */
function num(v, fallback) {
  if (v == null) return fallback
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** @typedef {{ index: number, x: number, y: number, z: number, angle: number, radius: number }} MobPlacement */

/**
 * Deterministic base placement of a mob group's 1–6 members around its anchor, grounded on the canonical
 * surface (the Y-oracle, seam 1). Same (world_config, anchor, group_size, seed) → deeply identical layout
 * on every machine — the "identical mob placements" the determinism acceptance requires. Member 0 sits ON
 * the anchor (the group's read-point); the rest scatter within `scatter_radius` blocks.
 *
 * @param {import('../config/world_gen_config.js').WorldGenConfig | null | undefined} world_config the world
 *   recipe (its seed grounds the Y and is the scatter's fallback seed).
 * @param {number} anchor_x integer world-x of the group's discovered point
 * @param {number} anchor_z integer world-z of the group's discovered point
 * @param {number} group_size how many individuals (clamped to 1..MAX_GROUP_SIZE)
 * @param {object} [opts]
 * @param {number|bigint|string} [opts.group_seed] the chain composition seed (MobGroupSpawn.group_seed);
 *   falls back to hash_anchor(world seed, anchor) so member ordering ties to the chain's own derivation.
 * @param {number} [opts.scatter_radius] cluster radius in blocks (default MOB_SCATTER_RADIUS_BLOCKS).
 * @returns {MobPlacement[]} one entry per member (length = clamped group_size), member 0 on the anchor.
 */
export function mob_group_placement(world_config, anchor_x, anchor_z, group_size, opts = {}) {
  const ax = Math.floor(anchor_x)
  const az = Math.floor(anchor_z)
  const count = Math.max(1, Math.min(MAX_GROUP_SIZE, Math.floor(num(group_size, 1))))
  const scatter = num(opts.scatter_radius, MOB_SCATTER_RADIUS_BLOCKS)
  const seed = opts.group_seed != null ? to_u32(opts.group_seed) : hash_anchor(world_config?.seed ?? '', ax, az)

  /** @type {MobPlacement[]} */
  const out = []
  let s = rng_seed(seed)
  for (let i = 0; i < count; i += 1) {
    let x = ax
    let z = az
    let angle = 0
    let radius = 0
    if (i > 0) {
      // draw a deterministic polar offset; thread the rng state so each member differs.
      const ra = rng_range(s, 0, 3599)
      s = ra.state
      angle = (ra.value / 3600) * TAU
      const rr = rng_range(s, 0, 1000)
      s = rr.state
      radius = (rr.value / 1000) * scatter
      x = ax + Math.round(Math.cos(angle) * radius)
      z = az + Math.round(Math.sin(angle) * radius)
    } else {
      // advance the cursor once even for member 0 so a size-1 group and a size-N group's member 0 agree
      // and later members stay decorrelated.
      s = rng_next(s).state
    }
    out.push({ index: i, x, y: ground_height(world_config, x, z), z, angle, radius })
  }
  return out
}

/**
 * A bounded, smooth roam offset (in blocks, XZ) for a member at shared-clock time `t`. Deterministic in
 * (member_seed, t): two clients passing the SAME clock read the identical offset, so the world stays in
 * sync (feed it the on-chain Clock / server time, in seconds). |dx|,|dz| ≤ roam_radius — "never far".
 * The app adds this to a member's base placement each frame; Y need not re-ground (the wander is small).
 *
 * @param {number} member_seed any integer that identifies the member (e.g. group_seed + index)
 * @param {number} t time in seconds (a shared clock)
 * @param {number} [roam_radius] max wander in blocks (default MOB_ROAM_RADIUS_BLOCKS)
 * @returns {[number, number]} [dx, dz] block offset, each within [-roam_radius, roam_radius]
 */
export function mob_roam_offset(member_seed, t, roam_radius = MOB_ROAM_RADIUS_BLOCKS) {
  const phase = ((to_u32(member_seed) % 1000) / 1000) * TAU
  const dx = roam_radius * Math.sin(t * ROAM_FREQ_X + phase)
  const dz = roam_radius * Math.sin(t * ROAM_FREQ_Z + phase * 1.7 + 1.3)
  return [dx, dz]
}

/**
 * The group's aging progress — the fraction (0..1) the nametag bar fills. SPEC §8: +1% per hour alive,
 * capped at +100% (100h). Pure. The loot/XP MULTIPLIER a claim applies is `1 + aging_fraction(...)`; the
 * chain snapshots it at fight-lock (§8) — this is the DISPLAY value only.
 *
 * @param {number|bigint|string} spawned_at_ms the group's spawn time (MobGroupSpawn.spawned_at_ms)
 * @param {number|bigint|string} now_ms the current time (Date.now() or the on-chain Clock)
 * @param {object} [opts]
 * @param {number} [opts.rate_per_hour] override the +%/hour (default AGING_RATE_PER_HOUR).
 * @param {number} [opts.cap_hours] override the cap in hours (default AGING_CAP_HOURS).
 * @returns {number} bar fill in [0, 1]
 */
export function mob_aging_fraction(spawned_at_ms, now_ms, opts = {}) {
  const rate = num(opts.rate_per_hour, AGING_RATE_PER_HOUR)
  const cap_hours = num(opts.cap_hours, AGING_CAP_HOURS)
  const hours = Math.max(0, (num(now_ms, 0) - num(spawned_at_ms, 0)) / 3_600_000)
  const frac = Math.min(hours, cap_hours) * rate
  return frac < 0 ? 0 : frac > 1 ? 1 : frac
}
