/// Character-core tests: the lock-pledge constitution (mint → PERSONAL-kiosk lock, pledge id-match, plain-kiosk
/// refusal), the colour-range validity, the `Display<Character>` fields, and the character-owner-signed `anchor_position`
/// entry (stamps + overwrites, non-owner refused, dark-package refused). Name uniqueness / class whitelist /
/// price / pause live in the creation-gate tests, not here.
#[test_only]
module aresrpg::character_tests;

use aresrpg::{admin::{Self, AdminCap}, character::{Self, Character}, version::{Self, Version}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  clock,
  display::{Self, Display},
  kiosk::{Self, Kiosk},
  package::Publisher,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy,
  vec_map
};

const OWNER: address = @0xA;
const ATTACKER: address = @0xC;

// ── mirrored error values (module-local; `location` disambiguates which module aborted) ──
const EPledgeMismatch: u64 = 101; // character
const ENotPersonalKiosk: u64 = 102; // character
const EEmptyZone: u64 = 103; // character
const EInvalidColor: u64 = 104; // character
const EAnchorNotIncreasing: u64 = 105; // character
const V_ENotEnabled: u64 = 102; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Stand up version + admin + character, ENABLE the package, and share a `TransferPolicy<Character>` the lock
/// path binds under. Releases every control object.
fun setup(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  character::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());

  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = character::create_character_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, OWNER);
  sc.return_to_sender(publisher);
  sc.return_to_sender(cap);
  ts::return_shared(ver);
}

/// A PERSONAL kiosk (the constitution shape `lock_in_kiosk` enforces): fresh kiosk with its cap already wrapped.
fun new_personal_kiosk(sc: &mut Scenario): (Kiosk, PersonalKioskCap) {
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  (kiosk, pkcap)
}

/// Mint one character (base factory) and lock it into a fresh personal kiosk owned by `who`; shares the kiosk +
/// soulbinds the wrapped cap. Returns the character id.
fun mint_and_lock(sc: &mut Scenario, who: address): ID {
  sc.next_tx(who);
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let cust = character::new_customization(10, 20, 30);
  let (chr, pledge) = character::new_for_testing(b"hero_one".to_string(), b"senshi".to_string(), true, cust, 1234, sc.ctx());
  let cid = character::id(&chr);
  let (mut kiosk, pkcap) = new_personal_kiosk(sc);
  character::lock_in_kiosk(pledge, chr, &mut kiosk, personal_kiosk::borrow(&pkcap), &policy);
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  ts::return_shared(policy);
  cid
}

// ╔════════════════ [ Lock-pledge constitution ] ═════════════════════════════ ]

#[test]
fun mint_locks_in_personal_kiosk() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let kiosk = sc.take_shared<Kiosk>();
  assert!(kiosk.has_item(cid)); // LOCKED in the kiosk — never delivered to an address
  ts::return_shared(kiosk);
  sc.end();
}

#[test, expected_failure(abort_code = ENotPersonalKiosk, location = character)]
fun lock_into_plain_kiosk_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);

  sc.next_tx(OWNER);
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let cust = character::new_customization(1, 2, 3);
  let (chr, pledge) = character::new_for_testing(b"hero_one".to_string(), b"senshi".to_string(), true, cust, 0, sc.ctx());
  let (mut kiosk, kcap) = kiosk::new(sc.ctx()); // PLAIN kiosk (never wrapped) — the constitution refuses it
  character::lock_in_kiosk(pledge, chr, &mut kiosk, &kcap, &policy); // ENotPersonalKiosk
  abort
}

#[test, expected_failure(abort_code = EPledgeMismatch, location = character)]
fun lock_with_mismatched_pledge_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);

  sc.next_tx(OWNER);
  let policy = sc.take_shared<TransferPolicy<Character>>();
  let cust = character::new_customization(0, 0, 0);
  let (chr_a, _pledge_a) = character::new_for_testing(b"hero_one".to_string(), b"senshi".to_string(), true, cust, 0, sc.ctx());
  let (_chr_b, pledge_b) = character::new_for_testing(b"hero_two".to_string(), b"senshi".to_string(), true, cust, 0, sc.ctx());
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  // lock chr_a with the WRONG pledge → EPledgeMismatch
  character::lock_in_kiosk(pledge_b, chr_a, &mut kiosk, personal_kiosk::borrow(&pkcap), &policy);
  abort
}

// ╔════════════════ [ Customization validity ] ═══════════════════════════════ ]

#[test, expected_failure(abort_code = EInvalidColor, location = character)]
fun customization_out_of_range_aborts() {
  character::new_customization(16_777_216, 0, 0); // one past 0xFFFFFF → EInvalidColor
}

