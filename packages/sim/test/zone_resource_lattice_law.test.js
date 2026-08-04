// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LATTICE LAW — which commitment formats place RESOURCE cells on the lattice. `zones.move` states it once:
// `zone_comp::derive_res(world, zx, zy, seed, group_commitment_format(...) >= 2)`. Every format from 2 up is a
// lattice zone; format 3 changed what a group HOLDS, not where anything sits.
//
// This mirror tested `format === 2`, so every format-3 zone — i.e. every zone the deployed package has searched
// — had its resource cells derived off the LEGACY unspaced sampler while the chain placed them on the lattice:
// different positions, different draw counts, therefore different spawn ids on both streams. Found while
// widening the mirror for format 4 (#2194).
import { describe, test, expect } from 'bun:test'

import { derive_zone } from '../src/zone_derive.js'

import truth from './fixtures/zone_487_chain_truth.json'

/** The captured zone re-stamped with a commitment of `format` — same seed, same world, same everything else. */
const at_format = format =>
  derive_zone({
    zone: { ...truth.zone, group_root: [format, ...new Array(32).fill(0)] },
    zx: truth.zone.zx,
    zy: truth.zone.zy,
    world: truth.world,
    team_bound: truth.team_bound,
  })

const cells = format => at_format(format).filter(row => row.kind === 'resource')

describe('the lattice law — `format >= 2` is the chain’s rule, not `format === 2`', () => {
  // `zone_format_dispatch_tests::the_commitment_byte_selects_the_resource_derivation` asserts this ON CHAIN:
  // a member-list zone resolves its resource cells through the lattice kernel, exactly as a format-2 zone does.
  // Resource placement does not read the member model at all, so the two streams must be the SAME cells.
  test('a format-3 zone places resources on the lattice, exactly like format 2', () => {
    expect(cells(3)).toEqual(cells(2))
  })

  test('the legacy sampler is still what a format-1 zone gets — the fix widened the lattice, it did not erase the legacy stream', () => {
    const legacy = cells(1)
    expect(legacy).not.toEqual(cells(2))
  })
})
