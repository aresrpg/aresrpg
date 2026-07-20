/// Smoke coverage for the `fight_events` emit wrappers that no lifecycle test happens to exercise yet
/// (creator-cap issuance, loot mint, move, displacement, result burn/open, sweep). Exact displacement payload
/// assertions live in `displacement_tests`; these calls prove the remaining wrappers execute without a Scenario.
#[test_only]
module aresrpg_fight::fight_events_more_tests;

use aresrpg_fight::fight_events;

#[test]
fun emit_wrappers_execute() {
  let id1 = object::id_from_address(@0x1);
  let id2 = object::id_from_address(@0x2);
  fight_events::emit_creator_cap_issued(@0xA);
  fight_events::emit_loot_minted(id1, id2, 3);
  fight_events::emit_moved(id1, id2, 42);
  fight_events::emit_mob_moved(id1, 0, 42);
  fight_events::emit_displaced(id1, true, 0, 12, 40, 42, 2, 0);
  fight_events::emit_result_burned(id1);
  fight_events::emit_result_opened(id1, id2, 500, 2);
  fight_events::emit_swept(id1);
}
