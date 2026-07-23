// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL BOARD TESTS — coverage for the #69 state-gated-cast query surface and the generic status writers not
/// exercised by the source-file inline trap/glyph/DoT lifecycle tests: `add_status`, `fighter_has_state`,
/// `fighter_status_of`, `clear_fighter_status_kind`, `dispel_fighter`, `fighter_alter_rows`.
#[test_only]
module aresrpg_foundation::spell_board_tests;

use aresrpg_foundation::spell_board as board;
use aresrpg_foundation::spell_effect as eff;
use aresrpg_foundation::spell;

#[test]
fun t_add_status_and_fighter_has_state() {
  let mut b = board::empty();
  let e = eff::new_effect(eff::k_apply_state(), 255, 42, eff::shape_point(), 0, eff::tf_none(), 100, 5, 0, 0, eff::phase_on_enter());
  board::add_status(&mut b, 1, 0, e);
  assert!(board::status_count(&b) == 1, 0);
  assert!(board::fighter_has_state(&b, 1, 42), 1);
  assert!(!board::fighter_has_state(&b, 1, 99), 2); // wrong state id
  assert!(!board::fighter_has_state(&b, 2, 42), 3); // wrong fighter
}

#[test]
fun t_fighter_status_of_returns_first_matching_kind() {
  let mut b = board::empty();
  let e = eff::new_effect(eff::k_return_spell(), 255, 7, eff::shape_point(), 0, eff::tf_none(), 100, 2, 0, 0, eff::phase_on_enter());
  board::add_status(&mut b, 3, 0, e);
  let found = board::fighter_status_of(&b, 3, eff::k_return_spell());
  assert!(found.is_some(), 0);
  assert!(eff::value(found.borrow()) == 7, 1);
  let missing = board::fighter_status_of(&b, 3, eff::k_carry());
  assert!(missing.is_none(), 2);
}

#[test]
fun t_clear_fighter_status_kind_removes_matching_only() {
  let mut b = board::empty();
  let inv = eff::new_effect(eff::k_invisibility(), 255, 0, eff::shape_point(), 0, eff::tf_none(), 100, 3, 0, 0, eff::phase_on_enter());
  let state = eff::new_effect(eff::k_apply_state(), 255, 1, eff::shape_point(), 0, eff::tf_none(), 100, 3, 0, 0, eff::phase_on_enter());
  board::add_status(&mut b, 1, 0, inv);
  board::add_status(&mut b, 1, 0, state);
  board::add_status(&mut b, 2, 0, inv); // different fighter, same kind — must survive
  assert!(board::status_count(&b) == 3, 0);

  board::clear_fighter_status_kind(&mut b, 1, eff::k_invisibility());
  assert!(board::status_count(&b) == 2, 1);
  assert!(board::fighter_status_of(&b, 1, eff::k_invisibility()).is_none(), 2); // removed
  assert!(board::fighter_status_of(&b, 1, eff::k_apply_state()).is_some(), 3); // other kind untouched
  assert!(board::fighter_status_of(&b, 2, eff::k_invisibility()).is_some(), 4); // other fighter untouched
}

#[test]
fun t_dispel_fighter_reverts_flagged_alter_preserves_unflagged() {
  let mut b = board::empty();
  // A flagged alter row is dispellable; an unflagged DoT on the same fighter is sticky.
  let buff = eff::alter_stat(eff::stat_agility(), 20, false, true, 3);
  board::add_status(&mut b, 1, 0, buff);
  let dot = eff::apply_dot(spell::el_earth(), 8, 3);
  board::apply_dot(&mut b, 1, 0, dot);
  assert!(board::status_count(&b) == 2, 0);
  assert!(board::fighter_alter_rows(&b, 1).length() == 1, 1);

  let reverted = board::dispel_fighter(&mut b, 1);
  assert!(reverted.length() == 1, 2); // the removed alter row needs a live-stat re-derivation
  // R3: alter value is CENTERED — decode the +20 buff magnitude.
  let (rv_neg, rv_mag) = eff::signed_delta(eff::kind(reverted.borrow(0)), eff::value(reverted.borrow(0)));
  assert!(!rv_neg && rv_mag == 20, 3);
  assert!(board::status_count(&b) == 1, 4);
  assert!(board::fighter_alter_rows(&b, 1).is_empty(), 5);
  assert!(board::fighter_status_of(&b, 1, eff::k_apply_dot()).is_some(), 6);
}

