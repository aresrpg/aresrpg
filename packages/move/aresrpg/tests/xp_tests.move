// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Raw XP-curve tests — the immutable tables under `progression`: the 200-level character curve
/// (`character_xp`) and the 100-level job curve + tier→level map (`job_xp`). These lock the verbatim tables
/// and the shared binary search against off-by-one drift.
#[test_only]
module aresrpg::xp_tests;

use aresrpg_foundation::{character_xp, job_xp};
use std::unit_test::assert_eq;

const CX_EBadLevel: u64 = 101; // character_xp

// ╔════════════════ [ Character curve (200 levels) ] ═════════════════════════ ]

#[test]
fun character_level_from_xp() {
  assert_eq!(character_xp::level_from_xp(0), 1);
  assert_eq!(character_xp::level_from_xp(110), 2);
  assert_eq!(character_xp::level_from_xp(109), 1);
  assert_eq!(character_xp::level_from_xp(2_800), 5); // exact level-5 threshold
  assert_eq!(character_xp::level_from_xp(7_407_232_000), 200);
  assert_eq!(character_xp::level_from_xp(7_407_231_999), 199);
  assert_eq!(character_xp::level_from_xp(50_000_000_000), 200); // clamp, never abort
}

#[test]
fun character_xp_for_level() {
  assert_eq!(character_xp::xp_for_level(1), 0);
  assert_eq!(character_xp::xp_for_level(2), 110);
  assert_eq!(character_xp::xp_for_level(30), 621_600);
  assert_eq!(character_xp::xp_for_level(200), 7_407_232_000);
  assert_eq!(character_xp::max_level(), 200);
}

#[test, expected_failure(abort_code = CX_EBadLevel, location = character_xp)]
fun character_xp_for_level_out_of_range_aborts() {
  character_xp::xp_for_level(201);
}

// ╔════════════════ [ Job curve (100 levels) + tier map ] ════════════════════ ]

#[test]
fun job_level_from_xp() {
  assert_eq!(job_xp::level_from_xp(0), 1);
  assert_eq!(job_xp::level_from_xp(49), 1);
  assert_eq!(job_xp::level_from_xp(50), 2); // exact level-2 threshold
  assert_eq!(job_xp::level_from_xp(140), 3);
  assert_eq!(job_xp::level_from_xp(139), 2);
  assert_eq!(job_xp::level_from_xp(581_687), 100);
  assert_eq!(job_xp::level_from_xp(581_686), 99);
  assert_eq!(job_xp::level_from_xp(9_999_999_999), 100); // clamp
  assert_eq!(job_xp::max_level(), 100);
}

#[test]
fun job_tier_to_level() {
  assert_eq!(job_xp::tier_to_level(0), 1); // guard: below T1 → level 1
  assert_eq!(job_xp::tier_to_level(1), 1);
  assert_eq!(job_xp::tier_to_level(2), 10);
  assert_eq!(job_xp::tier_to_level(3), 20);
  assert_eq!(job_xp::tier_to_level(10), 90);
  assert_eq!(job_xp::tier_to_level(11), 100);
  assert_eq!(job_xp::tier_to_level(12), 100); // cap holds past T11
}
