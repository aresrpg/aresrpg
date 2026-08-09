// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ENGINE tests — the adversarial lifecycle cases over the full cross-package scaffold (enabled GameConfig +
/// fight Version/registry + a minted mob template): first-come race, 0-HP entry gate (§17.23), party-only join
/// rejection + dup-seat rejection (F-01), weapon-AP repeatability (§17.27), the aging snapshot (§8 — parking
/// gains nothing), and settlement (results v2: terminal-only, soulbound results, Fight deleted).
#[test_only]
module aresrpg_fight::fight_tests;

use aresrpg_fight::{
  actions,
  fight::{Self, Fight},
  mob,
  participant,
  fight_registry,
  settlement::{Self as results, FightOutcome},
  turns,
  version::Version
};
use aresrpg_fight::fight_scaffold::{bag_spec, combatant, create_fight, create_fight_as, mk_clock, mob_stats, stand_up, tslatch_for, tsreg, tsreg_for, tsregs_for};
use aresrpg_foundation::spell;
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0; // the creator character's id source
const CHAR2: address = @0xC2; // a joiner character
const WORLD: address = @0x704D; // a world id source
const PARTY: address = @0xBEEF;
const OTHER_PARTY: address = @0xF00D;

// mirrored abort codes (value + module for `location =`).
const E_ZeroHp: u64 = 101; // fight
const E_NotParty: u64 = 104; // fight
const E_AlreadySeated: u64 = 108; // fight (F-01)
const CAST_EInsufficientAP: u64 = 101; // cast
const RESULTS_ENotTerminal: u64 = 101; // results
const SETTLE_ENoSuchSeat: u64 = 102; // settlement (settle_and_take)
const SETTLE_ENotSeatOwner: u64 = 103; // settlement (settle_and_take)

const OWNER2: address = @0xB; // a second wallet (owns CHAR2's seat in the take tests)

// ╔════════════════ [ 0-HP entry gate (§17.23) ] ════════════════════════════ ]

#[test, expected_failure(abort_code = E_ZeroHp, location = aresrpg_fight::fight)]
fun zero_hp_cannot_create() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(&sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 1000);
  // creator with 0 HP → EZeroHp
  fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &bag_spec(30), 1, combatant(CHAR, 0), &ver, &clock, sc.ctx());
  abort 0
}

// ╔════════════════ [ First-come race ] ══════════════════════════════════════ ]

#[test, expected_failure]
/// A SECOND fight over the same (world, spawn_id) aborts in the derived-object claim — first-come, fight-side.
fun first_come_second_create_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 7, 0, 1000, true, option::none());
  // same spawn_id 7 again → derived address already claimed → abort.
  create_fight(&mut sc, 50, 7, 0, 1000, true, option::none());
  abort 0
}

#[test]
/// A DIFFERENT spawn_id creates a distinct fight (no false collision).
fun distinct_spawn_ids_both_create() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  create_fight_as(&mut sc, bag_hp, 2, 0, 1000, true, option::none(), CHAR2); // S-12f: one live fight per character
  sc.next_tx(OWNER);
  let reg = tsreg(&sc);
  assert!(fight_registry::fight_exists(&reg, object::id_from_address(WORLD), 1));
  assert!(fight_registry::fight_exists(&reg, object::id_from_address(WORLD), 2));
  assert!(!fight_registry::fight_exists(&reg, object::id_from_address(WORLD), 3));
  ts::return_shared(reg);
  sc.end();
}

// ╔════════════════ [ The crank — auto-pass a stalled player + resolve mobs ] ═ ]

#[test]
/// A 2-player + 1-mob fight (queue p0,m0,p1): with p0 stalled past its deadline, ANYONE cranks → p0 forfeits,
/// the mob takes its deterministic turn, and turn_ptr lands on p1. The crank fast-forwards overdue work.
fun crank_advances_stalled_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 500;
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let c1 = participant::cell(fight::participants(&fight).borrow(1));
  let clock = mk_clock(&mut sc, 1000);
  aresrpg_fight::turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  aresrpg_fight::turns::place_for_testing(&mut fight, object::id_from_address(CHAR2), c1, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  let ptr0 = fight::turn_ptr(&fight); // p0's slot
  aresrpg_fight::turns::crank_for_testing(&mut fight, 999_999); // now >> the 45s deadline
  assert!(fight::turn_ptr(&fight) != ptr0); // advanced past the stalled player (mob resolved, p1 landed)
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Settlement (results v2) ] ══════════════════════════════ ]

