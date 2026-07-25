// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  derive_mob_groups,
  derive_resources,
  derive_zone,
  bit_get,
  level_cap,
  size_cap,
  spawn_distance_progress,
  spacing,
} from '../src/zone_derive.js'

import fixture from './fixtures/zone_group_release.json'

// The fixed input the Move parity test (zone_gen_tests.move::t_derive_mob_groups_matches_js_mirror) pins its
// reference vectors against — same seed/bands/geometry on both sides so a divergence fails ONE of the two suites.
const base = {
  seed: 123456789,
  min_g: 8,
  max_g: 8,
  weights: [100, 50],
  min_group: [1, 2],
  max_group: [6, 6],
  size_bound: 6,
  ox: 0,
  oz: 0,
  zsize: 512,
  bx: 500000,
  bz: 500000,
}

describe('zone_derive — seed-derived zone composition', () => {
  test('parity reference vectors (byte-for-byte with world_math.move derive_mob_groups)', () => {
    const g = derive_mob_groups(base)
    expect(g).toHaveLength(8)
    // the exact rows the on-chain Move test asserts — a change here that the chain does not mirror breaks
    // composition-at-discovery (the map would advertise a fight the chain materialises differently).
    expect(g[0]).toEqual({
      spawn_id: 4560507522876923188n,
      template_idx: 0,
      x: 510,
      z: 404,
      size: 2,
      group_seed: 2711362666,
    })
    expect(g[1]).toEqual({
      spawn_id: 148739572111110642n,
      template_idx: 1,
      x: 127,
      z: 313,
      size: 6,
      group_seed: 4214906596,
    })
    expect(g[4]).toEqual({
      spawn_id: 665305103150388313n,
      template_idx: 1,
      x: 213,
      z: 278,
      size: 3,
      group_seed: 572914111,
    })
    expect(g[7]).toEqual({
      spawn_id: 522455783208353171n,
      template_idx: 1,
      x: 63,
      z: 92,
      size: 6,
      group_seed: 1370609044,
    })
  })

  test('owner spawn-spacing law: every pair of groups is >= 20 blocks apart, over many seeds', () => {
    let violations = 0
    let worst = Infinity
    for (let seed = 1; seed <= 200; seed++) {
      const gs = derive_mob_groups({ ...base, seed })
      for (let i = 0; i < gs.length; i++)
        for (let j = i + 1; j < gs.length; j++) {
          const d2 = (gs[i].x - gs[j].x) ** 2 + (gs[i].z - gs[j].z) ** 2
          worst = Math.min(worst, Math.sqrt(d2))
          if (d2 < spacing * spacing) violations++
        }
    }
    expect(violations).toBe(0)
    expect(worst).toBeGreaterThanOrEqual(spacing)
  })

  test('deterministic: same seed -> identical composition', () => {
    expect(derive_mob_groups(base)).toEqual(derive_mob_groups(base))
  })

  test('positions confined to the zone box, sizes clamped to the bound', () => {
    for (const g of derive_mob_groups(base)) {
      expect(g.x).toBeGreaterThanOrEqual(base.ox)
      expect(g.x).toBeLessThan(base.ox + base.zsize)
      expect(g.z).toBeGreaterThanOrEqual(base.oz)
      expect(g.z).toBeLessThan(base.oz + base.zsize)
      expect(g.size).toBeGreaterThanOrEqual(1)
      expect(g.size).toBeLessThanOrEqual(base.size_bound)
    }
  })

  test('all-zero weights -> no groups (starved table breaks the loop)', () => {
    expect(derive_mob_groups({ ...base, weights: [0, 0] })).toHaveLength(0)
  })
})

