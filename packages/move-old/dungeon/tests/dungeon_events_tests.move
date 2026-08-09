// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEON_EVENTS tests: the run-lifecycle event emitters are `public(package)` doors `dungeon` fires. They carry
/// no state and no return — this only proves the two currently-uncovered emitters are callable (a compile+run
/// guard; the live emit paths are exercised end-to-end by the dungeon suite).
#[test_only]
module aresrpg_dungeon::dungeon_events_tests;

use aresrpg_dungeon::dungeon_events;

#[test]
fun emit_activated_and_entered_fight_are_callable() {
  let pass = object::id_from_address(@0x1);
  let world = object::id_from_address(@0x2);
  let fight = object::id_from_address(@0x3);
  let character = object::id_from_address(@0x4);
  dungeon_events::emit_activated(pass, world, @0xA, character);
  dungeon_events::emit_entered_fight(pass, fight, world, @0xA, 1, character);
}