#[test]
/// Victory → PERMISSIONLESS settle: one soulbound FightResult lands in the wallet of the seat's owner (correct outcome/
/// hp/xp, unopened) and the shared Fight is DELETED in the same call — no window, no sweep, no residue.
fun settle_mints_results_and_destroys() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  win_the_fight(&mut sc, &mut fight, &ver);
  assert!(fight::status(&fight) == fight::status_victory());
  results::settle_and_destroy(fight, &ver, sc.ctx());
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<Fight>()); // the shared Fight is GONE
  let result = sc.take_from_sender<FightOutcome>(); // soulbound, in the wallet of the seat's owner
  assert!(results::outcome(&result) == fight::status_victory());
  assert!(results::character(&result) == object::id_from_address(CHAR));
  assert!(results::final_hp(&result) == 100); // the bag never hit back
  // xp plumbing: mob xp 100 × 1 mob, party 1, wisdom 0, aging 0 → the kernel over live dials
  assert!(results::xp_share(&result) == results::xp_share_kernel(100, 1, 0, 0, 100));
  
  sc.return_to_sender(result);
  ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = RESULTS_ENotTerminal, location = aresrpg_fight::settlement)]
/// Settling a live (placement) fight aborts — settlement is for TERMINAL fights only.
fun settle_nonterminal_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  results::settle_and_destroy(fight, &ver, sc.ctx());
  abort 0
}

// ── settle_and_take (the PTB-composition door) ──

/// Stand a 2-seat victory up: CHAR (created by OWNER), CHAR2 joins under OWNER2, both place, seat 0 wipes the bag.
fun two_seat_victory(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER2);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let c1 = participant::cell(fight::participants(&fight).borrow(1));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR2), c1, &ver, &clock, OWNER2);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  assert!(fight::status(&fight) == fight::status_victory());
  (fight, ver)
}

#[test]
/// settle_and_take hands the CALLER's outcome back BY VALUE (same-tx open fodder) while every other seat still
/// receives its outcome by transfer — settle_and_destroy semantics, minus one wallet hop for the caller.
fun settle_and_take_returns_mine_transfers_others() {
  let mut sc = ts::begin(OWNER);
  let (fight, ver) = two_seat_victory(&mut sc);
  sc.next_tx(OWNER);
  {
    let mine = results::settle_and_take(fight, object::id_from_address(CHAR), &ver, sc.ctx());
    assert!(results::character(&mine) == object::id_from_address(CHAR));
    assert!(results::outcome(&mine) == fight::status_victory());
    // consume it the consumer way — by-value possession is the whole point
    let (_, _, _, _, _, _, _, _, _, _, _, _, _, _, _) = results::unpack(mine);
  };
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<Fight>()); // the shared Fight is GONE
  let theirs = ts::take_from_address<FightOutcome>(&sc, OWNER2); // the other seat still transferred
  assert!(results::character(&theirs) == object::id_from_address(CHAR2));
  ts::return_to_address(OWNER2, theirs);
  ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = SETTLE_ENotSeatOwner, location = aresrpg_fight::settlement)]
/// Taking a seat you don't OWN aborts — without this gate a stranger could take a victim's outcome by value and
/// unpack-destroy it (XP/loot burned, fight-marker latched forever).
fun settle_and_take_not_seat_owner_aborts() {
  let mut sc = ts::begin(OWNER);
  let (fight, _ver) = two_seat_victory(&mut sc);
  sc.next_tx(OWNER);
  let _mine = results::settle_and_take(fight, object::id_from_address(CHAR2), &_ver, sc.ctx());
  abort 0
}