describe('zone_derive — resource cells (one-harvest / one-bit)', () => {
  const res_base = {
    seed: 424242,
    min_n: 8,
    max_n: 8,
    weights: [100, 100],
    min_qty: [6, 6],
    max_qty: [6, 6],
    jobs: [0, 5],
    ox: 0,
    oz: 0,
    zsize: 512,
    bx: 500000,
    bz: 500000,
  }

  test('parity reference vectors (zone_gen_tests.move::t_derive_resources_matches_js_mirror)', () => {
    const cells = derive_resources(res_base)
    expect(cells).toHaveLength(12) // two 6-cell FARMER fields (the stream picked row 0 twice)
    expect(cells[0]).toEqual({
      spawn_id: 4278267242700732727n,
      template_idx: 0,
      x: 11,
      z: 40,
    })
    expect(cells[1]).toEqual({
      spawn_id: 6634652389384369540n,
      template_idx: 0,
      x: 12,
      z: 40,
    })
    expect(cells[5]).toEqual({
      spawn_id: 13261909094981075068n,
      template_idx: 0,
      x: 13,
      z: 39,
    })
    expect(cells[6]).toEqual({
      spawn_id: 14448448036690126015n,
      template_idx: 0,
      x: 245,
      z: 162,
    })
    expect(cells[11]).toEqual({
      spawn_id: 390510390697315139n,
      template_idx: 0,
      x: 243,
      z: 162,
    })
  })

  test('non-gather rows (job > 2) land single cells (the one-bit collapse)', () => {
    const cells = derive_resources({
      ...res_base,
      min_n: 3,
      max_n: 3,
      weights: [100],
      min_qty: [4],
      max_qty: [4],
      jobs: [5],
    })
    expect(cells).toHaveLength(3) // 3 picks -> 3 single cells, never a field, never a charge counter
    expect(cells[0]).toEqual({
      spawn_id: 2975216761506653025n,
      template_idx: 0,
      x: 11,
      z: 40,
    })
    expect(cells[2]).toEqual({
      spawn_id: 13191861150870521758n,
      template_idx: 0,
      x: 494,
      z: 395,
    })
  })

  test('deterministic: same seed -> identical cell list', () => {
    expect(derive_resources(res_base)).toEqual(derive_resources(res_base))
  })
})

