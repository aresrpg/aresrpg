// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1070 — the movement paint's candidate set consumes the same post-tackle MP verdict as the sim. The
// recorded #1743 rollback loses the whole pool, so presentation must offer no destination cells.

import { describe, expect, test } from 'bun:test'
import { encode } from '@aresrpg/sim/combat_grid'
import { tackle_contest, tackle_losses } from '@aresrpg/sim/fight_tackle'

import { presented_reachable_cells } from '../src/movement_candidates.js'
import { tackle_rollback_parity as fixture } from '../../sim/test/fixtures/tackle_rollback_parity.js'

describe('#1070 tackled movement presentation parity', () => {
  test('the recorded rolled-back move presents exactly the sim-allowed destinations', () => {
    const { num, den } = tackle_contest(
      fixture.runner.agility,
      fixture.lockers.map((locker) => locker.agility)
    )
    const { mp_lost } = tackle_losses(fixture.runner.ap, fixture.runner.mp, num, den)
    const movement_points = fixture.runner.mp - mp_lost
    const blocked = new Set(fixture.lockers.map(({ cell }) => encode(cell.x, cell.y)))

    expect(movement_points).toBe(fixture.move_verdict.mp_after)
    expect(
      presented_reachable_cells({
        start: encode(fixture.runner.cell.x, fixture.runner.cell.y),
        movement_points,
        blocked,
      })
    ).toEqual(
      fixture.move_verdict.allowed_cells
        .filter((cell) => cell.x !== fixture.runner.cell.x || cell.y !== fixture.runner.cell.y)
        .map((cell) => encode(cell.x, cell.y))
    )
  })
})
