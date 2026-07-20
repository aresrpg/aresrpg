/// ABANDON tests — any fight can be abandoned; abandoning is considered a death. Covers
/// the death + turn-handoff branches (on-turn advances the queue, off-turn leaves it intact), the terminal folds
/// (last player quits → DEFEAT → settlement mints the outcome normally), the PLACEMENT collapse (non-emptying
/// waits, an emptied PvM side defeats, an emptied PvP side hands the walkover to the survivor), and the gate
/// aborts (terminal fight / non-participant / wrong owner / already-dead). Split from fight_tests.move for the
/// ≤600-LoC file cap; the shared cross-package scaffold is imported from fight_scaffold.
#[test_only]
module aresrpg_fight::abandon_tests;

use aresrpg_fight::{
  actions,
  fight::{Self, Fight},
  participant,
  interleave,
  turns,
  settlement::{Self as results, FightOutcome},
  version::Version
};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, mk_clock, tsreg, stand_up};
use sui::{clock, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0; // the creator character's id source (mirrors the scaffold)
const CHAR2: address = @0xC2; // a joiner character
const KOLI: address = @0x201; // a kolizeum lobby id source (the PvP door's derivation scope)

// mirrored abort codes (value + module for `location =`) — all in aresrpg_fight::actions.
const A_ENotParticipant: u64 = 102;
const A_ENotYourCharacter: u64 = 103;
const A_EFightOver: u64 = 105;
const A_EAlreadyDead: u64 = 106;

// The player seat whose turn it currently is (ACTIVE invariant: turn_ptr always points at a living player).
fun current_seat(fight: &Fight): u64 {
  let a = fight::queue_actor(fight, fight::turn_ptr(fight));
  assert!(!interleave::actor_is_mob(&a));
  interleave::actor_idx(&a)
}

/// A 2-player + 1-mob PvM fight driven to ACTIVE (both placed on their seeded start cells). High mob-hp bag with
/// NO kit, so the mob never damages a player — the turn machinery is the only thing under test. Returns the
/// shared Fight + Version by value (the caller returns both to the pool).
fun two_player_active(sc: &mut ts::Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 500, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let c1 = participant::cell(fight::participants(&fight).borrow(1));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR2), c1, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  (fight, ver)
}

// ╔════════════════ [ ACTIVE — the death + turn handoff ] ════════════════════ ]

#[test]
/// Abandon on the abandoner's OWN turn: it dies (hp→0), the fight stays ACTIVE (2 players → 1 + mob), and the
/// turn hands forward to the OTHER living player — exactly a death mid-turn.
fun abandon_on_own_turn_dies_and_turn_advances() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = two_player_active(&mut sc);
  let cur = current_seat(&fight);
  let cur_char = participant::character(fight::participants(&fight).borrow(cur));
  actions::abandon_for_testing(&mut fight, cur_char, &ver, 1000, OWNER);
  assert!(participant::hp(fight::participants(&fight).borrow(cur)) == 0); // dead
  assert!(fight::status(&fight) == fight::status_active()); // party continues
  let now_cur = current_seat(&fight);
  assert!(now_cur != cur); // the turn advanced past the abandoner
  assert!(participant::is_alive(fight::participants(&fight).borrow(now_cur))); // onto a living player
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// Abandon OFF the abandoner's turn: it dies, but the current player's turn is untouched — `turn_ptr` and the
/// current seat are byte-identical before/after (the queue stays intact).
fun abandon_off_turn_dies_queue_intact() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = two_player_active(&mut sc);
  let cur = current_seat(&fight);
  let other = if (cur == 0) 1 else 0; // the seat whose turn it is NOT
  let other_char = participant::character(fight::participants(&fight).borrow(other));
  let ptr_before = fight::turn_ptr(&fight);
  actions::abandon_for_testing(&mut fight, other_char, &ver, 1000, OWNER);
  assert!(participant::hp(fight::participants(&fight).borrow(other)) == 0); // dead
  assert!(fight::status(&fight) == fight::status_active());
  assert!(fight::turn_ptr(&fight) == ptr_before); // the current turn never moved
  assert!(current_seat(&fight) == cur); // same player still on the clock
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ ACTIVE — the last-player terminal fold + settlement ] ══ ]

