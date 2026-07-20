// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WINDING DERIVATION RECORD (extracted from terrain_material.js — the shading builder does not read
// these at runtime; they exist ONLY as the pure-math record behind the FrontSide-vs-DoubleSide
// verdict, exercised by terrain_material.test.js so the correct winding math is preserved and the
// decision is never relitigated from scratch). The FrontSide render path itself was built, measured
// (2026-07-02, headed Metal), and DELETED per the decision rule — it both shredded terrace risers AND
// ran ~2× slower (DoubleSide fills depth ⇒ maximal early-Z; report: /tmp/aresrpg-engine-artifacts/
// winding_report.json). The shipped material is DoubleSide (see terrain_material.js `side=`), so there
// is no winding fix in the render path.

/**
 * @typedef {[number, number, number]} Vec3
 * @typedef {{ u: Vec3, v: Vec3, n: Vec3 }} FaceAxes u_axis / v_axis / outward normal, object space.
 */

/**
 * Per-axis-face (u_axis, v_axis, normal) table matching the `u_axis`/`v_axis`/`normal` TSL select-
 * chains in `build_terrain_material`. Indexed by face id: 0=+x 1=−x 2=+y 3=−y 4=+z 5=−z. u/v match
 * binary_greedy.js's plane convention (axis0→u=y,v=z; axis1→u=x,v=z; axis2→u=x,v=y), so `w` runs
 * along u and `h` along v for every face. KEY FACT the test pins: cross(u,v) = +normal for faces
 * {0,3,4} but −normal for {1,2,5} — the mesher convention is NOT uniformly outward-winding, which is
 * exactly why a naive FrontSide back-culls {1,2,5}. Cross billboards (6/7) are diagonal, not
 * axis-aligned, so they are deliberately absent.
 * @type {Record<0|1|2|3|4|5, FaceAxes>}
 */
export const AXIS_FACE_TABLE = {
  0: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }, // +x: u=y v=z
  1: { u: [0, 1, 0], v: [0, 0, 1], n: [-1, 0, 0] }, // −x: u=y v=z
  2: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] }, // +y: u=x v=z
  3: { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] }, // −y: u=x v=z
  4: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, // +z: u=x v=y
  5: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] }, // −z: u=x v=y
}

/**
 * Axis faces whose triangle (0,1,2) back-culls under a naive FrontSide (frontFace=CCW). DERIVED, not
 * hand-picked: exactly the faces of AXIS_FACE_TABLE with cross(P1−P0,P2−P0)·(+normal) < 0 over the
 * shared corner geometry [(0,0),(1,0),(0,1),(1,1)]. The test recomputes this set from that invariant.
 * A v-mirror (corner_v→1−corner_v) on these three is the correct fix — but FrontSide lost the perf
 * comparison regardless, so the fix was never shipped.
 * @type {ReadonlyArray<number>}
 */
export const WINDING_FLIP_FACES = [1, 2, 5]

/**
 * AO corner-index remap the v-mirror would pair with (a vertex authored `corner = i`, mesher order
 * [(0,0),(1,0),(0,1),(1,1)], lands at (u_i, 1−v_i), so its AO comes from the mesher corner at that
 * (u,v): the permutation 0→2,1→3,2→0,3→1). An involution (its own inverse). Kept as part of the
 * derivation record; no shipped code applies it.
 * @type {readonly [number, number, number, number]}
 */
export const AO_VMIRROR_REMAP = [2, 3, 0, 1]
