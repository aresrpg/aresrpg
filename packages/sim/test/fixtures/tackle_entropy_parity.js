// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Move oracle vectors from origin/lane/tackle-entropy:
// packages/move/engine/tests/tackle_tests.move::contest_verdict_moves_with_the_turn +
// turn_entropy_0_loses_this_contest + turn_entropy_2_wins_this_contest.
//
// The contest inputs stay fixed (seat 0, slot 0, MP 3, equal zero-agility buckets => 2/4). Only the turn's
// stamped entropy carrier and fight-wide ordinal move. These are chain-authored values, not JS-generated
// expectations; the sim must reproduce them from the same public clock bytes.

export const tackle_entropy_parity = {
  fight: { world_seed: 12345, spawn_id: 1, seat: 0 },
  contest: {
    slot: 0,
    mp: 3,
    ap: 6,
    runner_agility: 0,
    locker_agility: 0,
    num: 2,
    den: 4,
  },
  cases: [
    {
      id: 'turn_entropy_42_ordinal_1_escapes',
      turn_entropy: 42,
      turn_ordinal: 1,
      turn_seed: 3114863173,
      tackle_state: 784571580,
      draw: 582013873,
      roll: 1,
      escaped: true,
      ap_after: 6,
      mp_after: 2,
    },
    {
      id: 'turn_entropy_42_ordinal_2_tackles',
      turn_entropy: 42,
      turn_ordinal: 2,
      turn_seed: 797912371,
      tackle_state: 3721317888,
      draw: 2439861210,
      roll: 2,
      escaped: false,
      ap_after: 3,
      mp_after: 1,
    },
    {
      id: 'turn_entropy_0_ordinal_2_tackles',
      turn_entropy: 0,
      turn_ordinal: 2,
      turn_seed: 1595451561,
      tackle_state: 1361970538,
      draw: 1561039407,
      roll: 3,
      escaped: false,
      ap_after: 3,
      mp_after: 1,
    },
    {
      id: 'turn_entropy_2_ordinal_2_escapes',
      turn_entropy: 2,
      turn_ordinal: 2,
      turn_seed: 1076131378,
      tackle_state: 1513727368,
      draw: 1205601081,
      roll: 1,
      escaped: true,
      ap_after: 6,
      mp_after: 2,
    },
  ],
}
