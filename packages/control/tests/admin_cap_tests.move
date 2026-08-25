// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_control::admin_cap_tests;

use aresrpg_control::admin::{Self, AdminCap};
use sui::test_scenario;

const OWNER: address = @0xA11CE;
const WORKER: address = @0xB0B;
const EGenesisEpoch: u64 = 4003;
const EAdminCapExpired: u64 = 4001;

#[test, expected_failure(abort_code = EGenesisEpoch, location = aresrpg_control::admin)]
fun a_temp_cap_cannot_be_minted_during_the_genesis_epoch() {
  let mut scenario = test_scenario::begin(OWNER);
  admin::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let cap = scenario.take_from_sender<AdminCap>();
  cap.mint_temp_admin_cap(WORKER, scenario.ctx());
  scenario.return_to_sender(cap);
  scenario.end();
}

#[test, expected_failure(abort_code = EAdminCapExpired, location = aresrpg_control::admin)]
fun a_temp_cap_minted_after_genesis_expires_with_its_epoch() {
  let mut scenario = test_scenario::begin(OWNER);
  admin::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  scenario.next_epoch(OWNER);
  let cap = scenario.take_from_sender<AdminCap>();
  cap.mint_temp_admin_cap(WORKER, scenario.ctx());
  scenario.return_to_sender(cap);
  scenario.next_epoch(WORKER);
  let temp = scenario.take_from_sender<AdminCap>();
  temp.verify(scenario.ctx());
  scenario.return_to_sender(temp);
  scenario.end();
}
