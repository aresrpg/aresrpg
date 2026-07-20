/// RUN tests — the RunPass SECURITY CORE (§9 "the key IS the run object; ownership is the security"). Covers
/// every adversarial case the ticket names at the primitive level: a fresh run starts at room 1 · exit restores
/// the EXACT stored position (consume returns it byte-for-byte) · victory advances a party's passes · the
/// last room is detected (completion consumes) · a wrong-room join aborts · a non-owner act aborts (the bound
/// binding) · activation demands exactly ONE key unit · defeat/abandon/completion delete the pass (consume).
/// NON-TRANSFERABILITY is compile-level: `RunPass` is `key`-only (no `store`, no user transfer entry) — a test
/// cannot even attempt a `public_transfer` (it would not compile), which IS the proof.
#[test_only]
module aresrpg_dungeon::run_tests;

use aresrpg_dungeon::run;
use std::unit_test::assert_eq;
use sui::test_scenario as ts;

const OWNER: address = @0xA;
const OTHER: address = @0xB;
const THIRD: address = @0xC;

// ── mirrored run error values (`location = run` disambiguates) ──
const EWrongRoom: u64 = 101;
const ENotOwner: u64 = 102;
const ENotSingleKeyUnit: u64 = 103;

fun wid(): ID { object::id_from_address(@0x0117) }

// ╔════════════════ [ Mint + consume — position preserved exactly (§17.25) ] ══ ]

#[test]
fun new_starts_at_room_one_and_consume_returns_exact_position() {
  let mut sc = ts::begin(OWNER);
  let pass = run::new(wid(), OWNER, 12345, 67890, cid(), sc.ctx());
  assert_eq!(run::room(&pass), 1); // §9 — the run starts at room 1
  assert_eq!(run::owner(&pass), OWNER);
  assert_eq!(run::world(&pass), wid());
  assert_eq!(run::return_x(&pass), 12345);
  assert_eq!(run::return_z(&pass), 67890);
  assert_eq!(run::character(&pass), cid());

  // consume (defeat / abandon / completion) DELETES the pass and returns the restore tuple UNCHANGED.
  let (w, o, c, x, z) = run::consume(pass);
  assert_eq!(w, wid());
  assert_eq!(o, OWNER);
  assert_eq!(c, cid());
  assert_eq!(x, 12345); // exit restores the EXACT stored X (§17.25)
  assert_eq!(z, 67890); // …and Z — position unchanged, only time passed
  sc.end();
}

#[test]
/// `mint_and_bind` is the live activation door: it mints a fresh room-1 pass and TRANSFERS it to the named
/// recipient (the `key`-only transfer legal only in `run`), returning its id. The bound pass lands directly in that inventory.
fun mint_and_bind_transfers_room_one_pass_to_owner() {
  let mut sc = ts::begin(OWNER);
  let pass_id = run::mint_and_bind(wid(), OWNER, 111, 222, cid(), sc.ctx());

  sc.next_tx(OWNER);
  let pass = sc.take_from_sender<run::RunPass>(); // delivered to the bound owner
  assert_eq!(run::id(&pass), pass_id);
  assert_eq!(run::room(&pass), 1);
  assert_eq!(run::owner(&pass), OWNER);
  assert_eq!(run::return_x(&pass), 111);
  assert_eq!(run::return_z(&pass), 222);
  assert_eq!(run::character(&pass), cid());
  let (_, _, _, _, _) = run::consume(pass);
  sc.end();
}

// ╔════════════════ [ Victory advances the room — every escrowed pass ] ═══════ ]

#[test]
fun advance_room_increments() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::advance_room(&mut pass); // victory in room 1
  assert_eq!(run::room(&pass), 2);
  run::advance_room(&mut pass);
  assert_eq!(run::room(&pass), 3);
  let (_, _, _, _, _) = run::consume(pass);
  sc.end();
}

#[test]
fun victory_advances_every_pass() {
  // §9 — "victory advances every pass." A party of three, each pass advanced (each settles from its own seat).
  let mut sc = ts::begin(OWNER);
  let mut a = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  let mut b = run::new(wid(), OTHER, 0, 0, cid(), sc.ctx());
  let mut c = run::new(wid(), THIRD, 0, 0, cid(), sc.ctx());
  run::advance_room(&mut a);
  run::advance_room(&mut b);
  run::advance_room(&mut c);
  assert_eq!(run::room(&a), 2);
  assert_eq!(run::room(&b), 2);
  assert_eq!(run::room(&c), 2);
  let (_, _, _, _, _) = run::consume(a);
  let (_, _, _, _, _) = run::consume(b);
  let (_, _, _, _, _) = run::consume(c);
  sc.end();
}