describe('zone_derive — the full derive_zone pipeline (chain twin: zone_comp.move)', () => {
  // Mirror of the Move test zones_tests.move::zone_comp_pipeline_matches_js_derive_zone — the SAME world doc,
  // zone (488,488), seed 9876543210 (> u32, pins the seed-masking path), team bound 6.
  const world = {
    zone_size: 512,
    bounds_x: 500000,
    bounds_z: 500000,
    spawn_zone_x: 1000,
    spawn_zone_z: 1000,
    min_groups: 3,
    max_groups: 3,
    min_nodes: 2,
    max_nodes: 2,
    mobs: [
      {
        template_id: '0xb0b',
        rate_bp: 100,
        min_group: 2,
        max_group: 2,
        level: 0,
      },
    ],
    resources: [
      {
        template_id: '0xwheat',
        rate_bp: 100,
        min_qty: 1,
        max_qty: 1,
        job: 0,
        tier: 1,
      },
    ],
  }
  const zone = {
    seed: 9876543210,
    discovered_at_ms: 2000,
    mob_bitmap: [],
    res_bitmap: [],
  }

  test('rows match the Move zone_comp vectors (weights, size cap, geometry, template mapping)', () => {
    const rows = derive_zone({ zone, zx: 488, zy: 488, world, team_bound: 6 })
    const mobs = rows.filter(r => r.kind === 'mob')
    const cells = rows.filter(r => r.kind === 'resource')
    expect(mobs).toHaveLength(3)
    expect(cells).toHaveLength(2)
    expect(mobs[0]).toEqual({
      spawn_id: '11220703129345358465',
      kind: 'mob',
      index: 0,
      x: 250008,
      z: 250195,
      template_id: '0xb0b',
      size: 2,
      spawned_at_ms: 2000,
      group_seed: '3875465078',
    })
    expect(mobs[2]).toMatchObject({
      spawn_id: '8618570982553016694',
      index: 2,
      x: 250239,
      z: 250329,
      size: 2,
    })
    expect(cells[0]).toEqual({
      spawn_id: '10736692352345019500',
      kind: 'resource',
      index: 0,
      x: 250175,
      z: 250326,
      template_id: '0xwheat',
      remaining: 1,
      job: 0,
      tier: 1,
    })
    expect(cells[1]).toMatchObject({
      spawn_id: '4596960998799914108',
      index: 1,
      x: 250267,
      z: 250287,
    })
  })

  test('consumed bits filter rows out but surviving rows KEEP their derivation index', () => {
    // bit 0 (mob) + bit 1 (resource) set — zones.move bit layout: byte i>>3, bit i&7
    const rows = derive_zone({
      zone: { ...zone, mob_bitmap: [0b001], res_bitmap: [0b010] },
      zx: 488,
      zy: 488,
      world,
      team_bound: 6,
    })
    const mobs = rows.filter(r => r.kind === 'mob')
    const cells = rows.filter(r => r.kind === 'resource')
    expect(mobs.map(m => m.index)).toEqual([1, 2]) // group 0 consumed; survivors keep indices 1 and 2
    expect(cells.map(c => c.index)).toEqual([0]) // cell 1 harvested; cell 0 survives at its own index
  })

  test('#609 parity fixture — a LOST fight releases the group back at its spot', () => {
    // The chain twin: every `mob_bitmap` below is the exact byte vector the Move door test asserts on the World
    // (see the fixture's provenance field). Projecting each step must show the group leaving the map at the claim
    // and coming back — same index, same spawn_id, same position — once the defeat releases it. A regression on
    // either side (a chain release that stops clearing the bit, a mirror that stops re-showing the group)
    // fails HERE and in the Move suite.
    const { world, zone, steps, released_group } = fixture
    const project = mob_bitmap =>
      derive_zone({
        zone: { ...zone, mob_bitmap },
        zx: zone.zx,
        zy: zone.zy,
        world,
        team_bound: 6,
      }).filter(r => r.kind === 'mob')

    const projected = steps.map(s => project(s.mob_bitmap))
    steps.forEach((s, i) =>
      expect(projected[i].map(m => m.index)).toEqual(s.live_indices),
    )
    const [searched, , released] = projected
    const before = searched.find(m => m.index === released_group.index)
    const after = released.find(m => m.index === released_group.index)
    expect(after).toEqual(before) // back at its spot, unchanged — not a re-rolled replacement group
    expect(after).toMatchObject({
      spawn_id: released_group.spawn_id,
      x: released_group.x,
      z: released_group.z,
      size: released_group.size,
      template_id: released_group.template_id,
    })
  })

  test('bit_get reads the zones.move bitmap layout (byte i>>3, bit i&7; short bitmaps read 0)', () => {
    expect(bit_get([0b0000_0101], 0)).toBe(1)
    expect(bit_get([0b0000_0101], 1)).toBe(0)
    expect(bit_get([0b0000_0101], 2)).toBe(1)
    expect(bit_get([0, 0b1000_0000], 15)).toBe(1)
    expect(bit_get([], 40)).toBe(0) // lazily-grown bitmap — unset bytes read live
    expect(bit_get(undefined, 3)).toBe(0)
  })
})

describe('zone_derive — spawn-zone-relative difficulty', () => {
  const progress = (zx, zy) =>
    spawn_distance_progress({
      ox: zx * 512,
      oz: zy * 512,
      zsize: 512,
      bx: 500000,
      bz: 500000,
      spawn_x: 1000,
      spawn_z: 1000,
    })

  test('every zone intersecting the 1000x1000 fresh-join box stays at the roster floor', () => {
    expect(progress(487, 487)).toBe(0)
    expect(progress(487, 489)).toBe(0)
    expect(progress(489, 487)).toBe(0)
    expect(progress(489, 489)).toBe(0)
    expect(level_cap(progress(489, 489), 3, 12)).toBe(3)
    expect(size_cap(progress(489, 489), 6)).toBe(2)
  })

  test('the existing continuous curve begins at the spawn boundary and reaches the far band', () => {
    const values = [
      progress(489, 488),
      progress(490, 488),
      progress(492, 488),
      progress(500, 488),
    ]
    expect(values[0]).toBe(0)
    expect(values[0]).toBeLessThan(values[1])
    expect(values[1]).toBeLessThan(values[2])
    expect(values[2]).toBeLessThan(values[3])
    expect(level_cap(values[1], 3, 12)).toBeLessThan(
      level_cap(values[2], 3, 12),
    )
    expect(values[3]).toBe(1000)
    expect(level_cap(values[3], 3, 12)).toBe(12)
    expect(size_cap(values[3], 6)).toBe(6)
  })
})
