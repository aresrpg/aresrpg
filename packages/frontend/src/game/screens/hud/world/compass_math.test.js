// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import {
  wrap_pi,
  bearing_of,
  camera_heading,
  relative_bearing,
  strip_x,
  format_mmss,
  HALF_SPAN,
  zone_reconciled,
  reconciled_zone_row,
  ZONE_REFRESH_TRIES,
  ZONE_REFRESH_INTERVAL_MS,
  zone_edge_distances,
  nearest_zone_edges,
  neighbor_zone_key,
  NEAR_EDGE_THRESHOLD,
  cap_nearest_pips,
  cluster_pips,
  thin_pip_labels,
  PIP_CAP,
  LABEL_CAP,
} from './compass_math.js'
import { zone_discovered, reroll_at, zone_searchable } from '@aresrpg/world/spawns_reconcile'

const DEG = Math.PI / 180

describe('wrap_pi', () => {
  it('wraps into [-π, π)', () => {
    expect(wrap_pi(0)).toBeCloseTo(0)
    expect(wrap_pi(3 * Math.PI)).toBeCloseTo(-Math.PI) // 3π ≡ π → wraps to the -π edge
    expect(wrap_pi(-3 * Math.PI)).toBeCloseTo(-Math.PI)
    expect(wrap_pi(370 * DEG)).toBeCloseTo(10 * DEG)
    expect(wrap_pi(-370 * DEG)).toBeCloseTo(-10 * DEG)
  })
})

describe('bearing_of (N = -Z, E = +X)', () => {
  it('maps the four axis directions to the four cardinals', () => {
    expect(bearing_of(0, -1)).toBeCloseTo(0) // north
    expect(bearing_of(1, 0)).toBeCloseTo(Math.PI / 2) // east
    expect(Math.abs(bearing_of(0, 1))).toBeCloseTo(Math.PI) // south (±π)
    expect(bearing_of(-1, 0)).toBeCloseTo(-Math.PI / 2) // west
  })
})

describe('camera_heading (forward = (-sin yaw, -cos yaw))', () => {
  it('equals the bearing of the actual forward vector for any yaw', () => {
    for (const yaw of [0, 0.4, Math.PI / 2, Math.PI, -2.9, 5.1]) {
      const fwd = bearing_of(-Math.sin(yaw), -Math.cos(yaw))
      expect(wrap_pi(camera_heading(yaw) - fwd)).toBeCloseTo(0)
    }
  })
})

describe('relative_bearing wraparound', () => {
  it('takes the short way across the ±π seam', () => {
    // target at 170°, camera heading -170° → 20° to the RIGHT, never -340°
    expect(relative_bearing(170 * DEG, -170 * DEG)).toBeCloseTo(-20 * DEG)
    expect(relative_bearing(-170 * DEG, 170 * DEG)).toBeCloseTo(20 * DEG)
    // dead ahead and dead behind
    expect(relative_bearing(45 * DEG, 45 * DEG)).toBeCloseTo(0)
    expect(Math.abs(relative_bearing(0, Math.PI))).toBeCloseTo(Math.PI)
  })
})

describe('strip_x', () => {
  it('centers 0, hits the edges at ±HALF_SPAN, nulls outside', () => {
    expect(strip_x(0)).toBeCloseTo(0.5)
    expect(strip_x(HALF_SPAN)).toBeCloseTo(1)
    expect(strip_x(-HALF_SPAN)).toBeCloseTo(0)
    expect(strip_x(HALF_SPAN * 1.01)).toBeNull()
    expect(strip_x(Math.PI)).toBeNull()
  })
})

describe('format_mmss', () => {
  it('formats totals in minutes:seconds and clamps at zero', () => {
    expect(format_mmss(0)).toBe('0:00')
    expect(format_mmss(59_000)).toBe('0:59')
    expect(format_mmss(61_000)).toBe('1:01')
    expect(format_mmss(2 * 60 * 60 * 1000)).toBe('120:00') // the 2 h zone-TTL default
    expect(format_mmss(7_199_499)).toBe('119:59')
    expect(format_mmss(-5_000)).toBe('0:00')
  })
})

