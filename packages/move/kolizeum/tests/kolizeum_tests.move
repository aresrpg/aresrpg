/// KOLIZEUM tests — the MONEY core ships COMPLETE and TESTED regardless of the declared fight bridge. Covers
/// every adversarial money property the ticket names: pledge mismatch aborts · early-exit FULL refund (exact) ·
/// cancel refunds ALL · equal split + deterministic remainder (exact) · NO pot leak (sum-in == sum-out, driven
/// end-to-end) · friends snapshot immutability (a not-in-snapshot join aborts; the snapshot is a frozen copy) ·
/// max-level-diff abort · double-join abort · plus the gates (bad format, level gate, not-open, dark version,
/// sweep). Create/join run through `create_for_testing`/`join_for_testing` — the SAME internal bodies the live
/// public doors use, with the character level INJECTED (the public doors read it via `character_link::level`;
/// standing up a real `Character` is the S-30 e2e harness's job, not a money-core unit test's).
#[test_only]
module aresrpg_kolizeum::kolizeum_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  config::{Self, GameConfig},
  version::{Self, Version}
};
use aresrpg_kolizeum::kolizeum::{Self, Kolizeum};
use std::unit_test::assert_eq;
use sui::{coin::{Self, Coin}, sui::SUI, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CREATOR: address = @0xC0;
const P1: address = @0xC1;
const P2: address = @0xC2;
const P3: address = @0xC3;
const P4: address = @0xC4;

// Default lobby dials for the harness.
const GATE: u64 = 10; // GameConfig default pvp_level_gate (§17.30)
const LVL: u64 = 20; // a comfortable in-gate level
const PLEDGE: u64 = 1_000; // MIST per seat

// ── mirrored error values (module-local; `location` disambiguates which module aborted) ──
const EBadFormat: u64 = 101;
const EPledgeMismatch: u64 = 102;
const ELevelTooLow: u64 = 103;
const ELevelDiffTooHigh: u64 = 104;
const ENotOpen: u64 = 105;
const ENotFriend: u64 = 106;
const EAlreadyJoined: u64 = 107;
const ENotCreator: u64 = 111;
const ENoWinners: u64 = 114;
const ENotSweepable: u64 = 115;
const EWrongFight: u64 = 116;
const V_ENotEnabled: u64 = 102; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

fun cid(a: address): ID { object::id_from_address(a) }

/// Stand up an ENABLED GameConfig + an ENABLED kolizeum Version (both ship dark).
public fun stand_up(sc: &mut Scenario) {
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  version::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  ts::return_shared(cfg);

  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

fun coins(sc: &mut Scenario, v: u64): Coin<SUI> { coin::mint_for_testing<SUI>(v, sc.ctx()) }

/// Create a PUBLIC lobby (creator level = LVL) with `format`, `pledge`, `max_diff`, paying `pay`.
public fun create_public(sc: &mut Scenario, who: address, format: u64, pledge: u64, max_diff: u64, pay: u64) {
  sc.next_tx(who);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let c = coins(sc, pay);
  kolizeum::create_for_testing(&cfg, format, pledge, true, vector[], max_diff, LVL, cid(who), c, &ver, sc.ctx());
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

/// A join by `who` at `level`, paying `pay`.
public fun join_lvl(sc: &mut Scenario, who: address, level: u64, pay: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kolizeum>();
  let ver = sc.take_shared<Version>();
  let c = coins(sc, pay);
  kolizeum::join_for_testing(&mut k, level, cid(who), c, &ver, sc.ctx());
  ts::return_shared(k);
  ts::return_shared(ver);
}

public fun join_ok(sc: &mut Scenario, who: address) { join_lvl(sc, who, LVL, PLEDGE); }

public fun do_exit(sc: &mut Scenario, who: address) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kolizeum>();
  let ver = sc.take_shared<Version>();
  kolizeum::exit(&mut k, &ver, sc.ctx());
  ts::return_shared(k);
  ts::return_shared(ver);
}

/// Assert `who` holds exactly one refund/payout coin of `expect` MIST, then burn it.
public fun assert_received(sc: &mut Scenario, who: address, expect: u64) {
  sc.next_tx(who);
  let c = ts::take_from_address<Coin<SUI>>(sc, who);
  assert_eq!(c.value(), expect);
  c.burn_for_testing();
}

/// Assert `@treasury` received EXACTLY `expect` MIST (the 10% platform cut) and burn it — the same take-from-address
/// proof `pool_tests` uses for the marketplace royalty. Used only on the WON-pot paths (a refund/draw takes no cut).
public fun assert_treasury_got(sc: &mut Scenario, expect: u64) {
  sc.next_tx(OWNER);
  let cut = ts::take_from_address<Coin<SUI>>(sc, @treasury);
  assert_eq!(cut.value(), expect);
  cut.burn_for_testing();
}

/// Assert `@treasury` holds NO coin — the no-cut proof for the DRAW / refund paths (a refund is never cut).
public fun assert_treasury_empty(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_for_address<Coin<SUI>>(@treasury));
}

// ╔════════════════ [ Create — happy path + gates ] ══════════════════════════ ]

#[test]
fun create_seeds_creator_and_pot() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::creator(&k), CREATOR);
  assert_eq!(kolizeum::status(&k), kolizeum::status_open());
  assert_eq!(kolizeum::pot_value(&k), PLEDGE); // exactly the creator's pledge
  assert_eq!(kolizeum::fighter_count(&k), 1); // creator seated on side A
  assert_eq!(kolizeum::side_a_size(&k), 1);
  assert_eq!(kolizeum::side_b_size(&k), 0);
  assert_eq!(kolizeum::creator_level(&k), LVL);
  ts::return_shared(k);
  sc.end();
}

