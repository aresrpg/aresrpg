// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared #[test_only] stand-up for the social suites (friends + party): init the ONE Version + AdminCap plus the
/// friends registry, then optionally enable the package. `enable = false` leaves it dark (exercises the dark-ship
/// gate). `OWNER` matches each suite's begin-tx address, so the AdminCap minted in tx0 is take-able here.
#[test_only]
module aresrpg_social::test_harness;

use aresrpg_social::{admin::{Self, AdminCap}, friends, version::{Self, Version}};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0x0A; // holds the AdminCap

public fun stand_up(sc: &mut Scenario, enable: bool) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  friends::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  if (enable) admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}
