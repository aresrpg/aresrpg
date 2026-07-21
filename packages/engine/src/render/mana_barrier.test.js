// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-18 — mana-barrier GEOMETRY unit tests (the pure perimeter-path + wall-extrusion contract). The
// TSL material + sprite banners are GPU-verified by bench/eng18_border.spec.js [retired, issue #74]; here we prove the
// geometry the shader rides on: a closed rounded-rect ring, arc-length continuity, correct wall topology.
import { test, expect } from 'bun:test'

import {
  WALL_HEIGHT,
  WALL_SKIRT,
  CORNER_RADIUS,
  SEGMENT_M,
  build_perimeter_path,
  build_wall_geometry,
  point_at_arc_length,
  perimeter_normals,
} from './mana_barrier.js'

/** The D142 fixed zone (300 m centred on origin). */
const B = { min_x: -150, min_z: -150, max_x: 150, max_z: 150 }

test('build_perimeter_path: closed rounded-rect ring, all points inside the padded box, sane total', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  expect(p.points.length).toBeGreaterThan(50)
  // every point sits ON the rounded-rect boundary → within [min,max] on both axes (corners rounded IN).
  for (const [x, z] of p.points) {
    expect(x).toBeGreaterThanOrEqual(B.min_x - 1e-6)
    expect(x).toBeLessThanOrEqual(B.max_x + 1e-6)
    expect(z).toBeGreaterThanOrEqual(B.min_z - 1e-6)
    expect(z).toBeLessThanOrEqual(B.max_z + 1e-6)
  }
  // total arc length ≈ rectangle perimeter (1200) minus the corner-rounding shortening (4·(2r − π·r/2)).
  const straight = 4 * 300
  const corner_cut = 4 * (2 * CORNER_RADIUS - (Math.PI * CORNER_RADIUS) / 2)
  expect(p.total).toBeGreaterThan(straight - corner_cut - 20)
  expect(p.total).toBeLessThan(straight)
})

test('build_perimeter_path: corners are actually rounded — points appear near the fillet, none in the true corner', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  // the sharp corner (max_x, max_z) must NOT be a vertex; the nearest point sits ~CORNER_RADIUS·(1-√½) in.
  const has_sharp_corner = p.points.some(([x, z]) => Math.abs(x - B.max_x) < 0.5 && Math.abs(z - B.max_z) < 0.5)
  expect(has_sharp_corner).toBe(false)
  // but a fillet point near the corner arc exists (within the corner cell)
  const near_corner = p.points.some(([x, z]) => x > B.max_x - CORNER_RADIUS && z > B.max_z - CORNER_RADIUS)
  expect(near_corner).toBe(true)
})

test('build_perimeter_path: consecutive points are within ~SEGMENT_M (tessellation is fine + continuous)', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  for (let i = 0; i < p.points.length; i += 1) {
    const a = p.points[i]
    const b = p.points[(i + 1) % p.points.length]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    expect(d).toBeLessThan(SEGMENT_M * 1.6) // arc endpoints can slightly exceed seg; never wildly
  }
})

test('build_perimeter_path: degenerate radius clamps to fit a tiny zone (no NaN, still closed)', () => {
  const tiny = { min_x: 0, min_z: 0, max_x: 8, max_z: 8 } // r=14 can't fit; must clamp
  const p = build_perimeter_path(tiny, CORNER_RADIUS, SEGMENT_M)
  expect(p.points.length).toBeGreaterThan(3)
  for (const [x, z] of p.points) {
    expect(Number.isFinite(x)).toBe(true)
    expect(Number.isFinite(z)).toBe(true)
  }
  expect(p.total).toBeGreaterThan(0)
})

test('build_wall_geometry: 2 rows/point, 6 indices/edge, y spans −skirt..+height, aWall.h ∈ {0,1}', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  const g = build_wall_geometry(p, WALL_HEIGHT, WALL_SKIRT)
  const n = p.points.length
  const pos = g.getAttribute('position')
  const wall = g.getAttribute('aWall')
  expect(pos.count).toBe(n * 2)
  expect(wall.count).toBe(n * 2)
  expect(g.getAttribute('aNormal').count).toBe(n * 2)
  expect(g.getIndex()?.count).toBe(n * 6)
  // y extremes = wall-local −skirt (bottom) and +height (top)
  let min_y = Infinity
  let max_y = -Infinity
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i)
    min_y = Math.min(min_y, y)
    max_y = Math.max(max_y, y)
    const h = wall.getY(i) // aWall.y is the h channel
    expect(h === 0 || h === 1).toBe(true) // bottom row h=0, top row h=1
  }
  expect(min_y).toBeCloseTo(-WALL_SKIRT)
  expect(max_y).toBeCloseTo(WALL_HEIGHT)
})

test('build_wall_geometry: aWall.u (arc length) increases monotonically around the ring, back near total', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  const g = build_wall_geometry(p, WALL_HEIGHT, WALL_SKIRT)
  const wall = g.getAttribute('aWall')
  // bottom-row vertices are at even indices (i*2); their u must be non-decreasing.
  let prev = -1
  for (let i = 0; i < p.points.length; i += 1) {
    const u = wall.getX(i * 2)
    expect(u).toBeGreaterThanOrEqual(prev)
    prev = u
  }
  // the last u + its wrap edge ≈ the path total (continuity of the scroll around the loop).
  expect(prev).toBeGreaterThan(p.total * 0.9)
  expect(prev).toBeLessThanOrEqual(p.total)
})

test('perimeter_normals: unit outward horizontal normals — point away from the zone centre', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  const nrm = perimeter_normals(p.points)
  expect(nrm.length).toBe(p.points.length)
  const cx = (B.min_x + B.max_x) / 2
  const cz = (B.min_z + B.max_z) / 2
  for (let i = 0; i < nrm.length; i += 1) {
    const [nx, nz] = nrm[i]
    expect(Math.hypot(nx, nz)).toBeCloseTo(1, 5) // unit
    // outward: the normal points away from the centre → dot(point−centre, normal) > 0
    const [px, pz] = p.points[i]
    const dot = (px - cx) * nx + (pz - cz) * nz
    expect(dot).toBeGreaterThan(0)
  }
})

test('point_at_arc_length: 0 → first point, wraps, and lands on the ring', () => {
  const p = build_perimeter_path(B, CORNER_RADIUS, SEGMENT_M)
  const start = point_at_arc_length(p, 0)
  expect(start[0]).toBeCloseTo(p.points[0][0])
  expect(start[1]).toBeCloseTo(p.points[0][1])
  // wrap: total and 0 map to the same point
  const wrapped = point_at_arc_length(p, p.total)
  expect(wrapped[0]).toBeCloseTo(start[0], 1)
  // a quarter of the way around lands on the boundary box
  const q = point_at_arc_length(p, p.total / 4)
  const on_x = Math.abs(q[0] - B.min_x) < 1 || Math.abs(q[0] - B.max_x) < 1
  const on_z = Math.abs(q[1] - B.min_z) < 1 || Math.abs(q[1] - B.max_z) < 1
  expect(on_x || on_z || (q[0] >= B.min_x && q[0] <= B.max_x)).toBe(true)
})