#[test]
/// The lobby dial getters read straight off a created lobby: format slots, per-seat pledge, max level diff, and
/// the STARTED status constant (distinct from OPEN).
fun lobby_dial_getters() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::format_slots(&k), 3);
  assert_eq!(kolizeum::pledge_amount(&k), PLEDGE);
  assert_eq!(kolizeum::max_level_diff(&k), 100);
  assert!(kolizeum::status_started() != kolizeum::status_open()); // the STARTED status constant
  ts::return_shared(k);
  sc.end();
}

#[test, expected_failure(abort_code = EBadFormat, location = kolizeum)]
fun create_bad_format_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 4, PLEDGE, 100, PLEDGE); // 4 is not 1/3/6
  abort
}

#[test, expected_failure(abort_code = EPledgeMismatch, location = kolizeum)]
fun create_pledge_mismatch_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE - 1); // pays one MIST short
  abort
}

#[test, expected_failure(abort_code = ELevelTooLow, location = kolizeum)]
fun create_below_gate_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(CREATOR);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let c = coins(&mut sc, PLEDGE);
  kolizeum::create_for_testing(&cfg, 1, PLEDGE, true, vector[], 100, GATE - 1, cid(CREATOR), c, &ver, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun create_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  // Enable the GameConfig but leave kolizeum DARK.
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  version::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  ts::return_shared(cfg);
  sc.return_to_sender(cap);

  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE); // kolizeum version dark → aborts
  abort
}

// ╔════════════════ [ Join — gates ] ═════════════════════════════════════════ ]

#[test]
fun join_auto_balances_sides() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE); // creator → A
  join_ok(&mut sc, P1); // → B
  join_ok(&mut sc, P2); // tie → A
  join_ok(&mut sc, P3); // → B

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::side_a_size(&k), 2); // creator, P2
  assert_eq!(kolizeum::side_b_size(&k), 2); // P1, P3
  assert_eq!(kolizeum::pot_value(&k), PLEDGE * 4); // money invariant: 4 seats × pledge
  ts::return_shared(k);
  sc.end();
}

#[test, expected_failure(abort_code = EPledgeMismatch, location = kolizeum)]
fun join_pledge_mismatch_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_lvl(&mut sc, P1, LVL, PLEDGE + 5); // overpays → mismatch
  abort
}

#[test, expected_failure(abort_code = ELevelDiffTooHigh, location = kolizeum)]
fun join_level_diff_too_high_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 5, PLEDGE); // creator LVL=20, max diff 5
  join_lvl(&mut sc, P1, LVL + 6, PLEDGE); // level 26 → diff 6 > 5 → abort
  abort
}

#[test, expected_failure(abort_code = ELevelTooLow, location = kolizeum)]
fun join_below_gate_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_lvl(&mut sc, P1, GATE - 1, PLEDGE); // under the gate snapshot
  abort
}

#[test, expected_failure(abort_code = EAlreadyJoined, location = kolizeum)]
fun double_join_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);
  join_ok(&mut sc, P1); // same wallet + character again → abort
  abort
}

