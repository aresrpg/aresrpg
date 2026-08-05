// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2248 — a public Fight.fx trap row stores only its anchor plus `(zone_shape, zone_size)`. Its decoded ledger
// cells must therefore use the same direction-free board-zone derivation as trigger time, never a caster-less
// cast-zone query (which collapses LINE/TBAR/PODIUM/CONE to the anchor alone).

import { describe, expect, test } from 'bun:test'
import { K_PLACE_TRAP, SHAPE_CIRCLE, SHAPE_LINE } from '@aresrpg/sim/spell_effect'
import { board_zone_cells } from '@aresrpg/sim/spell_targeting'

import { decode, encode } from '../src/los.js'
import { read_fight_traps } from '../src/trap_ledger.js'

const ANCHOR = encode(10, 9)
const SIZE = 2
const sorted = (cells) => [...cells].sort((a, b) => a - b)

const row = (zone_shape) => ({
  fx: {
    cell_entries: [
      {
        kind: K_PLACE_TRAP,
        cell: String(ANCHOR),
        owner_team: 0,
        zone_shape,
        zone_size: String(SIZE),
      },
    ],
  },
})

const chain_semantics = (area_shape) =>
  board_zone_cells({ area_shape, area_size: SIZE }, decode(ANCHOR)).map(({ x, y }) => encode(x, y))

describe('#2248 — trap_ledger uses the placed board-zone home', () => {
  test('a stored LINE trap decodes to the trigger-time lozenge, not its anchor alone', () => {
    const [trap] = read_fight_traps(row(SHAPE_LINE))

    expect(trap.cells).toHaveLength(13)
    expect(sorted(trap.cells)).toEqual(sorted(chain_semantics(SHAPE_LINE)))
  })

  test('plain CIRCLE lozenge remains byte-for-byte aligned with the same home', () => {
    const [trap] = read_fight_traps(row(SHAPE_CIRCLE))

    expect(trap.cells).toHaveLength(13)
    expect(sorted(trap.cells)).toEqual(sorted(chain_semantics(SHAPE_CIRCLE)))
  })
})