#[test, expected_failure(abort_code = SETTLE_ENoSuchSeat, location = aresrpg_fight::settlement)]
/// Requesting a character with no seat in the fight aborts (the whole fight still unwinds — nothing settles).
fun settle_and_take_absent_character_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  win_the_fight(&mut sc, &mut fight, &ver);
  let _mine = results::settle_and_take(fight, object::id_from_address(@0xDEAD), &ver, sc.ctx());
  abort 0
}

#[test, expected_failure(abort_code = E_NotParty, location = aresrpg_fight::fight)]
fun party_only_join_wrong_party_rejected() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, false, option::some(object::id_from_address(PARTY)));
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  // joiner claims membership in a DIFFERENT party → ENotParty.
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::some(object::id_from_address(OTHER_PARTY)), &ver, sc.ctx());
  abort 0
}

#[test]
fun party_only_join_right_party_accepted() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, false, option::some(object::id_from_address(PARTY)));
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::some(object::id_from_address(PARTY)), &ver, sc.ctx());
  assert!(fight::participant_count(&fight) == 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Dup-seat rejection (F-01 — one character, one seat) ] ══ ]

#[test, expected_failure(abort_code = E_AlreadySeated, location = aresrpg_fight::fight)]
fun same_character_cannot_join_twice() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  // CHAR already holds seat 0 (the creator) — joining it again must abort, not double-seat.
  fight::join_for_testing(&mut fight, combatant(CHAR, 100), option::none(), &ver, sc.ctx());
  abort 0
}

// ╔════════════════ [ Weapon-AP repeatability (§17.27) ] ════════════════════ ]

#[test, expected_failure(abort_code = CAST_EInsufficientAP, location = aresrpg_fight::cast)]
fun weapon_repeats_until_ap_exhausted() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 1, 0, 1000, true, option::none()); // high hp so it survives 2 hits (fight stays ACTIVE)
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  // place the creator (ready → ACTIVE) on its seeded cell.
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  aresrpg_fight::turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  // force adjacency: player at 100, mob at 101 (Manhattan 1, clear LOS).
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  // base AP 6, weapon costs 3 → exactly two strikes, then the third aborts EInsufficientAP.
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3);
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 0);
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER); // AP 0 < 3 → abort
  abort 0
}

// ╔════════════════ [ Aging snapshot (§8 — parking gains nothing) ] ═════════ ]

#[test]
fun aging_snapshots_at_lock() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let bag_hp = 30;
  // group spawned at t=0, fight locked 10 hours later → +1000 bp (10h × 100bp/h), well under the 10_000 cap.
  create_fight(&mut sc, 50, 1, 0, 36_000_000, true, option::none());
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  assert!(fight::aged_bp(&fight) == 1000); // the STORED snapshot — a later claim reads THIS, not claim-time
  ts::return_shared(fight);

  // a freshly-spawned group locked immediately → 0 aging.
  create_fight_as(&mut sc, 30, 2, 5000, 5000, true, option::none(), CHAR2); // S-12f: one live fight per character
  sc.next_tx(OWNER);
  let id2 = fight_id(&sc, 2);
  let f2 = ts::take_shared_by_id<Fight>(&sc, id2);
  assert!(fight::aged_bp(&f2) == 0);
  ts::return_shared(f2);
  sc.end();
}

fun fight_id(sc: &Scenario, spawn_id: u64): ID {
  let reg = tsreg(sc);
  let addr = fight_registry::fight_address(&reg, object::id_from_address(WORLD), spawn_id);
  ts::return_shared(reg);
  object::id_from_address(addr)
}

// ╔════════════════ [ Board ticks + mob economy (F-12 / F-13) ] ══════════════ ]