#[test, expected_failure(abort_code = ENotOpen, location = kolizeum)]
fun join_after_start_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k); // OPEN → STARTED
  ts::return_shared(k);

  join_ok(&mut sc, P1); // no joins after start
  abort
}

// ╔════════════════ [ Friends-only snapshot immutability (§7) ] ══════════════ ]

#[test]
fun friends_snapshot_gates_joins_and_is_frozen() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);

  // A friends-only lobby whose snapshot is EXACTLY [P1] (a frozen vector copy — no live FriendList reference).
  sc.next_tx(CREATOR);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let c = coins(&mut sc, PLEDGE);
  kolizeum::create_for_testing(&cfg, 3, PLEDGE, false, vector[P1], 100, LVL, cid(CREATOR), c, &ver, sc.ctx());
  ts::return_shared(cfg);
  ts::return_shared(ver);

  join_ok(&mut sc, P1); // P1 is in the snapshot → allowed

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::allow_snapshot(&k), vector[P1]); // still exactly [P1] — a later friend-add can't mutate it
  assert!(!kolizeum::is_public(&k));
  ts::return_shared(k);
  sc.end();
}

#[test, expected_failure(abort_code = ENotFriend, location = kolizeum)]
fun friends_only_rejects_non_snapshot_join() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(CREATOR);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let c = coins(&mut sc, PLEDGE);
  kolizeum::create_for_testing(&cfg, 3, PLEDGE, false, vector[P1], 100, LVL, cid(CREATOR), c, &ver, sc.ctx());
  ts::return_shared(cfg);
  ts::return_shared(ver);

  join_ok(&mut sc, P2); // P2 not in [P1] → ENotFriend (even if "befriended later", the snapshot is frozen)
  abort
}

// ╔════════════════ [ Exit — full refund (§17.9) ] ═══════════════════════════ ]

#[test]
fun exit_refunds_pledge_exactly() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);
  join_ok(&mut sc, P2); // pot = 3 × PLEDGE
  do_exit(&mut sc, P1); // P1 leaves → refunded exactly PLEDGE

  assert_received(&mut sc, P1, PLEDGE); // exact full refund

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), PLEDGE * 2); // invariant holds: 2 seats remain
  assert_eq!(kolizeum::fighter_count(&k), 2);
  ts::return_shared(k);
  sc.end();
}

#[test]
fun last_exit_auto_cancels() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE); // lone creator
  do_exit(&mut sc, CREATOR); // last fighter leaves

  assert_received(&mut sc, CREATOR, PLEDGE);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::status(&k), kolizeum::status_cancelled()); // auto-cancelled when empty
  assert_eq!(kolizeum::pot_value(&k), 0);
  ts::return_shared(k);
  sc.end();
}

// ╔════════════════ [ Cancel — refunds ALL ] ═════════════════════════════════ ]

#[test]
fun cancel_refunds_everyone() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);
  join_ok(&mut sc, P2); // pot = 3 × PLEDGE

  sc.next_tx(CREATOR);
  let mut k = sc.take_shared<Kolizeum>();
  let ver = sc.take_shared<Version>();
  kolizeum::cancel(&mut k, &ver, sc.ctx());
  assert_eq!(kolizeum::status(&k), kolizeum::status_cancelled());
  assert_eq!(kolizeum::pot_value(&k), 0); // fully drained
  ts::return_shared(k);
  ts::return_shared(ver);

  assert_received(&mut sc, CREATOR, PLEDGE);
  assert_received(&mut sc, P1, PLEDGE);
  assert_received(&mut sc, P2, PLEDGE);
  sc.end();
}

#[test, expected_failure(abort_code = ENotCreator, location = kolizeum)]
fun cancel_by_non_creator_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);

  sc.next_tx(P1); // a joiner, not the creator
  let mut k = sc.take_shared<Kolizeum>();
  let ver = sc.take_shared<Version>();
  kolizeum::cancel(&mut k, &ver, sc.ctx());
  abort
}

// ╔════════════════ [ Settle — equal split + deterministic remainder ] ═══════ ]