// ZONE READINESS — mirrors zones.move §17.1 (search re-opens a discovered zone only after its TTL elapses).
// This is the exact predicate the DiscoveryPrompts [F] SEARCH re-arm and the CompassStrip cooldown share.
const TTL = 2 * 60 * 60 * 1000 // 2 h default
const disc = (discovered_at_ms) => ({ zx: 1, zy: 2, discovered: true, discovered_at_ms })

describe('zone_discovered', () => {
  it('is true for a present, non-undiscovered row; false for null / explicit undiscovered', () => {
    expect(zone_discovered(null)).toBe(false)
    expect(zone_discovered(undefined)).toBe(false)
    expect(zone_discovered({ discovered: false })).toBe(false)
    expect(zone_discovered({ zx: 1, zy: 2 })).toBe(true) // present, discovered !== false
    expect(zone_discovered(disc(1000))).toBe(true)
  })
})

describe('reroll_at', () => {
  it('is discovered_at_ms + ttl for a discovered zone, else null', () => {
    expect(reroll_at(disc(1000), TTL)).toBe(1000 + TTL)
    expect(reroll_at(null, TTL)).toBeNull() // undiscovered
    expect(reroll_at(disc(1000), null)).toBeNull() // ttl unknown (world doc not loaded)
    expect(reroll_at({ discovered: true }, TTL)).toBeNull() // no discovered_at_ms
  })
})

describe('zone_searchable (the [F] SEARCH re-arm gate)', () => {
  it('an undiscovered zone is always searchable — even before the world TTL loads', () => {
    expect(zone_searchable(null, null, 0)).toBe(true)
    expect(zone_searchable(undefined, TTL, 123)).toBe(true)
  })
  it('a discovered zone re-opens exactly once its TTL elapses', () => {
    const at = 1_000_000
    expect(zone_searchable(disc(at), TTL, at + TTL - 1)).toBe(false) // still fresh — search would EZoneFresh
    expect(zone_searchable(disc(at), TTL, at + TTL)).toBe(true) // elapsed — re-arms [F]
    expect(zone_searchable(disc(at), TTL, at + TTL + 5000)).toBe(true)
  })
  it('a discovered zone with an unknown TTL stays un-armed (never a doomed re-search)', () => {
    expect(zone_searchable(disc(1000), null, 9_999_999)).toBe(false)
  })
})

// SEARCH-SUCCESS RECONCILE — the compass's post-search bounded retry (UX-latency fix: the compass
// used to take a bit of time to update after searching a zone). zone_reconciled is the spawn-set-changed test;
// ZONE_REFRESH_TRIES/_INTERVAL_MS is the bounded-give-up policy CompassStrip.jsx's retry loop spends.
describe('ZONE_REFRESH policy (bounded give-up — never an unbounded wait)', () => {
  it('the policy is 4 tries at 800ms (3.2s worst case)', () => {
    expect(ZONE_REFRESH_TRIES).toBe(4)
    expect(ZONE_REFRESH_INTERVAL_MS).toBe(800)
  })
})

describe('zone_reconciled (spawn-set-changed detection)', () => {
  it('false while the fresh read still shows the pre-search timestamp (indexer not caught up yet)', () => {
    expect(zone_reconciled(disc(1000), 1000)).toBe(false)
  })
  it('true once the fresh read carries a NEW discovered_at_ms (a real reconciliation, never a re-fetch echo)', () => {
    expect(zone_reconciled(disc(2000), 1000)).toBe(true)
  })
  it('true for a first-ever discovery (prior_at_ms null) the instant a row exists', () => {
    expect(zone_reconciled(disc(1000), null)).toBe(true)
  })
  it('false on a missing/undiscovered row — nothing to reconcile against yet', () => {
    expect(zone_reconciled(null, 1000)).toBe(false)
    expect(zone_reconciled({ discovered: false }, 1000)).toBe(false)
  })
  it('false on a discovered row with no timestamp (never a false positive off undefined)', () => {
    expect(zone_reconciled({ discovered: true }, 1000)).toBe(false)
  })
})