#[test]
/// A mob with a 2-AP DoT kit (2 base AP, 0 MP) poisons the player EVERY round: the FIRST cast drains its AP, so
/// the SECOND cast only happens if `begin_turn` refills it (F-13), and the player's HP only drops if the DoT
/// rows actually tick at the player's turn start (F-12). Trace: t2 start = one row (−20), t3 start = two rows
/// (−40). Both defects made this fight a stalemate before the fix.
fun dot_ticks_and_mob_refills_across_rounds() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  // kit: apply_dot(fire, 20/tick, 3 turns) — range 0..40, no LOS gate, costs the mob's ENTIRE 2-AP budget.
  let dot_kit = vector[aresrpg_foundation::spell_effect::new_spell_level(
    1, 2, 0, 40, false, false, false, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[aresrpg_foundation::spell_effect::apply_dot(spell::el_fire(), 20, 3)], vector[],
  )];
  let viper = mob::new_mob_spec(1, 1, 500, 2, 0, mob_stats(), dot_kit, 100, vector[]);
  sc.next_tx(OWNER);
  {
    let (mut registry, mut latch) = tsregs_for(&sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(&mut sc, 1000);
    fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &viper, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(latch);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  aresrpg_fight::turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  // pass #1: mob casts DoT row 1 → player's turn-2 START ticks it once.
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 80);
  // pass #2: the mob's 2-AP budget was SPENT — only the F-13 refill lets it cast row 2; turn-3 START ticks both.
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 40);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// NOTE (v2 guarantees the old claim tests proved by assertion): double-claim is now IMPOSSIBLE BY TYPE — settle
// consumes the Fight by value (no second settle exists) and a FightResult opens once (`EAlreadyOpened`) inside
// its recipient's own wallet. The open/mint write-back path needs game+items fixtures neither package's unit suite
// can host (dependency test_only doors are not compiled) — it is the testnet e2e gate, with the pure roll/xp
// kernels covered in `pure_tests`.

