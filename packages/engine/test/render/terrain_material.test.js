// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math unit tests for the terrain material's per-face winding DERIVATION RECORD (the exported
// AXIS_FACE_TABLE / WINDING_FLIP_FACES / AO_VMIRROR_REMAP constants) — no GPU, no TSL evaluation.
// The material ships DoubleSide (winding is irrelevant when both faces draw); the correctly-wound
// FrontSide candidate these constants describe was built, measured, and deleted (it lost on holes
// AND perf — see the `side=` verdict in terrain_material.js). These tests survive as the proof the
// winding math was RIGHT, so the decision isn't relitigated: they encode the exact geometry that
// would make FrontSide hole-free, independent of whether it ships.
//
// KEY FACT the first suite pins down: the greedy mesher's plane convention (binary_greedy.js) does
// NOT satisfy the raw u_axis × v_axis = +normal for all six faces. It holds for faces {0,3,4} and is
// INVERTED (u×v = −normal) for {1,2,5} — which is EXACTLY why those three back-cull under a naive
// FrontSide (frontFace=CCW). A per-face v-mirror on {1,2,5} makes the EFFECTIVE u×v (v reversed on
// those faces) = +normal for all six; both statements are asserted, so the invariant is tested "over
// all six faces" as the brief requires. Second/third suites: the derived flip set equals
// WINDING_FLIP_FACES, the v-mirror preserves world corners (double-shift guard), and AO_VMIRROR_REMAP
// is the correct (u,1−v) corner permutation + an involution.

import { test, expect, describe } from 'bun:test'

import { FACE_BRIGHTNESS, SUN_LEAK_GATE, sun_direct_factor } from '../../src/render/terrain_material.js'
import { AO_LEVELS, ao_level_fraction } from '../../src/render/terrain_ao.js'
import { AXIS_FACE_TABLE, WINDING_FLIP_FACES, AO_VMIRROR_REMAP } from '../../src/render/terrain_winding.js'

/** @typedef {[number, number, number]} Vec3 */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} — `+ 0` normalizes −0 so toEqual matches +0. */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0]
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** @param {Vec3} a @param {Vec3} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
/** @param {Vec3} a @param {number} s @returns {Vec3} — `+ 0` normalizes −0 so toEqual matches +0. */
const scale = (a, s) => [a[0] * s + 0, a[1] * s + 0, a[2] * s + 0]

const AXIS_FACES = /** @type {const} */ ([0, 1, 2, 3, 4, 5])
// Shared quad corner order the material's `corner` attribute is authored in: (u,v) pairs.
const CORNERS = /** @type {ReadonlyArray<[number, number]>} */ ([
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
])

/**
 * Vertex position of one corner for a face's (u_axis, v_axis), mirroring the material's expansion
 * `pos = origin + u_axis·(cu·w) + v_axis·(cv·h)` (origin 0, unit w/h — winding is size-independent).
 * @param {import('../../src/render/terrain_winding.js').FaceAxes} axes
 * @param {[number, number]} corner (u, v) in {0,1}
 * @returns {Vec3}
 */
function corner_pos(axes, [cu, cv]) {
  return add(scale(/** @type {Vec3} */ (axes.u), cu), scale(/** @type {Vec3} */ (axes.v), cv))
}

/**
 * Signed facing of triangle (0,1,2) relative to the outward normal: cross(P1−P0,P2−P0)·(+n).
 * > 0 ⇒ front-facing to a +normal viewer (survives FrontSide/frontFace=CCW/cullMode=Back);
 * < 0 ⇒ back-culled. Triangle (2,1,3) shares this sign on a planar quad, so tri 0 is sufficient.
 * @param {import('../../src/render/terrain_winding.js').FaceAxes} axes
 * @param {ReadonlyArray<[number, number]>} corners corner (u,v) order, possibly v-mirrored
 */
function tri0_facing(axes, corners) {
  const p0 = corner_pos(axes, corners[0])
  const p1 = corner_pos(axes, corners[1])
  const p2 = corner_pos(axes, corners[2])
  return dot(cross(sub(p1, p0), sub(p2, p0)), /** @type {Vec3} */ (axes.n))
}