// ╔════════════════ [ Anchor ] ═══════════════════════════════════════════════ ]

#[test]
fun anchor_stamps_and_overwrites() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(5000);

  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 10, 20, b"overworld".to_string(), &clk, &ver);
  {
    let chr: &Character = kiosk.borrow(personal_kiosk::borrow(&pkcap), cid);
    let a = character::anchor(chr);
    assert_eq!(character::anchor_pos_x(&a), 10);
    assert_eq!(character::anchor_pos_z(&a), 20);
    assert_eq!(character::anchor_zone(&a), b"overworld".to_string());
    assert_eq!(character::anchor_at_ms(&a), 5000);
  };

  // a second anchor OVERWRITES the first
  clk.set_for_testing(9000);
  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 77, 88, b"dungeon".to_string(), &clk, &ver);
  {
    let chr: &Character = kiosk.borrow(personal_kiosk::borrow(&pkcap), cid);
    let a = character::anchor(chr);
    assert_eq!(character::anchor_pos_x(&a), 77);
    assert_eq!(character::anchor_zone(&a), b"dungeon".to_string());
    assert_eq!(character::anchor_at_ms(&a), 9000);
  };

  clk.destroy_for_testing();
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = EAnchorNotIncreasing, location = character)]
fun anchor_non_increasing_ms_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(5000);
  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 1, 2, b"a".to_string(), &clk, &ver);
  // a second anchor at the SAME ms is not strictly after the first → EAnchorNotIncreasing
  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 3, 4, b"b".to_string(), &clk, &ver);
  abort
}

#[test, expected_failure(abort_code = EEmptyZone, location = character)]
fun anchor_empty_zone_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let clk = clock::create_for_testing(sc.ctx());
  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 1, 2, b"".to_string(), &clk, &ver); // EEmptyZone
  abort
}

#[test, expected_failure]
fun anchor_by_non_owner_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER); // character owned by OWNER, in a kiosk owned by OWNER

  // ATTACKER holds their own personal kiosk cap — it does NOT grant access to the kiosk owned by OWNER
  sc.next_tx(ATTACKER);
  let mut owner_kiosk = sc.take_shared<Kiosk>();
  let ver = sc.take_shared<Version>();
  let (_atk_kiosk, atk_pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock::create_for_testing(sc.ctx());
  // kiosk::borrow_mut asserts the cap matches the kiosk → aborts (wrong owner)
  character::anchor_position(&mut owner_kiosk, personal_kiosk::borrow(&atk_pkcap), cid, 1, 2, b"x".to_string(), &clk, &ver);
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun anchor_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER);

  // switch the package dark again — the anchor value path must refuse
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, false, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let clk = clock::create_for_testing(sc.ctx());
  character::anchor_position(&mut kiosk, personal_kiosk::borrow(&pkcap), cid, 1, 2, b"x".to_string(), &clk, &ver); // ENotEnabled
  abort
}

// ╔════════════════ [ Display ] ══════════════════════════════════════════════ ]

#[test]
fun display_has_expected_fields() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  character::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let disp = sc.take_from_sender<Display<Character>>();
  let fields = display::fields(&disp);
  assert!(vec_map::contains(fields, &b"name".to_string()));
  assert!(vec_map::contains(fields, &b"image_url".to_string()));
  assert!(vec_map::contains(fields, &b"description".to_string()));
  assert!(vec_map::contains(fields, &b"project_url".to_string()));
  assert_eq!(
    *vec_map::get(fields, &b"image_url".to_string()),
    b"/assets/characters/{class}_{male}.png".to_string(), // host-free relative form (assets.aresrpg.world purged 2026-07-13; walrus_display_step swaps at ceremony)
  );
  sc.return_to_sender(disp);
  sc.end();
}

// ╔════════════════ [ Base-field getters ] ═══════════════════════════════════ ]

#[test]
/// Base-field getters on a minted character: name / male / created_at_ms and the three customization colours (read
/// off the `Customization` sub-struct). The character is borrowed out of its personal kiosk — never extracted.
fun character_base_getters() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let cid = mint_and_lock(&mut sc, OWNER); // name "hero_one", senshi, male, cust (10,20,30), created 1234

  sc.next_tx(OWNER);
  let kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let chr: &Character = kiosk.borrow(personal_kiosk::borrow(&pkcap), cid);
  assert_eq!(character::name(chr), b"hero_one".to_string());
  assert!(character::male(chr));
  assert_eq!(character::created_at_ms(chr), 1234);
  let cust = character::customization(chr);
  assert_eq!(character::color_1(&cust), 10);
  assert_eq!(character::color_2(&cust), 20);
  assert_eq!(character::color_3(&cust), 30);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  sc.end();
}