// RECEIPT vs POLL — the ONE merge (UX-latency fix: the compass used to stay on unsearched far too long
// after the search was revealed). reconciled_zone_row is what lets CompassStrip flip the instant the search
// tx's OWN receipt lands in the shared spawns/zones core (zone_row_of, @aresrpg/world), never waiting out its
// own poll cadence — pipeline law №1: predict off the receipt, a poll never regresses a receipt-proven fact.
describe('reconciled_zone_row (receipt vs poll — pipeline law №1)', () => {
  it('a receipt discovers the cell before the RPC poll has ever answered (store wins, rpc null)', () => {
    expect(reconciled_zone_row(disc(5000), null)).toEqual(disc(5000))
  })
  it('a receipt discovers the cell while the RPC still reports the stale pre-search row (store wins)', () => {
    expect(reconciled_zone_row(disc(5000), { discovered: false })).toEqual(disc(5000))
  })
  it('no receipt yet — falls through to whatever the RPC poll reports', () => {
    expect(reconciled_zone_row(null, disc(1000))).toEqual(disc(1000))
    expect(reconciled_zone_row(null, { discovered: false })).toBeNull()
    expect(reconciled_zone_row(null, null)).toBeNull()
  })
  it('an RPC row that has since caught up — or moved further on a re-search — wins once it is actually newer', () => {
    expect(reconciled_zone_row(disc(1000), disc(2000))).toEqual(disc(2000))
  })
  it('agreement (or a stale/non-newer RPC echo) holds the receipt — never a flicker off a slower timestamp', () => {
    expect(reconciled_zone_row(disc(2000), disc(2000))).toEqual(disc(2000))
    expect(reconciled_zone_row(disc(2000), disc(1000))).toEqual(disc(2000))
  })
})

// ZONE BOUNDARY MARKERS — the "how do I reach the next zone" compass edge markers. Zone cell (0,0),
// zone_size 100, no offset unless a case says otherwise: world bounds are [0,100) × [0,100).
describe('zone_edge_distances', () => {
  it('at dead center, all 4 edges are equidistant, N/E/S/W order, correct bearings', () => {
    const edges = zone_edge_distances(50, 50, 0, 0, 100, 0, 0)
    expect(edges.map((e) => e.edge)).toEqual(['n', 'e', 's', 'w'])
    expect(edges.map((e) => e.dist)).toEqual([50, 50, 50, 50])
    expect(edges[0].bearing).toBeCloseTo(0) // n
    expect(edges[1].bearing).toBeCloseTo(Math.PI / 2) // e
    expect(Math.abs(edges[2].bearing)).toBeCloseTo(Math.PI) // s
    expect(edges[3].bearing).toBeCloseTo(-Math.PI / 2) // w
  })

  it('near the NW corner: w and n are both close, e and s are far', () => {
    const edges = zone_edge_distances(10, 15, 0, 0, 100, 0, 0)
    const by = Object.fromEntries(edges.map((e) => [e.edge, e.dist]))
    expect(by.w).toBe(10)
    expect(by.n).toBe(15)
    expect(by.e).toBe(90)
    expect(by.s).toBe(85)
  })

  it('handles a real-scale negative-world zone (west/north of the signed origin) correctly', () => {
    // zone_size 512, default-bounds offset 250_000 — the zone at CHAIN (0,0) sits at the world's low
    // edge, entirely at negative world coords: world x/z ∈ [-250000, -249488).
    const edges = zone_edge_distances(-249_900, -249_950, 0, 0, 512, 250_000, 250_000)
    const by = Object.fromEntries(edges.map((e) => [e.edge, e.dist]))
    expect(by.w).toBe(100) // world_x - x_min = -249900 - (-250000)
    expect(by.e).toBe(412) // x_max - world_x = -249488 - (-249900)
    expect(by.n).toBe(50) // world_z - z_min = -249950 - (-250000)
    expect(by.s).toBe(462) // z_max - world_z = -249488 - (-249950)
  })
})

