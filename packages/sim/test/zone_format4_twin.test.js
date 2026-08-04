// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FORMAT-4 (member TREE) MIRROR — #2194. Format 4 changed the zone's COMMITMENT, never its stream: the chain
// derives a format-4 zone with the very functions it derives a format-3 zone with (`zones::derive_mobs` routes
// both through the member kernel; `zones::derive_res` passes `format >= 2` to the lattice). So the mirror's
// contract is an IDENTITY: swap the commitment's leading byte from 3 to 4 and not one derived row may move.
//
// The lattice rule that identity rests on is pinned next door, in `zone_resource_lattice_law.test.js`.
import { describe, test, expect } from 'bun:test'

import { derive_zone, commitment_format } from '../src/zone_derive.js'

import truth from './fixtures/zone_487_chain_truth.json'

/** The captured zone re-stamped with a commitment of `format` — same seed, same world, same everything else. */
const at_format = format =>
  derive_zone({
    zone: {
      ...truth.zone,
      group_root: [format, ...new Array(32).fill(0)],
    },
    zx: truth.zone.zx,
    zy: truth.zone.zy,
    world: truth.world,
    team_bound: truth.team_bound,
  })

const kind = (rows, k) => rows.filter(row => row.kind === k)

describe('commitment_format', () => {
  test('a 33-byte `0x04 ‖ digest` reads as format 4', () => {
    expect(commitment_format([4, ...new Array(32).fill(7)])).toBe(4)
  })

  test('an unknown leading byte is still 0 — a format we cannot derive is never guessed at', () => {
    expect(commitment_format([5, ...new Array(32).fill(7)])).toBe(0)
  })
})

describe('format 4 mirrors format 3 row for row', () => {
  test('the MOB stream is byte-identical — only the commitment shape changed', () => {
    expect(kind(at_format(4), 'mob')).toEqual(kind(at_format(3), 'mob'))
  })

  test('format-4 rows carry the roster and progress a member zone owes the fight door', () => {
    const [group] = kind(at_format(4), 'mob')
    expect(Array.isArray(group.members)).toBe(true)
    expect(group.members.length).toBeGreaterThan(0)
    expect(typeof group.progress).toBe('number')
  })

  test('the RESOURCE stream is byte-identical', () => {
    expect(kind(at_format(4), 'resource')).toEqual(kind(at_format(3), 'resource'))
  })
})

describe('a format-4 zone is a lattice zone', () => {
  test('its resource cells sit exactly where a format-2 zone’s do', () => {
    expect(kind(at_format(4), 'resource')).toEqual(kind(at_format(2), 'resource'))
  })
})
