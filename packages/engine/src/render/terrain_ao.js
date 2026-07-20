// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Vertex-AO brightness curve for the terrain material — the flattened level→fraction lookup that
// cures the terrace-stripe striping. Extracted from terrain_material.js so that (600-LoC-law) file
// stays under budget and the AO curve has ONE home (constant + JS mirror + the shape tests import
// from here). The material builds a TSL select-ladder from AO_LEVELS; ao_level_fraction is the tested
// JS twin, so shader and constant can't drift.
//
// BACKGROUND — terraced slopes read as visible stripes: the mesher's classic
// Minecraft 4-level vertex AO (mesher.js corner_ao: `(s1&&s2)?0:3-(s1+s2+corner)`, 0..3) was mapped
// LINEARLY (ao/3) into the material's brightness, so a lone 1-block terrace step — one occluding
// neighbor → its edge corners land at level 2 (3−1) — shaded to 0.667 and its greedy step-CORNER
// notches (level 0/1) went near-black; tiled across regular terraces = horizontal striping on plain
// dirt/grass. This curve FLATTENS the upper levels (a lone step barely darkens) and LIFTS the level-0
// notch floor off pure black, while keeping level 0 clearly the darkest (real contact shade at
// tree-trunk bases / deep double-occluded inner corners). It does NOT — and cannot — remove the
// periodic riser shading itself: that is the FROZEN per-face FACE_BRIGHTNESS table (riser side 0.6 vs
// tread top 1.0), a fixed 40% step this AO curve is forbidden to touch. So this is the AO half of the
// terrace read; the residual step-to-step tone is the correct directional face shade.
//
// Index = raw AO level 0..3:
//   0 = fully occluded (both sides + corner) / a lone greedy step-corner notch → 0.35 (deep contact
//       shade, but not pure black — inky notches were the other half of the "stripe")
//   1 = two occluders (both sides, no corner)                                  → 0.82 (gently shaded)
//   2 = one occluder (a lone step edge)                                        → 0.92 (the edge cure)
//   3 = fully open                                                             → 1.00
// The material additionally floors this fraction into [ao_floor,1] (0.45 top / 0.58 side), so the
// darkest ON-SCREEN AO on a top face is ~0.45+0.55·0.35 ≈ 0.64 of albedo — deep shade, never a hole.
// Tunable per the NG2-C brief (AO LEVELS are ours; the FACE_BRIGHTNESS chain is NOT).

import { float } from 'three/tsl'

/** @type {Readonly<[number, number, number, number]>} */
export const AO_LEVELS = [0.35, 0.82, 0.92, 1.0]

/**
 * Brightness fraction for a raw AO level (0..3) via AO_LEVELS — the tested JS mirror of the material's
 * select-ladder. Out-of-range clamps to the ends. @param {number} level 0..3 @returns {number} [0,1]
 */
export function ao_level_fraction(level) {
  const i = Math.max(0, Math.min(3, level | 0))
  return AO_LEVELS[i]
}

/**
 * TSL twin of `ao_level_fraction`: a select-ladder mapping a raw AO-value node (float 0..3) to its
 * AO_LEVELS brightness fraction, so terrain_material.js gets the curve without inlining the ladder.
 * @param {*} ao_value_node float node in {0,1,2,3} @returns {*} float fraction node in [0,1]
 */
export function ao_fraction_node(ao_value_node) {
  return ao_value_node
    .equal(float(0))
    .select(
      float(AO_LEVELS[0]),
      ao_value_node
        .equal(float(1))
        .select(float(AO_LEVELS[1]), ao_value_node.equal(float(2)).select(float(AO_LEVELS[2]), float(AO_LEVELS[3])))
    )
}
