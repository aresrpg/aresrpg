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
  push: [
    { caster_level: 2n, blocked_cells: 3n, roll: 0n, expected: 24n },
    { caster_level: 50n, blocked_cells: 3n, roll: 0n, expected: 27n },
    { caster_level: 50n, blocked_cells: 3n, roll: 7n, expected: 48n },
  ],
  // The fixed-point log driving crit. Recorded from the Move VM on 2026-08-21
  // (`sui move test` over `aresrpg_math::fight_math`), NOT from this twin — a
  // self-computed expectation would prove only that the twin agrees with itself.
  // `fight_math_tests.move` pins the SAME numbers on the Move side, so either
  // implementation drifting reds its own suite.
  ln_e6: [
    { x: 12n, expected: 2_484_904n }, // agility 0 — the curve's floor
    { x: 13n, expected: 2_564_944n },
    { x: 16n, expected: 2_772_588n }, // exact power of two: mantissa loop must contribute 0
    { x: 62n, expected: 4_127_131n },
    { x: 112n, expected: 4_718_494n }, // agility 100
    { x: 1_012n, expected: 6_919_678n }, // agility 1000
  ],
  // (crit_1_in, cri, agility) → X. One row per arm of `crit_denominator`.
  crit_denominator: [
    { crit_1_in: 1n, cri: 0n, agility: 0n, expected: 1n }, // <=2 short-circuit: always crits
    { crit_1_in: 2n, cri: 0n, agility: 0n, expected: 2n }, // <=2 short-circuit: 1-in-2
    { crit_1_in: 3n, cri: 2n, agility: 0n, expected: 2n }, // Cri eats the base → the floor of 2
    { crit_1_in: 30n, cri: 0n, agility: 0n, expected: 30n }, // the CAP: scaled 36 > base, agility never raises X
    { crit_1_in: 30n, cri: 0n, agility: 50n, expected: 21n },
    { crit_1_in: 30n, cri: 0n, agility: 1_000n, expected: 12n }, // heavy diminishing returns
    { crit_1_in: 30n, cri: 25n, agility: 100n, expected: 3n }, // Cri subtracts linearly first
    { crit_1_in: 50n, cri: 10n, agility: 100n, expected: 25n },
  ],
})
