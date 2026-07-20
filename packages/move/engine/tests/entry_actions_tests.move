/// Coverage for the bare `entry fun` doors in `turns`/`actions` that no existing test drives DIRECTLY — every
/// prior suite exercises their logic exclusively through the `#[test_only]` `_for_testing` twins (which
/// reimplement the gate + call the shared private helper, bypassing the entry shell itself: e.g.
/// `pass_for_testing` never calls `act_pass`). A bare (non-`public`) `entry fun` IS callable cross-module within
/// the same package for unit tests — `fight_tests.move` already proves this via `settlement::settle_and_destroy`
/// — so these call the REAL entries directly, constructing a genuine `sui::random::Random` test object where a
/// `&Random` param is required.
#[test_only]
module aresrpg_fight::entry_actions_tests;

use aresrpg_fight::{actions, fight::{Self, Fight}, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{create_fight, first_open_move_neighbor, free_cell_near, mk_clock, stand_up};
use aresrpg_foundation::spell_effect;
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;

/// Stand up a real `sui::random::Random` shared object (the system object normally created at genesis) —
/// `create_for_testing` asserts sender == @0x0, so it must run in its own tx before switching back to OWNER.
fun mk_random(sc: &mut Scenario): sui::random::Random {
  sc.next_tx(@0x0);
  sui::random::create_for_testing(sc.ctx());
  sc.next_tx(OWNER);
  sc.take_shared<sui::random::Random>()
}

fun trap_level(min_char_level: u16): spell_effect::SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 3, 1, 4, false, false, false, true, 255, 255, 0, 0, false, vector[], vector[],
    vector[spell_effect::place_trap(spell_effect::shape_circle(), 1)],
    vector[],
  )
}

// ╔════════════════ [ turns — place / force_start / crank (all need a real &Random) ] ═ ]

#[test]
fun place_entry_readies_and_activates_solo_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 1, 0, 1000, true, option::none());
  let r = mk_random(&mut sc);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, &r, sc.ctx());
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(r);
  sc.end();
}

#[test]
fun force_start_entry_activates_after_placement_deadline() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 2, 0, 1000, true, option::none());
  let r = mk_random(&mut sc);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 200_000); // well past the 1_000 + 120_000 placement deadline
  turns::force_start(&mut fight, &ver, &clock, &r, sc.ctx()); // internally marks every seat ready (mark_all_ready)
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(r);
  sc.end();
}

#[test]
fun crank_entry_forfeits_the_overdue_turn() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 3, 0, 1000, true, option::none());
  let r = mk_random(&mut sc);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock0 = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock0, OWNER);
  clock::destroy_for_testing(clock0);
  assert!(fight::status(&fight) == fight::status_active());
  let clock_far = mk_clock(&mut sc, 999_999); // well past the 60s turn deadline
  turns::crank(&mut fight, &ver, &clock_far, &r, sc.ctx());
  clock::destroy_for_testing(clock_far);
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(r);
  sc.end();
}

// ╔════════════════ [ actions — abandon / act_move / act_weapon / act_cast / act_pass ] ═ ]

#[test]
fun abandon_entry_kills_the_seat_and_resolves_defeat() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 4, 0, 1000, true, option::none());
  let r = mk_random(&mut sc);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  assert!(fight::status(&fight) == fight::status_active());
  actions::abandon(&mut fight, object::id_from_address(CHAR), &ver, &clock, &r, sc.ctx());
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_defeat()); // the solo player's own abandon empties the side
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(r);
  sc.end();
}

#[test]
fun act_move_entry_moves_to_an_open_neighbor() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 5, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  assert!(fight::status(&fight) == fight::status_active());
  let dest = first_open_move_neighbor(&fight, 0); // board-shape-agnostic: uses the real movement wall mask
  actions::act_move(&mut fight, object::id_from_address(CHAR), dest, &ver, &clock, sc.ctx()); // covers apply_move too
  assert!(participant::cell(fight::participants(&fight).borrow(0)) == dest);
  clock::destroy_for_testing(clock);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
fun act_weapon_entry_strikes_the_adjacent_mob() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 6, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101); // Manhattan 1, clear LOS
  actions::act_weapon(&mut fight, object::id_from_address(CHAR), 101, &ver, &clock, sc.ctx());
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) < 500);
  clock::destroy_for_testing(clock);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
fun act_cast_entry_casts_the_trap_spell() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 7, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let sver = sc.take_shared<aresrpg_spells::version::Version>();
  let mut sreg = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[trap_level(1), trap_level(1), trap_level(1), trap_level(1), trap_level(1), trap_level(101)];
  aresrpg_spells::spell_template::mint_spell(&cap, &mut sreg, b"senshi".to_string(), 1, b"Test Trap Entry".to_string(), levels, 40, 5, &sver, sc.ctx());
  ts::return_shared(sreg);
  ts::return_shared(sver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let spell = sc.take_shared<aresrpg_spells::spell_template::SpellTemplate>();
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  assert!(fight::status(&fight) == fight::status_active());

  let target = free_cell_near(&fight, cell0, 2); // Manhattan 2, unoccupied — board-shape-agnostic
  actions::act_cast(&mut fight, object::id_from_address(CHAR), &spell, target, &ver, &clock, sc.ctx());
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3); // base_ap 6 - ap_cost 3

  clock::destroy_for_testing(clock);
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(spell);
  sc.end();
}

#[test]
fun act_pass_entry_ends_the_turn() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 500, 8, 0, 1000, true, option::none());
  let r = mk_random(&mut sc);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let mut clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  assert!(fight::status(&fight) == fight::status_active());
  clock.set_for_testing(5000); // past the min-turn window (turn started at 1000, MIN_TURN_MS = 3000) — the pass may now commit
  actions::act_pass(&mut fight, object::id_from_address(CHAR), &ver, &clock, &r, sc.ctx());
  assert!(fight::status(&fight) == fight::status_active()); // solo fight: the mob's turn resolves, lands back on the player
  clock::destroy_for_testing(clock);
  ts::return_shared(fight);
  ts::return_shared(ver);
  ts::return_shared(r);
  sc.end();
}