// ╔════════════════ [ Last-room detection → completion consumes ] ═════════════ ]

#[test]
fun is_last_room_detects_the_final_room() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  assert!(!run::is_last_room(&pass, 3)); // room 1 of 3
  run::advance_room(&mut pass);
  assert!(!run::is_last_room(&pass, 3)); // room 2 of 3
  run::advance_room(&mut pass);
  assert!(run::is_last_room(&pass, 3)); // room 3 of 3 — the last (completion consumes it)
  let (_, _, _, _, _) = run::consume(pass); // last-room completion consumes the pass
  sc.end();
}

// ╔════════════════ [ Join gate — must be at the fight's room ] ═══════════════ ]

#[test]
fun assert_at_room_accepts_the_matching_room() {
  let mut sc = ts::begin(OWNER);
  let pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::assert_at_room(&pass, 1); // pass is at room 1 → join allowed
  let (_, _, _, _, _) = run::consume(pass);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongRoom, location = run)]
fun assert_at_room_rejects_wrong_room() {
  let mut sc = ts::begin(OWNER);
  let pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::assert_at_room(&pass, 2); // pass is at room 1, fight is room 2 → join wrong-room aborts (§9)
  abort
}

// ╔════════════════ [ Owner binding (non-transferability belt) ] ══════════════ ]

#[test, expected_failure(abort_code = ENotOwner, location = run)]
fun assert_owner_rejects_non_owner() {
  let mut sc = ts::begin(OWNER);
  let pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::assert_owner(&pass, OWNER); // the bound owner passes
  run::assert_owner(&pass, OTHER); // anyone else aborts — the pass is bound
  abort
}

// ╔════════════════ [ Activation demands exactly ONE key unit (§9) ] ══════════ ]

#[test]
fun assert_single_key_unit_accepts_one() { run::assert_single_key_unit(1); }

#[test, expected_failure(abort_code = ENotSingleKeyUnit, location = run)]
fun assert_single_key_unit_rejects_two() { run::assert_single_key_unit(2); }

// ╔════════════════ [ The fight latch (§9 — the pass never leaves its owner) ] ═ ]

// ── latch error values (location = run) ──
const EAlreadyLatched: u64 = 104;
const ENotInFight: u64 = 105;
const EWrongFight: u64 = 106;
const EWrongCharacter: u64 = 107;

fun fid(): ID { object::id_from_address(@0xF16) }
fun cid(): ID { object::id_from_address(@0xC0C) }

#[test]
fun latch_stamps_matches_and_clears() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  assert!(!run::is_latched(&pass)); // fresh pass is free
  run::latch(&mut pass, fid(), cid());
  assert!(run::is_latched(&pass));
  assert_eq!(run::latched_fight(&pass), option::some(fid()));
  run::assert_commit_match(&pass, fid(), cid()); // exact (fight, character) match passes
  run::clear_commit(&mut pass); // victory-advance frees the latch
  assert!(!run::is_latched(&pass));
  let (_, _, _, _, _) = run::consume(pass);
  sc.end();
}

#[test, expected_failure(abort_code = EAlreadyLatched, location = run)]
fun latch_twice_aborts() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::latch(&mut pass, fid(), cid());
  run::latch(&mut pass, fid(), cid()); // §9 — one fight at a time (double-latch refused)
  abort
}

#[test, expected_failure(abort_code = EWrongFight, location = run)]
fun commit_match_rejects_wrong_fight() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::latch(&mut pass, fid(), cid());
  run::assert_commit_match(&pass, object::id_from_address(@0xBAD), cid()); // a FightResult from another fight
  abort
}

#[test, expected_failure(abort_code = EWrongCharacter, location = run)]
fun commit_match_rejects_wrong_character() {
  let mut sc = ts::begin(OWNER);
  let mut pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::latch(&mut pass, fid(), cid());
  run::assert_commit_match(&pass, fid(), object::id_from_address(@0xBAD)); // a result for a different character
  abort
}

#[test, expected_failure(abort_code = ENotInFight, location = run)]
fun commit_match_rejects_unlatched() {
  let mut sc = ts::begin(OWNER);
  let pass = run::new(wid(), OWNER, 0, 0, cid(), sc.ctx());
  run::assert_commit_match(&pass, fid(), cid()); // no latch → nothing to settle
  abort
}
