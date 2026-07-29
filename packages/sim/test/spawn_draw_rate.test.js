// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWN-DRAW RATE INSTRUMENT (#1491) — count what the real format-3 derive pipeline draws from a synthetic
// table. IDs are irrelevant to weighted selection, so the fixture uses obvious fake markers and carries no
// captured chain identity. Point-sized groups make every emitted mob exactly one weighted draw.
import { describe, test, expect } from 'bun:test'

import { rng_seed, rng_next } from '../src/prng.js'
import { derive_zone } from '../src/zone_derive.js'

import fixture from './fixtures/spawn_draw_rate_synthetic.json'

const BASIS_POINTS = 10_000
const RATE_TOLERANCE_BP = 20
const SAMPLE_ZONES = 512
const FORMAT_3_ROOT = [3, ...Array(32).fill(0)]

const table_archi_rate_bp = world => {
  const total_weight = world.mobs.reduce(
    (total, row) => total + row.rate_bp,
    0,
  )
  const archi_weight = world.mobs
    .filter(row => row.role === 'archi')
    .reduce((total, row) => total + row.rate_bp, 0)
  return (archi_weight / total_weight) * BASIS_POINTS
}

const sample_archi_rate_bp = world => {
  const archi_ids = new Set(
    world.mobs
      .filter(row => row.role === 'archi')
      .map(row => row.template_id),
  )
  let sampler_state = rng_seed(0x5eed_1491)
  let total_draws = 0
  let archi_draws = 0
  for (let index = 0; index < SAMPLE_ZONES; index += 1) {
    const next = rng_next(sampler_state)
    sampler_state = next.state
    const rows = derive_zone({
      zone: {
        seed: next.value,
        discovered_at_ms: 0,
        mob_bitmap: [],
        res_bitmap: [],
        group_root: FORMAT_3_ROOT,
      },
      zx: 0,
      zy: 0,
      world,
    }).filter(row => row.kind === 'mob')
    total_draws += rows.length
    archi_draws += rows.filter(row =>
      archi_ids.has(row.template_id),
    ).length
  }
  return {
    total_draws,
    rate_bp: (archi_draws / total_draws) * BASIS_POINTS,
  }
}

describe('spawn draw rate — deterministic synthetic table (#1491)', () => {
  test('realized archi share tracks the table rate within ±20 bp', () => {
    const expected_rate_bp = table_archi_rate_bp(fixture.world)
    const sample = sample_archi_rate_bp(fixture.world)

    expect(sample.total_draws).toBe(
      SAMPLE_ZONES * fixture.world.min_groups,
    )
    expect(
      Math.abs(sample.rate_bp - expected_rate_bp),
    ).toBeLessThanOrEqual(RATE_TOLERANCE_BP)
  })
})
