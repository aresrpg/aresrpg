// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Chain-arm parity vector for `packages/sim/test/dispel.test.js`.
///
/// The sim seeds one three-turn, +5 strength row carrying `FLAG_DISPELLABLE` and one
/// two-turn sticky row on the same target. DISPEL removes and returns only the flagged
/// alter row; the unflagged row survives. Move has no STUN kind, so a named-state row
/// with value 111 is the closest legal sticky-row twin of the sim's id-111 STUN row.
#[test_only]
module aresrpg_foundation::chain_arms_dispel_vector;

use aresrpg_foundation::{spell_board as board, spell_effect as effect};

const TARGET: u64 = 1_000;
const SOURCE: u64 = 7;
const STICKY_STATE: u16 = 111;

#[test]
fun dispel_removes_only_flagged_row_and_preserves_sticky_state() {
  let mut b = board::empty();

  // Sim twin: STAT_BUFF strength +5, three turns, flags = FLAG_DISPELLABLE.
  let dispellable = effect::alter_stat(effect::stat_strength(), 5, false, true, 3);
  board::add_status(&mut b, TARGET, SOURCE, dispellable);

  // Sim twin: unflagged id-111 STUN, two turns. Named state is Move's legal sticky row.
  let sticky = effect::new_effect(
    effect::k_apply_state(),
    255,
    STICKY_STATE as u64,
    effect::shape_point(),
    0,
    effect::tf_none(),
    100,
    2,
    0,
    0,
    effect::phase_on_enter(),
  );
  board::add_status(&mut b, TARGET, SOURCE, sticky);

  assert!(board::status_count(&b) == 2, 0);
  assert!(board::fighter_alter_rows(&b, TARGET).length() == 1, 1);
  assert!(board::fighter_has_state(&b, TARGET, STICKY_STATE), 2);

  let reverted = board::dispel_fighter(&mut b, TARGET);

  assert!(reverted.length() == 1, 3);
  let removed = reverted.borrow(0);
  assert!(removed.kind() == effect::k_alter_stat(), 4);
  assert!(removed.stat() == effect::stat_strength(), 5);
  assert!(removed.value() == 5, 6);
  assert!(removed.turns() == 3, 7);
  assert!(removed.has_flag(effect::flag_dispellable()), 8);

  assert!(board::status_count(&b) == 1, 9);
  assert!(board::fighter_alter_rows(&b, TARGET).is_empty(), 10);
  assert!(board::fighter_has_state(&b, TARGET, STICKY_STATE), 11);
  let survivor = board::fighter_status_of(&b, TARGET, effect::k_apply_state());
  assert!(survivor.is_some(), 12);
  assert!(effect::turns(survivor.borrow()) == 2, 13);
  assert!(!effect::has_flag(survivor.borrow(), effect::flag_dispellable()), 14);
}