#[test]
/// The last living player abandons on its turn → the party is wiped → DEFEAT, and permissionless settlement
/// still mints its FightOutcome from the terminal state (defeat: final_hp 0, xp 0) — no special-case escape.
fun last_player_abandons_defeats_and_settles() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(fight::status(&fight) == fight::status_defeat());
  assert!(fight::winning_side(&fight) == option::none());
  {
    let mut reg2 = tsreg(&sc);
    results::settle_and_destroy(fight, &mut reg2, &ver, sc.ctx());
    ts::return_shared(reg2);
  };
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<Fight>()); // the shared Fight is gone
  let r = sc.take_from_sender<FightOutcome>();
  assert!(results::outcome(&r) == fight::status_defeat());
  assert!(results::character(&r) == object::id_from_address(CHAR));
  assert!(results::final_hp(&r) == 0);
  assert!(results::xp_share(&r) == 0);
  sc.return_to_sender(r);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ PLACEMENT — non-emptying / emptied side ] ══════════════ ]

#[test]
/// Abandon in PLACEMENT while a live seat remains on the side: the seat dies, the fight WAITS in placement (the
/// dead seat is simply skipped when the queue is built), the roster length is unchanged.
fun abandon_in_placement_non_emptying_waits() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  assert!(fight::status(&fight) == fight::status_placement());
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 0); // dead
  assert!(fight::status(&fight) == fight::status_placement()); // NOT collapsed — CHAR2 still stands
  assert!(fight::participant_count(&fight) == 2); // the dead seat stays on the roster
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// Abandon in PLACEMENT that EMPTIES the players' side (a solo PvM fight): collapse to DEFEAT now — no waiting on
/// force_start.
fun abandon_in_placement_empties_pvm_defeats() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  assert!(fight::status(&fight) == fight::status_placement());
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER);
  assert!(fight::status(&fight) == fight::status_defeat());
  assert!(fight::winning_side(&fight) == option::none());
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// Abandon in PLACEMENT that empties a PvP side hands the walkover to the survivor: team 0 quits before the bell →
/// team 1 wins (winning_side some(1)).
fun abandon_in_placement_empties_pvp_side_is_walkover() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let mut registry = tsreg(&sc);
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(&mut sc, 5000);
    fight::create_pvp_fight_for_testing(&mut registry, object::id_from_address(KOLI), 1, 999, 40, 40, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 100), OWNER, 1); // team 1 joins, still PLACEMENT
  assert!(fight::status(&fight) == fight::status_placement());
  assert!(fight::mode(&fight) == fight::mode_pvp());
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 5000, OWNER); // team 0 (seat 0) quits
  assert!(fight::status(&fight) == fight::status_victory());
  assert!(fight::winning_side(&fight) == option::some(1)); // team 1 walkover
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Gate aborts ] ═════════════════════════════════════════ ]

#[test, expected_failure(abort_code = A_EFightOver, location = aresrpg_fight::actions)]
/// A TERMINAL fight cannot be abandoned (nothing left to leave).
fun abandon_terminal_fight_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::set_status_active_for_testing(&mut fight);
  turns::finish_defeat_for_testing(&mut fight); // → DEFEAT (terminal)
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER); // EFightOver
  abort 0
}

#[test, expected_failure(abort_code = A_ENotParticipant, location = aresrpg_fight::actions)]
/// A character with no seat in this fight cannot abandon it.
fun abandon_non_participant_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR2), &ver, 1000, OWNER); // never joined
  abort 0
}

#[test, expected_failure(abort_code = A_ENotYourCharacter, location = aresrpg_fight::actions)]
/// Only the seat's OWNER may abandon it (no abandoning someone else's character).
fun abandon_wrong_owner_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, @0xBAD); // wrong sender
  abort 0
}

#[test, expected_failure(abort_code = A_EAlreadyDead, location = aresrpg_fight::actions)]
/// A seat that is already dead cannot re-abandon (idempotence — the death event never doubles).
fun abandon_already_dead_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 0); // already a corpse
  actions::abandon_for_testing(&mut fight, object::id_from_address(CHAR), &ver, 1000, OWNER); // EAlreadyDead
  abort 0
}
