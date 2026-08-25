// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The storage-reclaim law: a fully-settled fight closes and refunds; only a recorded
/// participant may close (bots must never farm player-funded deposits); an unsettled seat
/// blocks the door.
#[test_only]
module aresrpg::fight_close_tests;

use aresrpg::fight;
use sui::test_scenario;

const PLAYER: address = @0xA11CE;
const STRANGER: address = @0xBEEF;

#[test]
fun a_settled_fight_closes_for_its_player() {
  let mut scenario = test_scenario::begin(PLAYER);
  fight::close_for_testing(PLAYER, true, scenario.ctx());
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_stranger_cannot_collect_the_deposit() {
  let mut scenario = test_scenario::begin(STRANGER);
  fight::close_for_testing(PLAYER, true, scenario.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 1712, location = aresrpg::fight)]
fun an_unsettled_seat_blocks_the_door() {
  let mut scenario = test_scenario::begin(PLAYER);
  fight::close_for_testing(PLAYER, false, scenario.ctx());
  abort 999
}
