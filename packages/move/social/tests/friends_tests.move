/// Friends tests — the soulbound, one-per-address whitelist. Covers add/remove/query, the DUPLICATE-ADD ABORT
/// choice (documented: aborts, mirroring party's `invite`), one-list-per-address (a second create aborts), the
/// owner-binding guard, and the dark-ship gate.
///
/// SOULBOUND ("no transfer path compiles" — ticket): `FriendList` is `key`-only (no `store`), so
/// `transfer::public_transfer(list, ...)` does NOT compile and this module exposes NO transfer entry — the
/// binding is enforced by the TYPE, which a unit test cannot exercise (there is nothing to call). It is proven
/// by construction; the behavioral consequence (only the bound address mutates, and the object is address-owned) is
/// covered by `nonowner_add_aborts` below.
#[test_only]
module aresrpg_social::friends_tests;

use aresrpg_social::{friends::{Self, FriendList, FriendRegistry}, test_harness::stand_up, version::{Self, Version}};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0x0A; // holds the AdminCap
const P1: address = @0xB1;
const P2: address = @0xB2;
const F1: address = @0xF1; // a friend address
const F2: address = @0xF2;

// ── mirrored error values ──
const EListExists: u64 = 101;
const ENotOwner: u64 = 102;
const EAlreadyFriend: u64 = 103;
const ENotFriend: u64 = 104;
const V_ENotEnabled: u64 = 102; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

fun create_list(sc: &mut Scenario, who: address) {
  sc.next_tx(who);
  let mut reg = sc.take_shared<FriendRegistry>();
  let ver = sc.take_shared<Version>();
  friends::create_friend_list(&mut reg, &ver, sc.ctx());
  ts::return_shared(reg);
  ts::return_shared(ver);
}

fun add(sc: &mut Scenario, who: address, addr: address) {
  sc.next_tx(who);
  let mut list = sc.take_from_sender<FriendList>();
  let ver = sc.take_shared<Version>();
  friends::add_friend(&mut list, addr, &ver, sc.ctx());
  sc.return_to_sender(list);
  ts::return_shared(ver);
}

fun remove(sc: &mut Scenario, who: address, addr: address) {
  sc.next_tx(who);
  let mut list = sc.take_from_sender<FriendList>();
  let ver = sc.take_shared<Version>();
  friends::remove_friend(&mut list, addr, &ver, sc.ctx());
  sc.return_to_sender(list);
  ts::return_shared(ver);
}

// ╔════════════════ [ Happy paths ] ══════════════════════════════════════════ ]

#[test]
fun create_binds_owner_empty() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);

  sc.next_tx(P1);
  let list = sc.take_from_sender<FriendList>();
  assert_eq!(friends::owner(&list), P1);
  assert_eq!(friends::friend_count(&list), 0);
  sc.return_to_sender(list);
  sc.end();
}

#[test]
fun add_and_remove_updates_whitelist() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);
  add(&mut sc, P1, F1);
  add(&mut sc, P1, F2);

  sc.next_tx(P1);
  let list = sc.take_from_sender<FriendList>();
  assert_eq!(friends::friend_count(&list), 2);
  assert!(friends::is_friend(&list, F1));
  assert!(friends::is_friend(&list, F2));
  assert_eq!(friends::friends(&list), vector[F1, F2]);
  sc.return_to_sender(list);

  remove(&mut sc, P1, F1);

  sc.next_tx(P1);
  let list = sc.take_from_sender<FriendList>();
  assert_eq!(friends::friend_count(&list), 1);
  assert!(!friends::is_friend(&list, F1));
  assert!(friends::is_friend(&list, F2));
  sc.return_to_sender(list);
  sc.end();
}

#[test]
/// Two DIFFERENT addresses each get their own list (one-per-address is per-owner, not global).
fun distinct_addresses_get_distinct_lists() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);
  create_list(&mut sc, P2); // different owner → succeeds

  sc.next_tx(P1);
  let l1 = sc.take_from_sender<FriendList>();
  assert_eq!(friends::owner(&l1), P1);
  sc.return_to_sender(l1);

  sc.next_tx(P2);
  let l2 = sc.take_from_sender<FriendList>();
  assert_eq!(friends::owner(&l2), P2);
  sc.return_to_sender(l2);
  sc.end();
}

#[test]
/// The deterministic derived-address getter (RPC uses this to find a list without an event scan) matches the
/// actually-created list's own object id.
fun list_address_matches_created_list() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);

  sc.next_tx(P1);
  let list = sc.take_from_sender<FriendList>();
  let list_id = object::id(&list);
  sc.return_to_sender(list);

  let reg = sc.take_shared<FriendRegistry>();
  assert_eq!(friends::list_address(&reg, P1), object::id_to_address(&list_id));
  assert!(friends::list_address(&reg, P1) != friends::list_address(&reg, P2)); // distinct owners → distinct addrs
  ts::return_shared(reg);
  sc.end();
}

// ╔════════════════ [ Aborts ] ═══════════════════════════════════════════════ ]

#[test, expected_failure(abort_code = EListExists, location = friends)]
/// One list per address: a second create by the same address aborts (pre-check before the derived claim).
fun second_list_same_address_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);
  create_list(&mut sc, P1); // EListExists
  abort
}

#[test, expected_failure(abort_code = EAlreadyFriend, location = friends)]
/// Duplicate-add ABORTS (the documented choice — mirrors party's EAlreadyMember).
fun add_duplicate_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);
  add(&mut sc, P1, F1);
  add(&mut sc, P1, F1); // EAlreadyFriend
  abort
}

#[test, expected_failure(abort_code = ENotFriend, location = friends)]
fun remove_absent_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);
  remove(&mut sc, P1, F1); // never added → ENotFriend
  abort
}

#[test, expected_failure(abort_code = ENotOwner, location = friends)]
/// Owner-binding guard (defense-in-depth): even if a non-owner somehow held the list, the Move guard rejects the
/// write. Simulated with `take_from_address` (on-chain, address-ownership already blocks this at the runtime).
fun nonowner_add_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, true);
  create_list(&mut sc, P1);

  sc.next_tx(P2);
  let mut list = ts::take_from_address<FriendList>(&sc, P1); // P1's list, in a P2 tx
  let ver = sc.take_shared<Version>();
  friends::add_friend(&mut list, F1, &ver, sc.ctx()); // sender P2 != owner P1 → ENotOwner
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun create_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc, false); // package NOT enabled
  create_list(&mut sc, P1); // ENotEnabled
  abort
}