/// Place the creator, force it adjacent to the mob, and weapon-strike once — the low-hp mob dies → VICTORY.
fun win_the_fight(sc: &mut Scenario, fight: &mut Fight, ver: &Version) {
  let cell0 = participant::cell(fight::participants(fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  aresrpg_fight::turns::place_for_testing(fight, object::id_from_address(CHAR), cell0, ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), 101);
  actions::weapon_for_testing(fight, object::id_from_address(CHAR), 101, ver, 1000, OWNER);
}

// ╔════════════════ [ S-13b — PvP terminality (side wipe / draw / mob-independence) ] ═ ]

/// Stand a 1v1 PVP fight up in ACTIVE (creator = team 0 seat via create; +1 team-1 seat via the test door).
fun pvp_fixture(sc: &mut Scenario): Fight {
  stand_up(sc);
  create_fight(sc, 50, 77, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::set_mode_pvp_for_testing(&mut fight);
  fight::seat_team_for_testing(&mut fight, combatant(CHAR2, 100), OWNER, 1);
  fight::set_status_active_for_testing(&mut fight);
  fight
}

#[test]
/// A side wipe under MODE_PVP declares the SURVIVING team the winner (kolizeum's winning_side read — SEAM-K2).
fun pvp_side_wipe_declares_team_winner() {
  let mut sc = ts::begin(OWNER);
  let mut fight = pvp_fixture(&mut sc);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(1), 0); // team 1 wiped
  assert!(turns::pvp_terminal_check(&mut fight));
  assert!(fight::status(&fight) == fight::status_victory());
  assert!(fight::winning_side(&fight) == option::some(0));
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// A MUTUAL wipe is a DRAW: terminal DEFEAT with winner NONE (kolizeum refunds on none).
fun pvp_mutual_wipe_is_a_draw() {
  let mut sc = ts::begin(OWNER);
  let mut fight = pvp_fixture(&mut sc);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 0);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(1), 0);
  assert!(turns::pvp_terminal_check(&mut fight));
  assert!(fight::status(&fight) == fight::status_defeat());
  assert!(fight::winning_side(&fight) == option::none());
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Mob state NEVER decides a PVP fight: with both teams alive the check is false and the fight stays ACTIVE
/// (all_mobs_dead is trivially true in a mobless PvP fight — the S-13b trivial-victory guard), and a
/// non-terminal fight reads winning_side none.
fun pvp_ignores_mob_terminality_while_both_teams_live() {
  let mut sc = ts::begin(OWNER);
  let mut fight = pvp_fixture(&mut sc);
  assert!(!turns::pvp_terminal_check(&mut fight));
  assert!(fight::status(&fight) == fight::status_active());
  assert!(fight::winning_side(&fight) == option::none());
  ts::return_shared(fight);
  sc.end();
}

// ╔════════════════ [ S-13b — the dungeon create door + gated joins ] ═════════ ]

const E_GatedJoins: u64 = 109; // fight

const DUNGEON: address = @0xD07; // a dungeon object id source (the door's derivation scope)

/// Stand up + author a mob + drive the dungeon door (raw-Combatant twin). Returns nothing; take_shared after.
fun create_dungeon_fixture(sc: &mut Scenario) {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(DUNGEON), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 5000);
  fight::create_dungeon_fight_for_testing(&mut registry, &mut latch, object::id_from_address(DUNGEON), 1, 999, 40, 40,
    combatant(CHAR, 100), &bag_spec(30), 2, &ver, &clock, sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

#[test]
/// The door mints a PLACEMENT PvM fight with ZERO aging, gated joins, and a deterministic (scope, nonce)
/// address in the dungeon's OWN id-domain (no collision with world spawn claims).
fun dungeon_door_creates_gated_zero_aged_fight() {
  let mut sc = ts::begin(OWNER);
  create_dungeon_fixture(&mut sc);

  sc.next_tx(OWNER);
  let reg = tsreg_for(&sc, object::id_from_address(DUNGEON));
  assert!(fight_registry::fight_exists(&reg, object::id_from_address(DUNGEON), 1));
  ts::return_shared(reg);
  let fight = sc.take_shared<Fight>();
  assert!(fight::status(&fight) == fight::status_placement());
  assert!(fight::mode(&fight) == fight::mode_pvm());
  assert!(fight::aged_bp(&fight) == 0); // spawned_at = now → no aging bonus in dungeons
  ts::return_shared(fight);
  sc.end();
}

#[test, expected_failure(abort_code = E_GatedJoins, location = aresrpg_fight::fight)]
/// A door-created fight REFUSES the raw join — echoing the party id is not a gate money can rest on; seats
/// fill only through join_with_cap behind the dungeon's RunPass verification.
fun dungeon_fight_direct_join_aborts() {
  let mut sc = ts::begin(OWNER);
  create_dungeon_fixture(&mut sc);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx()); // EGatedJoins
  abort 0
}

#[test]
/// The cap-gated join door seats a second player with every seat-integrity check intact (dup-seat still F-01).
fun dungeon_join_with_cap_seats() {
  let mut sc = ts::begin(OWNER);
  create_dungeon_fixture(&mut sc);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 100), OWNER, 0);
  assert!(fight::participants(&fight).length() == 2);
  ts::return_shared(fight);
  sc.end();
}


// ╔════════════════ [ S-13b — the PvP door (§17.9 ephemeral, zero-reward results) ] ═ ]

const KOLI: address = @0x201; // a kolizeum lobby id source (the PvP door's derivation scope)

