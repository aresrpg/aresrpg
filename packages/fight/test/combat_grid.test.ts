// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { GRID_CELLS, encode_cell, zone_cells, zone_rank } from '../src/combat_grid.ts'

const cases = Object.freeze([
  [encode_cell(10n, 9n), encode_cell(10n, 9n)],
  [encode_cell(15n, 9n), encode_cell(10n, 9n)],
  [encode_cell(5n, 9n), encode_cell(10n, 9n)],
  [encode_cell(10n, 14n), encode_cell(10n, 9n)],
  [encode_cell(10n, 4n), encode_cell(10n, 9n)],
  [encode_cell(0n, 0n), encode_cell(1n, 1n)],
  [encode_cell(19n, 18n), encode_cell(18n, 17n)],
] as const)

test('fighter-first zone ranks preserve every shape member and traversal order', () => {
  for (let shape = 0n; shape < 10n; shape += 1n) {
    for (const size of [0n, 1n, 3n, 10n]) {
      for (const [anchor, caster] of cases) {
        const expected = zone_cells(shape, size, anchor, caster)
        const ranked = Array.from({ length: Number(GRID_CELLS) }, (_, index) => {
          const cell = BigInt(index)
          return { cell, rank: zone_rank(shape, size, anchor, caster, cell) }
        }).filter((candidate): candidate is { cell: bigint; rank: bigint } => candidate.rank !== null)

        expect(
          ranked.sort((left, right) => Number(left.rank - right.rank)).map(({ cell }) => cell),
          `shape ${shape} size ${size} anchor ${anchor} caster ${caster}`
        ).toEqual(expected)
      }
    }
  }
})
