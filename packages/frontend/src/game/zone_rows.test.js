// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { rows_from_state, zone_state_resolvable } from './zone_rows.js'

// The PURE composer seam of the search-cost rework: zone {seed, bitmaps} + World doc → live spawn rows. The
// vectors below are the SAME cross-language fixture both parity suites pin (zone_gen_tests.move
// `zone_comp_pipeline_matches_js_derive_zone` ↔ sim zone_derive.test.js), so this asserts the frontend's actual
// import path (zone_rows → @aresrpg/sim derive_zone) produces exactly what the chain would materialise.
const world = {
  zone_size: 512,
  bounds_x: 500000,
  bounds_z: 500000,
  min_groups: 3,
  max_groups: 3,
  min_nodes: 2,
  max_nodes: 2,
  mobs: [{ template_id: '0xb0b', rate_bp: 100, min_group: 2, max_group: 2, level: 0 }],
  resources: [{ template_id: '0xwheat', rate_bp: 100, min_qty: 1, max_qty: 1, job: 0, tier: 1 }],
}
const state = { seed: '9876543210', discovered_at_ms: 2000, mob_bitmap: [], res_bitmap: [] }

describe('zone_rows — the derived spawn-row composer', () => {
  test('derives the chain-pinned rows from a zone state (seed arrives as the SDK decimal string)', () => {
    const rows = rows_from_state(state, 488, 488, world, 6)
    const mobs = rows.filter((r) => r.kind === 'mob')
    const cells = rows.filter((r) => r.kind === 'resource')
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
    expect(cells[0]).toMatchObject({ spawn_id: '10736692352345019500', index: 0, x: 250175, z: 250326, remaining: 1 })
  })

  test('consumed bitmap bits filter rows out; survivors keep their DERIVATION index (the chain node_index)', () => {
    const rows = rows_from_state({ ...state, mob_bitmap: [0b001], res_bitmap: [0b001] }, 488, 488, world, 6)
    expect(rows.filter((r) => r.kind === 'mob').map((r) => r.index)).toEqual([1, 2])
    expect(rows.filter((r) => r.kind === 'resource').map((r) => r.index)).toEqual([1])
  })

  // THE CACHE-LAW INVERSION (absence read as "nothing consumed"). The consumed bitmaps are the ONLY per-group
  // liveness truth (zones.move `bit_set` fires at CLAIM time), and #596 made a fetched cell AUTHORITATIVE — its
  // rows REPLACE the zone's. So deriving from an absent bitmap does not merely lose a filter: it republishes
  // every consumed group as proven-live truth, which is the ghost-mob bug with extra confidence. An absent
  // bitmap is UNRESOLVABLE, never an empty one.
  test('a zone doc carrying a seed but NO bitmap is UNRESOLVABLE — absence is not emptiness', () => {
    const seeded = { seed: '9876543210', discovered_at_ms: 2000 }
    expect(zone_state_resolvable({ ...seeded, res_bitmap: [] })).toBe(false) // mob_bitmap absent
    expect(zone_state_resolvable({ ...seeded, mob_bitmap: [] })).toBe(false) // res_bitmap absent
    expect(zone_state_resolvable(seeded)).toBe(false) // both absent
    expect(zone_state_resolvable(null)).toBe(false)
  })

  test('a PRESENT-but-empty bitmap stays resolvable — the #596 replace path is untouched', () => {
    expect(zone_state_resolvable(state)).toBe(true)
    expect(zone_state_resolvable({ ...state, mob_bitmap: [0b001] })).toBe(true)
    // …and that empty-bitmap doc legitimately derives the FULL group set — which is exactly the row set an
    // absent bitmap would have fabricated. The two cases are indistinguishable downstream, which is why the
    // decision has to happen here, at the read seam, and not in the derivation.
    expect(rows_from_state(state, 488, 488, world, 6).filter((r) => r.kind === 'mob')).toHaveLength(3)
  })

  test('spawn spacing law holds through the composer (pairwise >= 20 blocks)', () => {
    const mobs = rows_from_state(state, 488, 488, world, 6).filter((r) => r.kind === 'mob')
    for (let i = 0; i < mobs.length; i++)
      for (let j = i + 1; j < mobs.length; j++) {
        const d2 = (mobs[i].x - mobs[j].x) ** 2 + (mobs[i].z - mobs[j].z) ** 2
        expect(d2).toBeGreaterThanOrEqual(400)
      }
  })
})