describe('AXIS_FACE_TABLE — u_axis × v_axis vs normal invariant (all six axis faces)', () => {
  // Raw table: cross(u,v) = +normal on non-flip faces, −normal on flip faces. Asserted per-face so a
  // drift in either the exported table or the flip set fails loudly and points at the exact face.
  for (const face of AXIS_FACES) {
    const is_flip = WINDING_FLIP_FACES.includes(face)
    test(`face ${face}: raw cross(u_axis, v_axis) === ${is_flip ? '−' : '+'}normal`, () => {
      const { u, v, n } = AXIS_FACE_TABLE[face]
      const expected = is_flip ? scale(/** @type {Vec3} */ (n), -1) : /** @type {Vec3} */ (n)
      expect(cross(/** @type {Vec3} */ (u), /** @type {Vec3} */ (v))).toEqual(expected)
    })
  }

  // EFFECTIVE invariant across ALL SIX faces: with v reversed on flip faces (the v-mirror), the
  // effective u × v_eff = +normal everywhere. This is the property that guarantees a hole-free
  // FrontSide render — the whole point of the winding fix.
  for (const face of AXIS_FACES) {
    test(`face ${face}: effective cross(u_axis, v_eff) === +normal (post v-mirror)`, () => {
      const { u, v, n } = AXIS_FACE_TABLE[face]
      const v_eff = WINDING_FLIP_FACES.includes(face) ? scale(/** @type {Vec3} */ (v), -1) : /** @type {Vec3} */ (v)
      expect(cross(/** @type {Vec3} */ (u), v_eff)).toEqual(/** @type {Vec3} */ (n))
    })
  }

  test('every axis (u,v) is a unit basis pair with a unit normal (no degenerate/skew faces)', () => {
    for (const face of AXIS_FACES) {
      const { u, v, n } = AXIS_FACE_TABLE[face]
      // each axis vector is a signed unit basis vector, and u ⟂ v (dot 0)
      expect(dot(/** @type {Vec3} */ (u), /** @type {Vec3} */ (u))).toBe(1)
      expect(dot(/** @type {Vec3} */ (v), /** @type {Vec3} */ (v))).toBe(1)
      expect(dot(/** @type {Vec3} */ (n), /** @type {Vec3} */ (n))).toBe(1)
      expect(dot(/** @type {Vec3} */ (u), /** @type {Vec3} */ (v))).toBe(0)
    }
  })

  test('normals cover exactly the six ±axis directions (0=+x..5=−z), one per face', () => {
    const normals = AXIS_FACES.map((f) => AXIS_FACE_TABLE[f].n)
    expect(normals).toEqual([
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ])
  })
})

describe('FrontSide winding — flip set derived from the corner geometry', () => {
  test('the back-culling faces (tri0 facing < 0) are exactly WINDING_FLIP_FACES', () => {
    const derived = AXIS_FACES.filter((f) => tri0_facing(AXIS_FACE_TABLE[f], CORNERS) < 0).map(Number)
    expect(derived).toEqual([...WINDING_FLIP_FACES].map(Number))
  })

  test('the non-flip faces (tri0 facing > 0) are already front-facing under FrontSide', () => {
    const front = AXIS_FACES.filter((f) => tri0_facing(AXIS_FACE_TABLE[f], CORNERS) > 0).map(Number)
    const expected = AXIS_FACES.filter((f) => !WINDING_FLIP_FACES.includes(f)).map(Number)
    expect(front).toEqual(expected)
    // no face lands on a degenerate zero facing
    for (const f of AXIS_FACES) expect(tri0_facing(AXIS_FACE_TABLE[f], CORNERS)).not.toBe(0)
  })

  test('the v-mirror flips every flip face to front-facing (holes → 0 under FrontSide)', () => {
    // v-mirror = reverse corner_v (v → 1−v). Winding is position-independent, so applying it to the
    // corner order and re-evaluating the facing over the SAME axis table proves the fix, not a shift.
    const v_mirrored = CORNERS.map(([u, v]) => /** @type {[number, number]} */ ([u, 1 - v]))
    for (const f of WINDING_FLIP_FACES) {
      expect(tri0_facing(AXIS_FACE_TABLE[/** @type {0|1|2|3|4|5} */ (f)], v_mirrored)).toBeGreaterThan(0)
    }
  })

  test('the v-mirror preserves the four WORLD corners (no position drift — double-shift guard)', () => {
    // Regression guard for a bug measurement caught: the mirror must live ENTIRELY in corner_v_eff =
    // 1−corner_v with NO origin shift. Simulate the material's exact vertex placement
    //   pos = origin + u_axis·(corner_u·w) + v_axis·(corner_v_eff·h)
    // for both variants on every flip face and assert the SET of four world corners is identical
    // (same rectangle, corners relabeled). An added origin shift would fling the quad to v=2h and
    // this set-equality fails — exactly the black-void defect the pixel probe surfaced.
    const W = 3
    const H = 5
    const ORIGIN = /** @type {Vec3} */ ([2, 7, 4])
    /** @param {import('../../src/render/terrain_winding.js').FaceAxes} axes @param {boolean} front_side */
    const world_corners = (axes, front_side) =>
      CORNERS.map(([cu, cv]) => {
        const cve = front_side ? 1 - cv : cv
        return add(
          ORIGIN,
          add(scale(/** @type {Vec3} */ (axes.u), cu * W), scale(/** @type {Vec3} */ (axes.v), cve * H))
        )
      })
        .map((p) => p.join(','))
        .sort()
    for (const f of WINDING_FLIP_FACES) {
      const axes = AXIS_FACE_TABLE[/** @type {0|1|2|3|4|5} */ (f)]
      expect(world_corners(axes, true), `flip face ${f} world corners drifted under v-mirror`).toEqual(
        world_corners(axes, false)
      )
    }
  })
})

