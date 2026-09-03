// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::combat_gas_tests;

use aresrpg_combat::combat;

/// The captured expensive shape: nine fighters and one all-map two-row colony buff. The CI
/// invokes this test under its own gas ceiling; the ceiling only moves down.
#[test]
fun one_white_ant_turn_stays_under_the_ratchet() {
  let result = combat::white_ant_turn_gas_for_testing();
  assert!(result[0] == 0, 100 + result[0]);
  assert!(result[1] == 2, 200 + result[1]);
  assert!(result[2] == 8, 300 + result[2]);
}

/// Reproduces testnet transaction FUAVPN…WJe: a ten-fighter Cro Wani turn with a circle-2
/// allied buff followed by an attack. The deployed board-first resolver spent 68.2M computation.
#[test]
fun one_crowani_turn_stays_under_the_ratchet() {
  let result = combat::crowani_turn_gas_for_testing();
  assert!(result[0] == 1, 100 + result[0]);
  assert!(result[1] == 2, 200 + result[1]);
  assert!(result[2] == 8, 300 + result[2]);
  assert!(result[3] < 100, 400 + result[3]);
}

#[test]
fun one_three_mob_wave_stays_under_the_ratchet() {
  assert!(combat::three_mob_wave_gas_for_testing() >= 2, 0);
}