/// Drive the PvP door with two WOUNDED fighters (hp 40/100) on opposite teams. Returns nothing; take after.
fun create_pvp_fixture(sc: &mut Scenario) {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(KOLI), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 5000);
  fight::create_pvp_fight_for_testing(&mut registry, &mut latch, object::id_from_address(KOLI), 1, 999, 40, 40, 1,
    combatant(CHAR, 40), &ver, &clock, sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

#[test]
/// §17.9 EPHEMERAL entry: wounded fighters seat at FULL HP on their own side's start cells (team 1 on a b-cell),
/// in PVP mode with gated joins and zero aging.
fun pvp_door_seats_full_hp_copies_on_both_sides() {
  let mut sc = ts::begin(OWNER);
  create_pvp_fixture(&mut sc);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 40), OWNER, 1); // wounded joiner, team 1

  assert!(fight::mode(&fight) == fight::mode_pvp());
  let p0 = fight::participants(&fight).borrow(0);
  let p1 = fight::participants(&fight).borrow(1);
  assert!(participant::hp(p0) == participant::max_hp(p0)); // ephemeral copy: wounds erased
  assert!(participant::hp(p1) == participant::max_hp(p1));
  assert!(participant::team(p1) == 1);
  assert!(fight::is_start_cell_b(&fight, participant::cell(p1))); // team 1 seeds on the FAR side
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The §17.9 settlement chain: a PvP side wipe settles into ZERO-REWARD pvp results — winner outcome VICTORY,
/// loser DEFEAT, both xp 0 + loot empty + pvp-flagged (open() will skip every real-character write-back).
fun pvp_settlement_mints_zero_reward_results() {
  let mut sc = ts::begin(OWNER);
  create_pvp_fixture(&mut sc);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 40), OWNER, 1);
  fight::set_status_active_for_testing(&mut fight);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(1), 0); // team 1 wiped
  assert!(turns::pvp_terminal_check(&mut fight));
  assert!(fight::winning_side(&fight) == option::some(0));
  let ver = sc.take_shared<Version>();
  results::settle_and_destroy(fight, &ver, sc.ctx());
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  // both seats belonged to OWNER — two results; fields prove the zero-reward pvp law.
  let r1 = sc.take_from_sender<FightOutcome>();
  let r2 = sc.take_from_sender<FightOutcome>();
  assert!(results::is_pvp(&r1) && results::is_pvp(&r2));
  assert!(results::xp_share(&r1) == 0 && results::xp_share(&r2) == 0);
  let (v, d) = if (results::outcome(&r1) == fight::status_victory()) (&r1, &r2) else (&r2, &r1);
  assert!(results::outcome(v) == fight::status_victory());
  assert!(results::outcome(d) == fight::status_defeat());
  sui::test_utils::destroy(r1);
  sui::test_utils::destroy(r2);
  sc.end();
}

// ╔════════════════ [ S-12f — the in-fight latch (one character, one live fight) ] ═ ]

const LATCH_ECharacterInFight: u64 = 103;

#[test, expected_failure(abort_code = LATCH_ECharacterInFight, location = aresrpg_fight::fight_latch)]
/// The XP-farm vector closed: one character cannot seat TWO live fights (stale-HP parallel farming).
fun same_character_cannot_enter_two_fights() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  create_fight(&mut sc, 50, 2, 0, 1000, true, option::none()); // same CHAR — ECharacterInFight
  abort 0
}

#[test]
/// The owned outcome carries latch-release authority: once its holder releases, the character enters a new fight.
fun outcome_holder_frees_the_latch() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::set_status_active_for_testing(&mut fight);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 0);
  turns::finish_defeat_for_testing(&mut fight);
  let ver = sc.take_shared<Version>();
  {
    let latch = tslatch_for(&sc, object::id_from_address(CHAR));
    assert!(latch.character_fight(std::type_name::with_defining_ids<fight::TestBrand>(), object::id_from_address(CHAR)).is_some());
    ts::return_shared(latch);
  };
  results::settle_and_destroy(fight, &ver, sc.ctx());
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let outcome = sc.take_from_sender<FightOutcome>();
  let mut latch = tslatch_for(&sc, object::id_from_address(CHAR));
  assert!(latch.character_fight(std::type_name::with_defining_ids<fight::TestBrand>(), object::id_from_address(CHAR)).is_some());
  results::release_latch(&mut latch, &outcome);
  assert!(latch.character_fight(std::type_name::with_defining_ids<fight::TestBrand>(), object::id_from_address(CHAR)).is_none());
  ts::return_shared(latch);
  sui::test_utils::destroy(outcome);

  create_fight(&mut sc, 50, 2, 0, 2000, true, option::none()); // same CHAR — now allowed
  sc.end();
}

// ╔════════════════ [ Single-PTB turn law — the strict turn gate ] ═══════════ ]
// Player actions are &Random-free and never fast-forward anyone: off-turn acting aborts (ENotYourTurn while the
// current turn is live, the DISTINCT ESomeoneOverdue once it stalls — the client auto-cranks on that class); a
// self-killed seat stays dead-but-current (EActorDead walls move/weapon/cast) until its own PASS or the
// permissionless crank hands the queue forward.

