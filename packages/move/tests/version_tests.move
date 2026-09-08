// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::version_tests;

use aresrpg::version;
use aresrpg_control::admin;
use sui::test_scenario;

#[test]
fun freeze_blocks_gameplay_until_an_authorized_update() {
  let mut scenario = test_scenario::begin(@0xA);
  version::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut version = scenario.take_shared<version::Version>();
  version::assert_latest(&version);
  version::admin_freeze(&mut version, &cap, scenario.ctx());
  version::admin_update(&mut version, &cap, scenario.ctx());
  version::assert_latest(&version);
  test_scenario::return_shared(version);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test, expected_failure(abort_code = 601, location = aresrpg::version)]
fun frozen_version_refuses_gameplay() {
  let mut scenario = test_scenario::begin(@0xA);
  version::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut version = scenario.take_shared<version::Version>();
  version::admin_freeze(&mut version, &cap, scenario.ctx());
  version::assert_latest(&version);
  abort 999
}

#[test, expected_failure(abort_code = 601, location = aresrpg::version)]
fun current_version_cannot_be_updated_again() {
  let mut scenario = test_scenario::begin(@0xA);
  version::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut version = scenario.take_shared<version::Version>();
  version::admin_update(&mut version, &cap, scenario.ctx());
  abort 999
}
