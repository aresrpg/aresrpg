// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PARITY FINGERPRINT (#1536 row 1) — "can A see B" has ONE answer. `@aresrpg/sim`'s `has_line_of_sight` ({x,y} +
// a blocking predicate — the gate every WORLD-mode cast rides through `spell_targeting.can_target`) and the
// encoded `lineOfSight` the dungeon board draws with are the same algorithm seen through two skins, and this test
// is the tooth that keeps them one.
//
// Why it matters more than a normal dedup: `lineOfSight` is the port of `combat_grid::blocks`, verdict-equivalent
// to the contract over 166,983 triples. A triple where the sim answers differently is a cast the client offers and
// the chain aborts — burned gas, every time. So the assertion is exhaustive over the space where an obstacle can
// possibly matter: 8 fixed origins x every board cell as target x every cell of the origin/target rectangle as the
// single obstacle. (`blocks` can only ever be true for a cell inside that rectangle, so the sweep is complete.)

import { has_line_of_sight } from '@aresrpg/sim/visibility'
import { describe, expect, test } from 'bun:test'

import { GRID_H, GRID_W, decode, encode, lineOfSight } from '../src/los.js'

/** Corners, centre, edges, off-axis — origins that exercise every octant and both axis-aligned degenerate cases. */
const ORIGINS = [
  { x: 0, y: 0 },
  { x: 19, y: 0 },
  { x: 0, y: 18 },
  { x: 19, y: 18 },
  { x: 10, y: 9 },
  { x: 5, y: 12 },
  { x: 13, y: 3 },
  { x: 7, y: 7 },
]

/** Every cell of the axis-aligned rectangle spanned by `a` and `b`, endpoints excluded — the only cells that can block. */
const rect_between = (a, b) => {
  const out = []
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue
      out.push({ x, y })
    }
  return out
}

/** The exact size of the sweep below — PINNED, never derived from the loop that produces it: a count compared
 *  against itself is always green and would hide a sweep that quietly stopped sweeping. */
const EXPECTED_TRIPLES = 216_506

describe('LOS parity — sim has_line_of_sight ≡ the Move-proven integer lineOfSight', () => {
  test('identical verdict on every (origin, target, obstacle) triple that can matter', () => {
    const disagreements = []
    const asymmetric = []
    let triples = 0

    for (const origin of ORIGINS) {
      const from = encode(origin.x, origin.y)
      for (let target = 0; target < GRID_W * GRID_H; target++) {
        const to = decode(target)
        for (const obstacle of rect_between(origin, to)) {
          triples++
          const blocks_los = (cell) => cell.x === obstacle.x && cell.y === obstacle.y
          const sim = has_line_of_sight(origin, to, blocks_los)
          const chain_twin = lineOfSight(from, target, [encode(obstacle.x, obstacle.y)])
          if (sim !== chain_twin) disagreements.push({ origin, target: to, obstacle, sim, chain_twin })
          // sight is mutual: the contract's own `blocks` is symmetric, and a fight where A can shoot B but B
          // cannot shoot back is the bug this pins (verified exhaustively over all 8,081,080 board triples).
          if (has_line_of_sight(to, origin, blocks_los) !== sim)
            asymmetric.push({ origin, target: to, obstacle, forward: sim })
        }
      }
    }

    // The COUNT is the headline: every disagreeing triple is one castable-looking cell the contract would refuse.
    expect({
      triples_swept: triples,
      disagreeing: disagreements.length,
      asymmetric: asymmetric.length,
      sample: disagreements.slice(0, 5),
    }).toEqual({ triples_swept: EXPECTED_TRIPLES, disagreeing: 0, asymmetric: 0, sample: [] })
  })

  test('an unobstructed line is visible and a body on the line is not (both surfaces)', () => {
    const from = { x: 1, y: 4 }
    const to = { x: 7, y: 4 }
    const open = () => false
    const wall_at_5 = (cell) => cell.x === 5 && cell.y === 4
    expect(has_line_of_sight(from, to, open)).toBe(true)
    expect(lineOfSight(encode(1, 4), encode(7, 4), [])).toBe(true)
    expect(has_line_of_sight(from, to, wall_at_5)).toBe(false)
    expect(lineOfSight(encode(1, 4), encode(7, 4), [encode(5, 4)])).toBe(false)
  })

  test('LOS is symmetric — A sees B iff B sees A', () => {
    const blocks_los = (cell) => cell.x === 6 && cell.y === 5
    for (const [a, b] of [
      [
        { x: 2, y: 5 },
        { x: 9, y: 5 },
      ],
      [
        { x: 3, y: 2 },
        { x: 9, y: 8 },
      ],
      [
        { x: 6, y: 1 },
        { x: 6, y: 9 },
      ],
    ])
      expect(has_line_of_sight(a, b, blocks_los)).toBe(has_line_of_sight(b, a, blocks_los))
  })
})