#[test]
/// The point-drain DOCTRINE folds (MOB_DEBUFF_HAT): a `drain_row` (k_remove_points) sums into the DEBT for its
/// point kind, a `credit_row` (k_give_points) into the CREDIT — each kind-gated AND point-kind-gated, so an AP row
/// never leaks into the MP fold and debt/credit never cross. The turn machine reads these at begin-turn refill.
fun t_fighter_point_debt_and_credit_folds() {
  let mut b = board::empty();
  // fighter 1: two AP debt rows (3 + 2), one MP debt row (1), one AP credit row (4).
  board::add_status(&mut b, 1, 0, eff::drain_row(eff::point_ap(), 3, 1));
  board::add_status(&mut b, 1, 0, eff::drain_row(eff::point_ap(), 2, 2));
  board::add_status(&mut b, 1, 0, eff::drain_row(eff::point_mp(), 1, 1));
  board::add_status(&mut b, 1, 0, eff::credit_row(eff::point_ap(), 4, 1));

  assert!(board::fighter_point_debt(&b, 1, eff::point_ap()) == 5, 0); // 3 + 2 (MP debt excluded)
  assert!(board::fighter_point_debt(&b, 1, eff::point_mp()) == 1, 1);
  assert!(board::fighter_point_credit(&b, 1, eff::point_ap()) == 4, 2); // give-points only, not the drains
  assert!(board::fighter_point_credit(&b, 1, eff::point_mp()) == 0, 3); // no MP credit row
  // a different fighter shares none of it (fighter-gated).
  assert!(board::fighter_point_debt(&b, 2, eff::point_ap()) == 0, 4);
  assert!(board::fighter_point_credit(&b, 2, eff::point_ap()) == 0, 5);
}

#[test]
/// `clear_fighter` — the DEATH fold — PURGES every status row on the dead fighter (debt/credit/state alike) so the
/// scans stop iterating a corpse's junk, while leaving every OTHER fighter's rows fully intact.
fun t_clear_fighter_purges_only_that_fighter() {
  let mut b = board::empty();
  board::add_status(&mut b, 1, 0, eff::drain_row(eff::point_ap(), 3, 1));
  board::add_status(&mut b, 1, 0, eff::credit_row(eff::point_mp(), 2, 1));
  board::add_status(&mut b, 2, 0, eff::drain_row(eff::point_ap(), 1, 1)); // survivor
  assert!(board::status_count(&b) == 3, 0);

  board::clear_fighter(&mut b, 1);
  assert!(board::status_count(&b) == 1, 1); // only fighter 2's row remains
  assert!(board::fighter_point_debt(&b, 1, eff::point_ap()) == 0, 2); // fighter 1 fully purged
  assert!(board::fighter_point_credit(&b, 1, eff::point_mp()) == 0, 3);
  assert!(board::fighter_point_debt(&b, 2, eff::point_ap()) == 1, 4); // survivor intact
}

#[test]
fun t_on_enter_with_anchor_returns_zone_origin_payload_and_removes() {
  let mut b = board::empty();
  board::place_trap(&mut b, 105, 0, eff::shape_circle(), 1, vector[eff::damage(spell::el_earth(), 7)]);
  assert!(board::has_trap_covering(&b, 106), 0); // covered neighbor, not the anchor
  let (anchor, payload) = board::on_enter_with_anchor(&mut b, 106);
  assert!(anchor.is_some() && *anchor.borrow() == 105, 1);
  assert!(payload.length() == 1 && eff::value(payload.borrow(0)) == 7, 2);
  assert!(board::entry_count(&b) == 0, 3);
}

#[test]
fun t_on_enter_with_anchor_distinguishes_empty_trap_from_miss() {
  let mut b = board::empty();
  board::place_trap(&mut b, 105, 0, eff::shape_point(), 0, vector[]);
  let (miss_anchor, miss_payload) = board::on_enter_with_anchor(&mut b, 106);
  assert!(miss_anchor.is_none() && miss_payload.is_empty(), 0);
  assert!(board::entry_count(&b) == 1, 1);
  let (hit_anchor, hit_payload) = board::on_enter_with_anchor(&mut b, 105);
  assert!(hit_anchor.is_some() && *hit_anchor.borrow() == 105, 2);
  assert!(hit_payload.is_empty() && board::entry_count(&b) == 0, 3);
}

#[test]
fun t_legacy_on_enter_signature_still_returns_payload() {
  let mut b = board::empty();
  board::place_trap(&mut b, 105, 0, eff::shape_point(), 0, vector[eff::heal(9)]);
  let payload = board::on_enter(&mut b, 105);
  assert!(payload.length() == 1 && eff::value(payload.borrow(0)) == 9, 0);
  assert!(board::entry_count(&b) == 0, 1);
}