describe('nearest_zone_edges', () => {
  it('the default threshold is ~96 blocks', () => {
    expect(NEAR_EDGE_THRESHOLD).toBe(96)
  })

  it('returns only the single nearest when the 2nd-nearest is far (no corner)', () => {
    // w=40 (nearest), s=212 (2nd) — 212 > NEAR_EDGE_THRESHOLD, so no 2nd marker.
    const edges = nearest_zone_edges(40, 300, 0, 0, 512, 0, 0)
    expect(edges).toEqual([{ edge: 'w', bearing: -Math.PI / 2, dist: 40 }])
  })

  it('adds the 2nd-nearest when within NEAR_EDGE_THRESHOLD (near a corner, distinct distances)', () => {
    // w=40, n=60 — both within 96, nearest-first.
    const edges = nearest_zone_edges(40, 60, 0, 0, 512, 0, 0)
    expect(edges.map((e) => e.edge)).toEqual(['w', 'n'])
    expect(edges.map((e) => e.dist)).toEqual([40, 60])
  })

  it('standing exactly at a corner: two edges tie, order is deterministic (fixed N/E/S/W input order)', () => {
    // NW corner exactly: n=40 and w=40 tie; n precedes w in the fixed input order, so a stable sort keeps it first.
    const edges = nearest_zone_edges(40, 40, 0, 0, 512, 0, 0)
    expect(edges).toEqual([
      { edge: 'n', bearing: 0, dist: 40 },
      { edge: 'w', bearing: -Math.PI / 2, dist: 40 },
    ])
  })

  it('respects a custom near_threshold', () => {
    const edges = nearest_zone_edges(40, 60, 0, 0, 512, 0, 0, 10)
    expect(edges.map((e) => e.edge)).toEqual(['w']) // 2nd-nearest (60) now exceeds the tightened threshold
  })
})

describe('neighbor_zone_key', () => {
  it('steps exactly one cell across the given edge', () => {
    expect(neighbor_zone_key(5, 5, 'n')).toEqual({ zx: 5, zy: 4 })
    expect(neighbor_zone_key(5, 5, 's')).toEqual({ zx: 5, zy: 6 })
    expect(neighbor_zone_key(5, 5, 'e')).toEqual({ zx: 6, zy: 5 })
    expect(neighbor_zone_key(5, 5, 'w')).toEqual({ zx: 4, zy: 5 })
  })

  it('at the world low edge, steps into a negative key rather than throwing (an honest "no data" miss)', () => {
    expect(neighbor_zone_key(0, 0, 'w')).toEqual({ zx: -1, zy: 0 })
    expect(neighbor_zone_key(0, 0, 'n')).toEqual({ zx: 0, zy: -1 })
  })
})

