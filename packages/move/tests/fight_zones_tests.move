// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Board-zone placement law driven through fight::resolve: anchors are unique across traps
/// and glyphs, their areas may overlap, and only traps require an unoccupied center.
#[test_only]
module aresrpg::fight_zones_tests;

use aresrpg::fight;
use sui::test_scenario;

const OWNER: address = @0xA11CE;
const EBadTargetCell: u64 = 1720;

fun resolve(
  existing_kind: u8,
  same_center: bool,
  target_occupied: bool,
  incoming_kinds: vector<u8>,
): vector<u64> {
  let mut scenario = test_scenario::begin(OWNER);
  let answer = fight::resolve_placement_for_testing(
    existing_kind,
    same_center,
    target_occupied,
    incoming_kinds,
    scenario.ctx(),
  );
  scenario.end();
  answer
}

fun assert_committed(answer: vector<u64>, expected_zones: u64) {
  assert!(answer[0] == expected_zones, 0);
  assert!(answer[1] == 4, 1);
  assert!(answer[2] == 1, 2);
  assert!(answer[3] == 1, 3);
}

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg::fight)]
fun trap_center_rejects_a_glyph() {
  resolve(12, true, false, vector[13]);
  abort 0
}

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg::fight)]
fun glyph_center_rejects_a_trap() {
  resolve(13, true, false, vector[12]);
  abort 0
}

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg::fight)]
fun trap_center_rejects_a_living_fighter() {
  resolve(0, false, true, vector[12]);
  abort 0
}

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg::fight)]
fun one_cast_cannot_create_two_zones_at_one_center() {
  resolve(0, false, false, vector[12, 13]);
  abort 0
}

#[test]
fun map_wide_zone_area_overlap_is_legal_when_centers_differ() {
  assert_committed(resolve(13, false, false, vector[12]), 2);
}

#[test]
fun glyph_center_accepts_a_living_fighter() {
  assert_committed(resolve(0, false, true, vector[13]), 1);
}
