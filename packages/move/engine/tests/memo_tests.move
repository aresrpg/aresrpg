/// (d) MEMO correctness — the mob crank builds the off-shape wall set ONCE per `resolve_from` and threads it into
/// every mob turn (gas diet). This proves the memo twin `cast::move_blocked_cells_memo` is BIT-IDENTICAL (both are
/// canonical MASK_WORDS-word wall bitsets — gas-diet #1) to a FRESH `cast::move_blocked_cells` rebuild AT ALL
/// TIMES: the terrain is memoized but the DYNAMIC bodies are
/// re-read, so a mob that moves — or a participant that dies — mid-walk is reflected. The stale off-shape (built
/// once, before the move) staying correct is the whole point: terrain is immutable, bodies are not.
#[test_only]
module aresrpg_fight::memo_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob, participant};
use aresrpg_fight::fight_scaffold::{create_fight, stand_up};
use aresrpg_foundation::combat_grid;
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;

#[test]
fun memo_equals_fresh_across_mob_move_and_participant_death() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none()); // 1 spawned mob (idx 0) + 1 participant (seat 0)
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();

  // add a 2nd mob (idx 1) so mob 1's blocked view INCLUDES mob 0's body.
  fight::mobs_mut(&mut fight).push_back(mob::new_mob_for_testing(combat_grid::encode(11, 11), 100, 100, 6, 3));

  // build the off-shape scan ONCE (as `resolve_from` does) — reused for every memo call below, never rebuilt.
  let off = cast::off_shape_mask(&fight);

  // memo(exclude mob 1) == fresh plain rebuild (both canonical bitsets ⇒ exact vector equality, stronger than set-eq).
  let memo0 = cast::move_blocked_cells_memo(&fight, 1, &off);
  let plain0 = cast::move_blocked_cells(&fight, true, 1);
  assert!(memo0 == plain0, 0);

  // MOVE mob 0 → mob 1's blocked view must track the new body cell, using the SAME (stale) off-shape memo.
  let z = combat_grid::encode(9, 9);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), z);
  let memo1 = cast::move_blocked_cells_memo(&fight, 1, &off);
  let plain1 = cast::move_blocked_cells(&fight, true, 1);
  assert!(memo1 == plain1, 1);                  // still identical to a fresh rebuild after the move
  assert!(combat_grid::mask_get(&memo1, z), 2); // mob 0's NEW cell now blocks mob 1 (a moved body IS reflected)

  // KILL the participant → its body must drop from BOTH builders identically (bodies re-read, not memoized).
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 0);
  let memo2 = cast::move_blocked_cells_memo(&fight, 1, &off);
  let plain2 = cast::move_blocked_cells(&fight, true, 1);
  assert!(memo2 == plain2, 3);

  ts::return_shared(fight);
  sc.end();
}