// PIP DENSITY CONTROL — the "pip soup" fix: cap → cluster → label-thin, in that exact order.
describe('cap_nearest_pips', () => {
  it('the default cap is 5 per kind', () => {
    expect(PIP_CAP).toEqual({ mob: 5, resource: 5 })
  })

  it('keeps only the nearest N of each kind independently, dropping the rest', () => {
    const mobs = [10, 80, 20, 70, 30, 60, 40, 50].map((dist, i) => ({ kind: 'mob', id: `m${i}`, dist }))
    const resources = [5, 15].map((dist, i) => ({ kind: 'resource', id: `r${i}`, dist }))
    const out = cap_nearest_pips([...mobs, ...resources])
    expect(out.filter((p) => p.kind === 'resource')).toHaveLength(2) // under the cap — all survive
    const kept_mobs = out.filter((p) => p.kind === 'mob')
    expect(kept_mobs).toHaveLength(5)
    expect(kept_mobs.map((p) => p.dist).sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50])
  })

  it('a kind missing from `caps` keeps everything (no accidental starvation)', () => {
    const pips = [1, 2, 3].map((dist, i) => ({ kind: 'resource', id: `r${i}`, dist }))
    expect(cap_nearest_pips(pips, { mob: 2 })).toHaveLength(3)
  })

  it('respects a custom cap', () => {
    const mobs = [10, 20, 30].map((dist, i) => ({ kind: 'mob', id: `m${i}`, dist }))
    expect(cap_nearest_pips(mobs, { mob: 1 })).toEqual([{ kind: 'mob', id: 'm0', dist: 10 }])
  })
})

describe('cluster_pips', () => {
  const p = (kind, bearing_deg, dist, id) => ({ kind, id, dist, bearing: bearing_deg * DEG })

  it('merges two same-kind pips within CLUSTER_ANGLE_DEG, the nearer one representing the cluster', () => {
    const out = cluster_pips([p('mob', 10, 50, 'far'), p('mob', 11, 20, 'near')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'near', dist: 20, count: 2 })
  })

  it('leaves pips beyond the angle threshold separate', () => {
    const out = cluster_pips([p('mob', 0, 20, 'a'), p('mob', 5, 30, 'b')])
    expect(out).toHaveLength(2)
    expect(out.every((o) => o.count === 1)).toBe(true)
  })

  it('chains transitively: A-B and B-C close merges all 3, even though A-C alone would not', () => {
    const out = cluster_pips([p('mob', 0, 30, 'a'), p('mob', 1.5, 10, 'b'), p('mob', 3, 40, 'c')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'b', dist: 10, count: 3 }) // 'b' is the nearest of the 3
  })

  it('never merges across kinds, even at the identical bearing', () => {
    const out = cluster_pips([p('mob', 0, 10, 'm'), p('resource', 0, 10, 'r')])
    expect(out).toHaveLength(2)
  })

  it('wraps the ±π seam (bearings at +179° and -179° are 2° apart the short way)', () => {
    const out = cluster_pips([p('mob', 179, 15, 'a'), p('mob', -179, 25, 'b')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', count: 2 })
  })
})

describe('thin_pip_labels', () => {
  it('the default label cap is 3', () => {
    expect(LABEL_CAP).toBe(3)
  })

  it('labels only the nearest N of each kind, dot-only past that, order preserved', () => {
    const mobs = [50, 10, 40, 20, 30].map((dist, i) => ({ kind: 'mob', id: `m${i}`, dist }))
    const resources = [35, 5, 25, 15].map((dist, i) => ({ kind: 'resource', id: `r${i}`, dist }))
    const input = [...mobs, ...resources]
    const out = thin_pip_labels(input)
    // order is untouched (same length + same id sequence as input)
    expect(out.map((p) => p.id)).toEqual(input.map((p) => p.id))
    const labeled_mob_dists = out
      .filter((p) => p.kind === 'mob' && p.show_label)
      .map((p) => p.dist)
      .sort((a, b) => a - b)
    const labeled_resource_dists = out
      .filter((p) => p.kind === 'resource' && p.show_label)
      .map((p) => p.dist)
      .sort((a, b) => a - b)
    expect(labeled_mob_dists).toEqual([10, 20, 30])
    expect(labeled_resource_dists).toEqual([5, 15, 25])
    expect(out.filter((p) => p.show_label)).toHaveLength(6)
  })

  it('respects a custom label_cap', () => {
    const mobs = [10, 20, 30].map((dist, i) => ({ kind: 'mob', id: `m${i}`, dist }))
    const out = thin_pip_labels(mobs, 1)
    expect(out.filter((p) => p.show_label).map((p) => p.id)).toEqual(['m0'])
  })
})