#[test]
fun settle_splits_equally_with_remainder_to_first_winner() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  // 5 seats, pledge 5 → pot 25. Sides: A=[creator,P2,P4], B=[P1,P3].
  create_public(&mut sc, CREATOR, 3, 5, 100, 5);
  join_lvl(&mut sc, P1, LVL, 5); // → B  (join_order 1)
  join_lvl(&mut sc, P2, LVL, 5); // → A
  join_lvl(&mut sc, P3, LVL, 5); // → B  (join_order 3)
  join_lvl(&mut sc, P4, LVL, 5); // → A

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), 25);
  assert_eq!(kolizeum::side_b_size(&k), 2); // P1, P3
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_b(), sc.ctx()); // side B (2 winners) wins
  assert_eq!(kolizeum::status(&k), kolizeum::status_settled());
  assert_eq!(kolizeum::pot_value(&k), 0); // pot fully drained
  ts::return_shared(k);

  // PLATFORM CUT: pot 25 → fee floor(25×10%)=2 → @treasury; winners split the 23 net.
  // 23 / 2 = 11 each, remainder 1 → the FIRST winner by join order (P1, join_order 1) gets 12.
  assert_eq!(kolizeum::platform_cut_of(25), 2); // the exact floored cut (== execution)
  assert_received(&mut sc, P1, 12);
  assert_received(&mut sc, P3, 11);
  assert_treasury_got(&mut sc, 2); // 2 cut + 12 + 11 == 25 — money conserved
  sc.end();
}

#[test]
/// PLATFORM CUT — the clean 10% proof: a 1v1 pot of 2 SUI settles as a 0.2 SUI cut to
/// @treasury and a 1.8 SUI net to the lone winner (90%). Exact split — no MIST created or lost.
fun settle_takes_platform_cut_winner_nets_90() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let pledge = 1_000_000_000; // 1 SUI — clean 10% math
  create_public(&mut sc, CREATOR, 1, pledge, 100, pledge); // creator → A
  join_lvl(&mut sc, P1, LVL, pledge); // → B; pot = 2 SUI

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), 2_000_000_000);
  assert_eq!(kolizeum::platform_cut_of(2_000_000_000), 200_000_000); // 10% floored = 0.2 SUI
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // side A (creator, 1 winner) wins
  assert_eq!(kolizeum::pot_value(&k), 0); // drained: 0.2 cut + 1.8 net
  ts::return_shared(k);

  assert_received(&mut sc, CREATOR, 1_800_000_000); // the lone winner NETS 90% (1.8 SUI)
  assert_treasury_got(&mut sc, 200_000_000); // the 10% cut → @treasury (0.2 + 1.8 == 2.0)
  sc.end();
}

#[test, expected_failure(abort_code = ENoWinners, location = kolizeum)]
fun settle_empty_side_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE); // only side A has the creator; side B empty

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_b(), sc.ctx()); // empty side can't win
  abort
}

// ╔════════════════ [ THE property test — no pot leak (sum-in == sum-out) ] ═══ ]

#[test]
fun no_pot_leak_across_exit_and_settle() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  // 4 seats in (pot 4×PLEDGE). Sides after joins: A=[creator,P2], B=[P1,P3].
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1); // B
  join_ok(&mut sc, P2); // A
  join_ok(&mut sc, P3); // B
  do_exit(&mut sc, P3); // P3 leaves B → refunded PLEDGE; pot = 3×PLEDGE; B=[P1]

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), PLEDGE * 3);
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // A (creator,P2) wins 3×PLEDGE
  assert_eq!(kolizeum::pot_value(&k), 0);
  ts::return_shared(k);

  // PLATFORM CUT + conservation: pot 3×PLEDGE=3000 → fee floor(3000×10%)=300 → @treasury; winners split 2700.
  // 2700 / 2 = 1350 each, rem 0. Grand total OUT: P3 refund 1000 + creator 1350 + P2 1350 + treasury 300 = 4000
  // == 4×PLEDGE IN. The cut is part of SUI-out (to @treasury), never a leak.
  assert_received(&mut sc, P3, PLEDGE); // the refund (uncut)
  assert_received(&mut sc, CREATOR, 1350);
  assert_received(&mut sc, P2, 1350);
  assert_treasury_got(&mut sc, 300); // 1000 + 1350 + 1350 + 300 == 4000 == total pledged in — conservation proven
  sc.end();
}

