// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// S-07 — `object::delete` does not track dynamic fields: a family left attached at settlement is unreachable
/// forever and its storage deposit is NEVER rebated (the janitor's tip shrinks by exactly that much, and global
/// state grows monotonically with fights played). This suite writes one row in EVERY family the engine attaches
/// to a Fight UID, proves each row is really there, runs the settlement sweep, and proves each row is gone.
///
/// It is the regression wall for the failure mode that cannot be observed from outside: after `object::delete`
/// the UID is unreadable, so an orphaned family is invisible to every other test in the suite. Adding a new
/// dynamic-field family to the engine means adding it here and to `settlement::sweep_fields` — the probes live
/// in the modules that own the key structs (Move keeps struct construction module-private).
#[test_only]
module aresrpg_fight::field_reclaim_tests;

use aresrpg_fight::{
  action_envelope, cast, displacement, fight::{Self, Fight}, participant, retro_effects,
  fight_scaffold::{stand_up, create_fight}
};
use aresrpg_foundation::spell_effect;
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const SPELL: address = @0x5EE1; // a spell id source (the unbounded half of the cast + named-stack keys)
const TRAP_ANCHOR: u64 = 55;
const TARGET_CELL: u64 = 101;

#[test]
fun every_field_family_is_reclaimed_before_delete() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 700, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let spell = object::id_from_address(SPELL);

  // ── WRITE one row in every family ────────────────────────────────────────────────────────────────────────
  cast::test_record_cast(&mut fight, 0, spell, TARGET_CELL); // SeatTurnKey + CastKey + TargetKey
  action_envelope::note_mob_turn(&mut fight, 0); // MobActionKey
  displacement::record_trap_owner(&mut fight, TRAP_ANCHOR, 0); // TrapOwnerKey
  retro_effects::record_named_stack(&mut fight, 0, spell, 1, 1, 5, 2); // NamedStackKey
  retro_effects::schedule_payload(&mut fight, 0, 0, 1, vector[
    spell_effect::new_effect(1, 0, 10, 0, 0, 0, 100, 1, 0, 0, 0),
  ]); // TimedPayloadKey
  fight::attach_weapon_lines(&mut fight, 0, vector[participant::new_weapon_line(0, 5, 7)]); // WeaponLinesKey

  // ── RED without the sweep: every probe below reports the rows still attached at this point ────────────────
  assert!(cast::test_rows_exist(&fight, 0, spell, TARGET_CELL), 0);
  assert!(action_envelope::test_row_exists(&fight, 0), 1);
  assert!(displacement::test_row_exists(&fight, TRAP_ANCHOR), 2);
  assert!(retro_effects::test_rows_exist(&fight, 0, 0, spell, 1), 3);
  assert!(fight::test_rows_exist(&fight, 0, 0), 4);

  // ── The settlement sweep (the exact call list `settlement::sweep_fields` + `fight::destroy` run) ──────────
  cast::sweep_fields(&mut fight);
  retro_effects::sweep_fields(&mut fight);
  displacement::sweep_fields(&mut fight);
  action_envelope::sweep_fields(&mut fight);
  fight::sweep_own_fields(&mut fight);

  // ── GREEN: nothing survives to be orphaned by `object::delete` ────────────────────────────────────────────
  assert!(!cast::test_rows_exist(&fight, 0, spell, TARGET_CELL), 10);
  assert!(!action_envelope::test_row_exists(&fight, 0), 11);
  assert!(!displacement::test_row_exists(&fight, TRAP_ANCHOR), 12);
  assert!(!retro_effects::test_rows_exist(&fight, 0, 0, spell, 1), 13);
  assert!(!fight::test_rows_exist(&fight, 0, 0), 14);

  ts::return_shared(fight);
  sc.end();
}
