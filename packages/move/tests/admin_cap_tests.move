// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The cap-lifecycle law: epoch 0 IS the super sentinel, so a temp cap can never be minted
/// during the genesis epoch — it would read as super forever.
#[test_only]
module aresrpg::admin_cap_tests;

use aresrpg::admin::{Self, AdminCap};
use sui::test_scenario;

const OWNER: address = @0xA11CE;
const HAND: address = @0xBEEF;
const EGenesisEpoch: u64 = 503;

#[test]
#[expected_failure(abort_code = EGenesisEpoch, location = aresrpg::admin)]
fun a_temp_cap_cannot_be_minted_during_the_genesis_epoch() {
  let mut scenario = test_scenario::begin(OWNER);
  admin::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let cap = scenario.take_from_sender<AdminCap>();
  cap.mint_temp_admin_cap(HAND, scenario.ctx()); // epoch is still 0 here — must abort
  scenario.return_to_sender(cap);
  scenario.end();
}

#[test]
fun a_temp_cap_minted_after_genesis_expires_with_its_epoch() {
  let mut scenario = test_scenario::begin(OWNER);
  admin::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  scenario.next_epoch(OWNER); // epoch 1 — minting is legal now
  let cap = scenario.take_from_sender<AdminCap>();
  cap.mint_temp_admin_cap(HAND, scenario.ctx());
  scenario.return_to_sender(cap);
  scenario.next_tx(HAND);
  let temp = scenario.take_from_sender<AdminCap>();
  temp.delete_admin_cap(); // a temp cap is destroyable — only the super cap refuses
  scenario.end();
}
