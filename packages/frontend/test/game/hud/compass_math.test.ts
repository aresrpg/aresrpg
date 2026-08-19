// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  bearing_of,
  camera_heading,
  cap_nearest_pips,
  cluster_pips,
  nearest_zone_edges,
  neighbor_zone_key,
  relative_bearing,
  strip_x,
  thin_pip_labels,
  wrap_pi,
} from '../../../src/game/hud/compass_math.ts'

test('the angle conventions hold: north is -Z, the camera heading is the negated yaw', () => {
  expect(bearing_of(0, -1)).toBeCloseTo(0) // north
  expect(bearing_of(1, 0)).toBeCloseTo(Math.PI / 2) // east
  expect(camera_heading(Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
  expect(wrap_pi(Math.PI * 3)).toBeCloseTo(-Math.PI)
  // dead ahead maps to the strip center; outside the ±100° window unmounts
  expect(strip_x(relative_bearing(0.4, 0.4))).toBeCloseTo(0.5)
  expect(strip_x(Math.PI)).toBeNull()
})

test('the pip pipeline caps per kind, merges near bearings across the ±π seam, and thins labels', () => {
  const pips = [
    { kind: 'mob', bearing: 0.0, dist: 10 },
    { kind: 'mob', bearing: 0.01, dist: 20 }, // ~0.6° from the first — merges
    { kind: 'mob', bearing: 1.0, dist: 30 },
    { kind: 'mob', bearing: 2.0, dist: 40 },
    { kind: 'mob', bearing: -2.0, dist: 50 },
    { kind: 'mob', bearing: 2.5, dist: 60 }, // 6th of its kind — capped away
    { kind: 'resource', bearing: Math.PI - 0.01, dist: 5 },
    { kind: 'resource', bearing: -Math.PI + 0.01, dist: 15 }, // seam neighbor — merges
  ]

  const survivors = cluster_pips(cap_nearest_pips(pips))
  const mob_cluster = survivors.find(({ kind, count }) => kind === 'mob' && count === 2)
  const seam_cluster = survivors.find(({ kind }) => kind === 'resource')
  expect(mob_cluster?.dist).toBe(10) // the nearest member represents the cluster
  expect(seam_cluster?.count).toBe(2)
  expect(survivors.filter(({ kind }) => kind === 'mob')).toHaveLength(4) // 5 capped, 2 merged

  const labeled = thin_pip_labels(survivors, 1)
  expect(labeled.filter(({ kind, show_label }) => kind === 'mob' && show_label)).toHaveLength(1)
})

test('zone edges point at straight cardinal walks and name their neighbor zones', () => {
  // client space with offset 0: zone (0,0) spans [0,512)²; standing near the west edge
  const [nearest] = nearest_zone_edges(10, 256, 0, 0, 512, 0)
  expect(nearest!.edge).toBe('w')
  expect(nearest!.dist).toBe(10)
  expect(nearest!.bearing).toBeCloseTo(-Math.PI / 2)
  expect(neighbor_zone_key(0, 0, 'w')).toEqual({ zx: -1, zz: 0 })
  expect(neighbor_zone_key(0, 0, 's')).toEqual({ zx: 0, zz: 1 })

  // near a corner both close edges earn a marker
  expect(nearest_zone_edges(10, 20, 0, 0, 512, 0)).toHaveLength(2)
})