describe('FACE_BRIGHTNESS — Minecraft-style per-face directional shading table', () => {
  // The shipped shading mechanism (create_terrain_material multiplies this scalar into the albedo).
  // Pins the exact values + the structural invariants the disease-cure relies on, so the table can't
  // silently drift back toward a floor that luminance-matches the sky. Face ids: 0=+x 1=−x 2=+y(top)
  // 3=−y(bottom) 4=+z 5=−z. `fb` casts away the literal-key Record so dynamic-index loops typecheck.
  const fb = /** @type {Record<number, number | undefined>} */ (FACE_BRIGHTNESS)

  test('exact per-face multipliers (canonical getShade values)', () => {
    // NOTE (2026-07-03, NG2-C stripe A/B): a relax-toward-1.0 experiment on these constants was run and
    // is a NO-SHIP — relaxing them dropped the terrace-stripe variance <1.5% (bar ≥30%) because
    // the stripe is AO-notch/cast-shadow/AO-floor dominated at that angle, not face-brightness dominated
    // (see the FACE_BRIGHTNESS doc + /tmp/aresrpg-engine-artifacts/face_relax_* captures). The table
    // stays the frozen getShade values; this assertion pins them.
    expect(FACE_BRIGHTNESS).toEqual({ 0: 0.6, 1: 0.6, 2: 1.0, 3: 0.5, 4: 0.8, 5: 0.8 })
  })

  test('the six axis faces are all present, each a scalar in (0, 1]', () => {
    for (const face of [0, 1, 2, 3, 4, 5]) {
      const v = fb[face]
      expect(typeof v).toBe('number')
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('tops (+y) are the unique brightest at exactly 1.0 (byte-identical + full shadow contrast)', () => {
    // top===1.0 is load-bearing: it keeps the grass TOPS unchanged vs the pre-surgery baseline and
    // lets cast shadows land on the ·1.0 tops at full contrast (the "no shadows" symptom cure).
    expect(fb[2]).toBe(1.0)
    for (const face of [0, 1, 3, 4, 5]) expect(fb[face]).toBeLessThan(1.0)
  })

  test('bottom (−y) is the unique darkest, sides sit strictly between bottom and top', () => {
    expect(fb[3]).toBe(0.5)
    for (const face of [0, 1, 4, 5]) {
      expect(fb[face]).toBeGreaterThan(0.5) // brighter than bottom
      expect(fb[face]).toBeLessThan(1.0) // darker than top → below fog luminance (no notch)
    }
  })

  test('opposite side faces are symmetric (±x equal, ±z equal) and E/W ≤ N/S', () => {
    expect(fb[0]).toBe(fb[1]) // +x === −x
    expect(fb[4]).toBe(fb[5]) // +z === −z
    // Minecraft's E/W (±x) are darker than N/S (±z); keeps the classic voxel face-shade read.
    expect(fb[0]).toBeLessThanOrEqual(fb[4] ?? 1)
  })

  test('cross-billboard face ids (6, 7) are absent → shader falls through to full 1.0', () => {
    // Foliage crosses must NOT be in the table (create_terrain_material defaults the select-ladder to
    // 1.0 for any face not in the map, so grass/flower billboards render fully lit).
    expect(fb[6]).toBeUndefined()
    expect(fb[7]).toBeUndefined()
    expect(Object.keys(FACE_BRIGHTNESS).sort()).toEqual(['0', '1', '2', '3', '4', '5'])
  })
})

describe('AO_VMIRROR_REMAP — v-mirror corner permutation', () => {
  test('remap sends authored corner i to the mesher corner at (u_i, 1−v_i)', () => {
    // The permutation the material applies to `ao_corner` on flip faces: a vertex authored corner i
    // sits at (u_i, 1−v_i) after the mirror, so its AO comes from the corner with that (u,v).
    const find_corner = (/** @type {number} */ u, /** @type {number} */ v) =>
      CORNERS.findIndex((c) => c[0] === u && c[1] === v)
    const expected = CORNERS.map(([u, v]) => find_corner(u, 1 - v))
    expect([...AO_VMIRROR_REMAP]).toEqual(expected)
  })

  test('remap is a valid permutation of {0,1,2,3}', () => {
    expect([...AO_VMIRROR_REMAP].slice().sort()).toEqual([0, 1, 2, 3])
  })

  test('remap is an involution — applied twice it round-trips to identity', () => {
    const twice = AO_VMIRROR_REMAP.map((i) => AO_VMIRROR_REMAP[i])
    expect(twice).toEqual([0, 1, 2, 3])
  })
})

describe('SUN-LEAK GATE — direct-sun attenuation by BFS sun (forest/cave leak fix)', () => {
  // The material's receivedShadowNode scales the DIRECT sun by smoothstep(0, SUN_FULL/15, sun/15).
  // sun_direct_factor is the pure JS mirror of that TSL smoothstep; these pins the contract:
  // sun=0 → direct ~0 (canopy floor / deep cave goes dark), sun=15 → 1.0 (open terrain untouched).
  test('sun=0 → direct factor is exactly 0 (no sky reaches: fully gated)', () => {
    expect(sun_direct_factor(0)).toBe(0)
  })

  test('sun=15 (open sky) → direct factor is exactly 1.0 (open terrain UNCHANGED)', () => {
    expect(sun_direct_factor(15)).toBe(1)
  })

  test('sun ≥ SUN_FULL → clamped to 1.0 (at/above the full-sun edge, no attenuation)', () => {
    for (let s = SUN_LEAK_GATE.SUN_FULL; s <= 15; s += 1) expect(sun_direct_factor(s)).toBe(1)
  })

  test('monotonic non-decreasing in sun (more sky ⇒ more direct sun, never less)', () => {
    let prev = -1
    for (let s = 0; s <= 15; s += 1) {
      const f = sun_direct_factor(s)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
  })

  test('low sun (deep shade, sun≈1-2) is strongly attenuated — the leak cure', () => {
    // A forest floor / cave the shadow map misses reads a low BFS sun; the gate must cut most direct
    // sun there (else it "leaks" full-bright). At sun=1 the factor is a small fraction of full.
    expect(sun_direct_factor(1)).toBeLessThan(0.15)
    expect(sun_direct_factor(2)).toBeLessThan(0.4)
    // by the mid brackets it has ramped up (smoothstep S-curve), reaching 1.0 at the SUN_FULL edge
    expect(sun_direct_factor(SUN_LEAK_GATE.SUN_FULL - 1)).toBeLessThan(1)
    expect(sun_direct_factor(SUN_LEAK_GATE.SUN_FULL)).toBe(1)
  })

  test('SUN_FULL is a sane sky-reach threshold in (0,15]', () => {
    expect(SUN_LEAK_GATE.SUN_FULL).toBeGreaterThan(0)
    expect(SUN_LEAK_GATE.SUN_FULL).toBeLessThanOrEqual(15)
  })
})

// AO_LEVELS — the flattened vertex-AO curve that cures the terrace-stripe striping (a lone 1-block
// step edge lands at AO level 2 and must barely darken, while deep double-occluded corners keep
// level-0 contrast). These pin the exact monotone shape the material's select-ladder mirrors.
describe('AO_LEVELS — terrace-stripe AO curve', () => {
  test('fully-open (level 3) is unshaded (1); level 0 keeps real but non-black contact shade', () => {
    expect(AO_LEVELS[3]).toBe(1)
    expect(ao_level_fraction(3)).toBe(1)
    // level 0 is a greedy step-CORNER notch on a flat terrace as well as a genuine deep corner — kept
    // as clear contact shade (well below 1) but NOT pure black (pure-black notches were half the stripe).
    expect(ao_level_fraction(0)).toBeGreaterThan(0) // not pure black
    expect(ao_level_fraction(0)).toBeLessThan(0.5) // still clearly the darkest level (real contact shade)
  })

  test('strictly monotonically increasing across the four levels', () => {
    for (let i = 1; i < 4; i++) expect(AO_LEVELS[i]).toBeGreaterThan(AO_LEVELS[i - 1])
  })

  test('level 2 (a lone step edge) is only gently shaded — the stripe-edge cure', () => {
    // The OLD linear ramp put level 2 at 2/3 ≈ 0.667; the new curve lifts it well above that so a
    // single terrace step barely darkens. This is the core of the change.
    expect(ao_level_fraction(2)).toBeGreaterThan(0.667)
    expect(ao_level_fraction(2)).toBeGreaterThanOrEqual(0.9)
    expect(ao_level_fraction(2)).toBeLessThan(1) // still SOME shade, not flat
  })

  test('level 1 (two-sided corner) sits between level 0 and level 2 — real corners keep some depth', () => {
    expect(ao_level_fraction(1)).toBeGreaterThan(ao_level_fraction(0))
    expect(ao_level_fraction(1)).toBeLessThan(ao_level_fraction(2))
  })

  test('clamps out-of-range levels to the endpoints', () => {
    expect(ao_level_fraction(-5)).toBe(AO_LEVELS[0])
    expect(ao_level_fraction(99)).toBe(AO_LEVELS[3])
  })
})
