// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pinned by hand from the integer expressions in fight.move/fight_math.move.
// Expected values are recorded parity answers; runtime code never regenerates them.

export const MOVE_MATH_FIXTURE = Object.freeze({
  damage: {
    base: 20n,
    primary: 100n,
    raw_damage: 3n,
    centered_resistance: 32_788n,
    center: 32_768n,
    expected: 34n,
  },
  dodge: {
    rng: 8n,
    value: 3n,
    caster_wisdom: 100n,
    target_wisdom: 100n,
    current: 6n,
    maximum: 6n,
    expected_removed: 2n,
    expected_state: 1_199_730_151n,
  },
  push: {
    caster_level: 50n,
    blocked_cells: 3n,
    expected: 36n,
  },
})
