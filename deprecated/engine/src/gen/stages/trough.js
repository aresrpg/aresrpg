// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GLACIAL TROUGH stage (GLACIAL GENERATION §B.1). Reshapes the PV valley network into a parameterized
// U-profile: a wide FLAT floor + STEEP walls (ref R2 — the glacier/outwash plain between rock walls),
// replacing the smooth Catmull bowl our splines produce. PV is the folded-ridge valley field (0 at the
// fold centreline → 1 at ridge crests); the trough carves a depth that is CONSTANT (flat floor) for
// pv ≤ floor_pv, then falls to 0 across [floor_pv, wall_pv] with a smoothstep (concave-up = the U wall),
// and 0 above (ridges untouched). Pure per-column function of pv — region-local + deterministic, no
// sampler. Subtracted from the land surface in raw_land. Off by default ⇒ zero carve ⇒ byte-identical.
//
// DETERMINISM LAW (§3.7): arithmetic only (compare/multiply/subtract). No hashing, no noise, no banned fns.

/** @typedef {import('../../config/world_gen_config.js').TroughConfig} TroughConfig */

/**
 * @typedef {object} TroughContext resolved trough stage.
 * @property {boolean} enabled stage on
 * @property {number} depth max carve at the flat floor, blocks (the trough depth)
 * @property {number} floor_pv pv at/below which the carve is full depth (the flat-floor half-width)
 * @property {number} wall_pv pv at/above which the carve is zero (the wall top — ridges untouched)
 */

/**
 * Builds the trough stage context from a world's `trough` recipe. Pure params; disabled ⇒ enabled:false.
 * `floor_pv < wall_pv` is enforced by the config validator; a degenerate band collapses to no carve.
 * @param {Partial<TroughConfig>} [cfg]
 * @returns {TroughContext}
 */
export function create_trough_context(cfg) {
  return {
    enabled: cfg?.enabled === true,
    depth: cfg?.depth ?? 28,
    floor_pv: cfg?.floor_pv ?? 0.06,
    wall_pv: cfg?.wall_pv ?? 0.34,
  }
}

/**
 * Trough carve depth (blocks ≥0) to subtract from a column's land surface. Full `depth` on the flat floor
 * (pv ≤ floor_pv), a smoothstep U wall across [floor_pv, wall_pv], 0 on ridges. The flat-floor plateau is
 * what reads as the glacier/outwash plain; the smoothstep wall reads as the steep U side.
 * @param {TroughContext} tctx
 * @param {number} pv peaks-and-valleys [0,1] at the column
 * @returns {number} carve depth in blocks (0 when disabled or on ridges)
 */
export function trough_carve(tctx, pv) {
  if (!tctx.enabled) return 0
  if (pv <= tctx.floor_pv) return tctx.depth
  if (pv >= tctx.wall_pv) return 0
  const span = tctx.wall_pv - tctx.floor_pv
  if (span <= 0) return 0
  const t = (tctx.wall_pv - pv) / span // 1 at floor edge → 0 at wall top
  const u = t * t * (3 - 2 * t) // smoothstep — concave-up U wall
  return tctx.depth * u
}
