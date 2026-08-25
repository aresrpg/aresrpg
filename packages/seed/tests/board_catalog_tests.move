// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The door contract's behavior floor, proven on its reference instance: adds append densely,
/// picks copy the stored board, replace edits in place, the revision counts every write, and
/// `freeze_forever` (cold key only) closes the doors for eternity.
#[test_only]
module aresrpg_seed::board_catalog_tests;

use aresrpg_math::combat_grid;
use aresrpg_control::admin;
use aresrpg_seed::{board_catalog::{Self, BoardCatalog}, registry};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

fun fixture_board(): combat_grid::GridSpec {
  let mut mask = combat_grid::empty_mask();
  let mut y = 0;
  while (y < 10) {
    let mut x = 0;
    while (x < 10) {
      combat_grid::mask_set(&mut mask, combat_grid::encode(x, y));
      x = x + 1;
    };
    y = y + 1;
  };
  combat_grid::grid_spec(
    10, 10, mask,
    vector[combat_grid::encode(5, 5)],
    vector[],
    vector[
      combat_grid::encode(0, 0), combat_grid::encode(1, 0), combat_grid::encode(2, 0),
      combat_grid::encode(3, 0), combat_grid::encode(4, 0), combat_grid::encode(5, 0),
    ],
    vector[
      combat_grid::encode(4, 9), combat_grid::encode(5, 9), combat_grid::encode(6, 9),
      combat_grid::encode(7, 9), combat_grid::encode(8, 9), combat_grid::encode(9, 9),
    ],
  )
}

#[test]
fun adds_are_dense_picks_copy_and_the_revision_counts() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  board_catalog::create_catalog(&cap, &mut root, scenario.ctx());
  scenario.next_tx(OWNER);
  let mut catalog = scenario.take_shared<BoardCatalog>();
  board_catalog::add_board(&cap, &mut root, &mut catalog, fixture_board(), scenario.ctx());
  board_catalog::add_board(&cap, &mut root, &mut catalog, fixture_board(), scenario.ctx());
  assert!(board_catalog::len(&catalog) == 2, 0);
  // create + 2 adds = 3 writes on the one revision stream
  assert!(registry::revision(&root) == 3, 1);
  // any entropy maps into the dense range and copies the stored board out
  let picked = board_catalog::pick(&catalog, 7);
  assert!(picked.width() == 10 && !picked.start_cells_a().is_empty(), 2);
  board_catalog::replace_board(&cap, &mut root, &mut catalog, 1, fixture_board(), scenario.ctx());
  assert!(registry::revision(&root) == 4 && board_catalog::len(&catalog) == 2, 3);
  board_catalog::remove_last_board(&cap, &mut root, &mut catalog, scenario.ctx());
  assert!(registry::revision(&root) == 5 && board_catalog::len(&catalog) == 1, 4);
  test_scenario::return_shared(catalog);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun freeze_forever_closes_every_door() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  board_catalog::create_catalog(&cap, &mut root, scenario.ctx());
  scenario.next_tx(OWNER);
  let mut catalog = scenario.take_shared<BoardCatalog>();
  registry::freeze_forever(&cap, &mut root);
  // the era is over — the add door aborts, forever
  board_catalog::add_board(&cap, &mut root, &mut catalog, fixture_board(), scenario.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 4002, location = aresrpg_control::admin)]
fun a_daily_temp_cap_cannot_end_the_era() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  // mint a temp cap in a later epoch and try to freeze with it — cold key only
  scenario.ctx().increment_epoch_number();
  admin::mint_temp_admin_cap(&cap, OWNER, scenario.ctx());
  scenario.next_tx(OWNER);
  let temp = scenario.take_from_sender<admin::AdminCap>();
  registry::freeze_forever(&temp, &mut root);
  abort 999
}

#[test]
#[expected_failure(abort_code = 4202, location = aresrpg_seed::board_catalog)]
fun an_empty_catalog_refuses_to_pick() {
  let mut scenario = test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  board_catalog::create_catalog(&cap, &mut root, scenario.ctx());
  scenario.next_tx(OWNER);
  let catalog = scenario.take_shared<BoardCatalog>();
  let _ = board_catalog::pick(&catalog, 42);
  abort 999
}