#[test]
fun zero_pledge_lobby_is_a_clean_noop_economy() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, 0, 100, 0); // 0-pledge friendly duel

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), 0);
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // splits 0 → no coins moved
  assert_eq!(kolizeum::pot_value(&k), 0);
  ts::return_shared(k);
  assert_treasury_empty(&mut sc); // zero pot → zero cut (platform_cut_of(0) == 0, no treasury transfer)
  sc.end();
}

// ╔════════════════ [ Sweep ] ════════════════════════════════════════════════ ]

#[test]
fun sweep_deletes_a_drained_husk() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE);
  do_exit(&mut sc, CREATOR); // auto-cancelled, pot drained
  assert_received(&mut sc, CREATOR, PLEDGE);

  sc.next_tx(P1); // anyone may sweep (the janitor's tip)
  let k = sc.take_shared<Kolizeum>();
  kolizeum::sweep(k);
  sc.end();
}

#[test, expected_failure(abort_code = ENotSweepable, location = kolizeum)]
fun sweep_open_lobby_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE); // still OPEN (holds funds)

  sc.next_tx(P1);
  let k = sc.take_shared<Kolizeum>();
  kolizeum::sweep(k); // funds present → not sweepable
  abort
}

// ╔════════════════ [ K2 fight bridge — binding + draw + membership (S-13b) ] ══ ]

#[test, expected_failure(abort_code = EWrongFight, location = kolizeum)]
fun settle_wrong_fight_id_refused() {
  // A random terminal fight's result cannot settle THIS lobby's pot — settlement asserts the BOUND fight id (the
  // id `start` derived + stored). This is the "a random terminal fight must not settle someone else's pot" gate.
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k);
  kolizeum::bind_fight_for_testing(&mut k, cid(@0xF16)); // this lobby is bound to fight 0xF16
  kolizeum::settle_bound_for_testing(&mut k, cid(@0xBAD), option::some(kolizeum::side_a()), sc.ctx()); // foreign result
  abort
}

#[test]
fun draw_refunds_every_pledge() {
  // §17.9: a mutual-wipe DRAW (winner_team == none) refunds EVERY pledge — a draw is a refund, not an abort, and
  // ENoWinners is never reached (a real terminal is a winner OR a full-refund draw).
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE); // A=[creator]
  join_ok(&mut sc, P1); // B
  join_ok(&mut sc, P2); // A → pot = 3 × PLEDGE

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::pot_value(&k), PLEDGE * 3);
  kolizeum::start_for_testing(&mut k);
  kolizeum::bind_fight_for_testing(&mut k, cid(@0xF16));
  kolizeum::settle_bound_for_testing(&mut k, cid(@0xF16), option::none(), sc.ctx()); // the bound fight drew
  assert_eq!(kolizeum::status(&k), kolizeum::status_settled());
  assert_eq!(kolizeum::pot_value(&k), 0); // drained via refunds, not a winner-payout
  ts::return_shared(k);

  // every pledger refunded EXACTLY their own pledge (no winner-split; sum-out == sum-in)
  assert_received(&mut sc, CREATOR, PLEDGE);
  assert_received(&mut sc, P1, PLEDGE);
  assert_received(&mut sc, P2, PLEDGE);
  assert_treasury_empty(&mut sc); // a DRAW is a refund — NO platform cut taken (only a real WIN is cut)
  sc.end();
}

#[test]
fun seat_gate_admits_members_refuses_strangers() {
  // The seat/start membership gate (`member_side`): a member resolves to THEIR lobby side; a stranger — or a
  // member fielding a character they never pledged — resolves to `none`, so `seat`/`start` refuse (ENotParticipant).
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE); // creator → A (character cid(CREATOR))
  join_ok(&mut sc, P1); // → B (character cid(P1))

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kolizeum>();
  let sa = kolizeum::member_side_for_testing(&k, CREATOR, cid(CREATOR));
  assert!(sa.is_some() && *sa.borrow() == kolizeum::side_a()); // creator seats team 0 (side A)
  let sb = kolizeum::member_side_for_testing(&k, P1, cid(P1));
  assert!(sb.is_some() && *sb.borrow() == kolizeum::side_b()); // P1 seats team 1 (side B)
  assert!(kolizeum::member_side_for_testing(&k, P2, cid(P2)).is_none()); // never joined → not a member
  assert!(kolizeum::member_side_for_testing(&k, CREATOR, cid(P1)).is_none()); // right wallet, wrong character
  ts::return_shared(k);
  sc.end();
}