const TURNS_ENotYourTurn: u64 = 106; // turns
const TURNS_ESomeoneOverdue: u64 = 108; // turns
const ACTIONS_EActorDead: u64 = 107; // actions

/// Stand a 2-seat ACTIVE PvM fight up: CHAR (OWNER) creates, CHAR2 (OWNER2) joins, both place on their seeded
/// cells over a 500-hp punching bag (nothing dies by accident). Seat 0 (CHAR) holds the opening turn (§17.28
/// players-first interleave), deadline fresh at now=1000.
fun two_seat_active(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 500, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER2);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let c1 = participant::cell(fight::participants(&fight).borrow(1));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR2), c1, &ver, &clock, OWNER2);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  (fight, ver)
}

#[test, expected_failure(abort_code = TURNS_ENotYourTurn, location = aresrpg_fight::turns)]
/// Seat 0's turn is LIVE (deadline not passed): seat 1 acting must WAIT — the gate never fast-forwards.
fun act_off_turn_not_overdue_aborts() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = two_seat_active(&mut sc);
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR2), &ver, 1000, OWNER2);
  abort 0
}

#[test, expected_failure(abort_code = TURNS_ESomeoneOverdue, location = aresrpg_fight::turns)]
/// Seat 0's turn went OVERDUE: seat 1 acting aborts the DISTINCT class — the client cranks first, then retries
/// (the action itself never resolves the stalled wave; crank is the sole overdue-handler).
fun act_while_current_turn_overdue_aborts_distinct() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = two_seat_active(&mut sc);
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR2), &ver, 999_999_999, OWNER2);
  abort 0
}

#[test]
/// The caller's OWN overdue turn still acts (grace until someone actually cranks it away): a solo player passes
/// long past its deadline — the turn hands forward through the bag mob and lands back, fight still ACTIVE.
fun own_overdue_turn_still_acts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 999_999_999, OWNER);
  assert!(fight::status(&fight) == fight::status_active());
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

/// Stand a SOLO ACTIVE fight up and kill seat 0 IN PLACE — the F-12 self-kill state (trap / life-cost cast):
/// the seat is DEAD but still CURRENT (no handoff ran — single-PTB turn law).
fun solo_dead_but_current(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 500, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 0);
  assert!(fight::status(&fight) == fight::status_active()); // dead-but-current: no auto-handoff
  (fight, ver)
}

#[test, expected_failure(abort_code = ACTIONS_EActorDead, location = aresrpg_fight::actions)]
/// A self-killed seat cannot keep ACTING: the batch's remaining move/weapon/cast abort EActorDead (the whole
/// PTB reverts harmlessly — nothing partially applies).
fun self_killed_actor_cannot_keep_acting() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = solo_dead_but_current(&mut sc);
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  abort 0
}

#[test]
/// The self-killed seat's own PASS is the handoff (no alive gate on pass): the resolve walk finds no living
/// player → DEFEAT. This is the batch's trailing act_pass doing its job.
fun self_killed_actor_pass_hands_forward() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = solo_dead_but_current(&mut sc);
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(fight::status(&fight) == fight::status_defeat());
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The permissionless CRANK backstops an INCREMENTAL self-killed player who walked away dead-but-current:
/// past the deadline anyone forfeits the corpse's turn and the fight resolves (here: DEFEAT).
fun crank_backstops_a_dead_current_seat() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = solo_dead_but_current(&mut sc);
  turns::crank_for_testing(&mut fight, 999_999_999);
  assert!(fight::status(&fight) == fight::status_defeat());
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// BATCH TERMINAL-TOLERANCE: the single-PTB turn is [acts…, act_pass]; when an act's killing blow ends the
/// fight EARLIER IN THE SAME TX, the trailing pass must NO-OP (an abort would revert the winning turn).
/// Mirror: win via weapon (fight → VICTORY), then pass — no abort, the victory stands.
fun pass_after_own_killing_blow_noops() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  win_the_fight(&mut sc, &mut fight, &ver);
  assert!(fight::status(&fight) == fight::status_victory());
  actions::pass_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER); // no-op, never aborts
  assert!(fight::status(&fight) == fight::status_victory());
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
