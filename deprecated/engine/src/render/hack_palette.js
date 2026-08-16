// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE — the palette + lattice CONSTANTS, on their own (docs/design/hack_mode_spec.md §2.1).
//
// Split out of hack_grid.js the moment a SECOND surface had to draw the same grid: the HUD minimap
// paints the retrowave lattice on a 2-D canvas while the world draws it in TSL. Same numbers, two
// renderers — so the numbers live here, in a module with NO three import, and both sides derive.
// A re-typed hex in the minimap is the bug this file exists to make impossible.

/** [§2.1] The mode's whole colour vocabulary, authored as sRGB hex. Consumers convert as they need:
 *  the world grid builds linear-space TSL nodes, the minimap builds `#rrggbb` strings. */
export const HACK_PALETTE = Object.freeze({
  /** sky zenith / scene clear — near-black indigo */
  bg_zenith: 0x05010d,
  /** sky mid gradient — deep violet */
  bg_mid: 0x2b0a4a,
  /** the second violet the mood pass drifts the mid sky through (psychedelic hue cycle) */
  bg_drift: 0x1a0b5e,
  /** the horizon glow band — hot pink */
  horizon_glow: 0xff6ec7,
  /** grid plane base — near-black purple */
  ground: 0x0a0118,
  /** minor lattice (the 1 m block grid) — cyan */
  grid_minor: 0x00e5ff,
  /** major lattice (every 8 blocks) — magenta */
  grid_major: 0xff2d95,
  /** sun disc gradient, top → bottom */
  sun_top: 0xffd319,
  sun_bottom: 0xff2975,
  /** the horizon ridge silhouette + its neon rim (the fake retrowave mountains) */
  ridge_fill: 0x120327,
  ridge_rim: 0x9d4bff,
})

/** THE INTERACTION LATTICE (§2.2): minor lines sit on the 1 m block lattice — the same lattice
 *  zone_derive positions, gather cells and movement snap to ("one line = one block"); major lines
 *  every 8 blocks give distance legibility. Both maps read these, so the two never disagree. */
export const HACK_LATTICE = Object.freeze({
  minor_m: 1,
  major_m: 8,
})

/**
 * A palette entry as a CSS hex string — the minimap's 2-D canvas wants `#rrggbb`, not a number.
 * @param {number} hex @returns {string}
 */
export const hack_css_hex = (hex) => `#${hex.toString(16).padStart(6, '0')}`

/**
 * A palette entry as `rgba(r,g,b,a)` — for the minimap's translucent line/haze washes.
 * @param {number} hex @param {number} alpha 0..1 @returns {string}
 */
export const hack_css_rgba = (hex, alpha) =>
  `rgba(${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}, ${alpha})`
