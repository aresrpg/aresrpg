// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Item-core tests: the lock-pledge constitution (mint → lock, pledge id-match), the `item_type` snapshot that
/// backs Display, the template getters, and the marketplace policy seam. No caps, no supply — those live in the
/// `admin` and `shop` tests.
#[test_only]
module aresrpg::item_tests;

use aresrpg::{item::{Self, Item, ItemTemplate}, item_stats, test_world, version::{Self, Version}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{kiosk::{Self, Kiosk}, package::Publisher, test_scenario::{Self as ts}};

const OWNER: address = @0xA;

const EPledgeMismatch: u64 = 101; // item
const ELevelTooLow: u64 = 102; // item
const ENotPersonalKiosk: u64 = 103; // item
const ENotStackable: u64 = 104; // item
const EZeroQuantity: u64 = 105; // item
const ETemplateMismatch: u64 = 106; // item
const ESplitTooLarge: u64 = 107; // item

// ╔════════════════ [ Lock-pledge constitution + snapshot ] ═════════════════ ]

#[test]
fun mint_then_lock_snapshots_type_and_locks() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let tid = item::share_template(item::new_template(b"Iron Sword".to_string(), b"".to_string(), b"iron_sword".to_string(), b"sword".to_string(), 10, sc.ctx()));

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();

  // template getters reflect what was authored
  assert_eq!(item::template_id(&tmpl), tid);
  assert_eq!(item::template_name(&tmpl), b"Iron Sword".to_string());
  assert_eq!(item::template_item_type(&tmpl), b"iron_sword".to_string());
  assert_eq!(item::template_category(&tmpl), b"sword".to_string());
  assert_eq!(item::template_level(&tmpl), 10); // level stored/read

  let (policy, policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());
  let (mut ksk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut ksk, kcap, sc.ctx()); // G9: item lock now requires a PERSONAL kiosk

  let (it, pledge) = item::mint(&tmpl, sc.ctx());
  let iid = object::id(&it);
  assert_eq!(item::template(&it), tid);
  assert_eq!(item::name(&it), b"Iron Sword".to_string()); // display name snapshotted from the template
  assert_eq!(item::item_type(&it), b"iron_sword".to_string()); // snapshot copied from the template
  item::lock_in_kiosk(pledge, it, &mut ksk, personal_kiosk::borrow(&pkcap), &policy);
  assert!(ksk.has_item(iid)); // the item is LOCKED in the kiosk — never delivered to an address

  destroy(ksk);
  destroy(pkcap);
  destroy(policy);
  destroy(policy_cap);
  destroy(publisher);
  ts::return_shared(tmpl);
  ts::return_shared(version);
  sc.end();
}

#[test, expected_failure(abort_code = EPledgeMismatch, location = item)]
fun lock_with_mismatched_pledge_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  item::share_template(item::new_template(b"Widget".to_string(), b"".to_string(), b"widget".to_string(), b"misc".to_string(), 1, sc.ctx()));

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, _policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());
  let (mut ksk, kcap) = kiosk::new(sc.ctx());

  let (item_a, _pledge_a) = item::mint(&tmpl, sc.ctx());
  let (_item_b, pledge_b) = item::mint(&tmpl, sc.ctx());
  // lock item_a with the WRONG pledge → EPledgeMismatch (asserted BEFORE the personal-kiosk check)
  item::lock_in_kiosk(pledge_b, item_a, &mut ksk, &kcap, &policy);
  abort
}

#[test, expected_failure(abort_code = ENotPersonalKiosk, location = item)]
/// G9 (ruling R-C2): locking a minted item into a NON-personal kiosk aborts — the constitution is not weaker for
/// items than for characters (a transferable OwnerCap on a shared kiosk is the royalty-evasion path it kills).
fun lock_into_non_personal_kiosk_aborts() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  item::share_template(item::new_template(b"Widget".to_string(), b"".to_string(), b"widget".to_string(), b"misc".to_string(), 1, sc.ctx()));

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<item::ItemTemplate>();
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, _policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());
  let (mut ksk, kcap) = kiosk::new(sc.ctx()); // a PLAIN (non-personal) kiosk

  let (it, pledge) = item::mint(&tmpl, sc.ctx());
  item::lock_in_kiosk(pledge, it, &mut ksk, &kcap, &policy); // ENotPersonalKiosk
  abort
}

// ╔════════════════ [ Stackable amount — z38 / merge / split ] ════════ ]

#[test]
/// A stackable (resource) mint carries `amount = quantity` in ONE object, snapshots its category, and still
/// personal-kiosk-locks like every item.
fun mint_stack_sets_amount_and_locks() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let tmpl = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());
  let (mut ksk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut ksk, kcap, sc.ctx());

  let (it, pledge) = item::z38(&tmpl, 5, sc.ctx());
  assert_eq!(item::amount(&it), 5); // one object, five units
  assert_eq!(item::category(&it), b"resource".to_string()); // category snapshotted onto the item
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut ksk, personal_kiosk::borrow(&pkcap), &policy);
  assert!(ksk.has_item(iid));

  item::share_template(tmpl);
  destroy(ksk); destroy(pkcap); destroy(policy); destroy(policy_cap); destroy(publisher);
  ts::return_shared(version);
  sc.end();
}

#[test]
/// A GEAR mint is amount = 1 (a unique NFT never carries a stack).
fun gear_mint_amount_is_one() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1, sc.ctx());
  let it = item::mint_for_testing(&tmpl, sc.ctx());
  assert_eq!(item::amount(&it), 1);
  destroy(it);
  item::share_template(tmpl);
  sc.end();
}

#[test, expected_failure(abort_code = ENotStackable, location = item)]
/// `z38` on a NON-stackable category aborts — gear is a unique NFT, never stack-minted.
fun mint_stack_on_non_stackable_aborts() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1, sc.ctx());
  let (_it, _pledge) = item::z38(&tmpl, 5, sc.ctx()); // ENotStackable
  abort
}

#[test]
/// RUNE is a stackable category (2026-07-11 crush lane): `forgemagie::crush` mints yielded runes as STACKS —
/// without this membership every rune mint aborted `ENotStackable` (latent, previously masked by
/// resource-category test stand-ins).
fun mint_stack_rune_category_stacks() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"RuneFo".to_string(), b"".to_string(), b"rune_fo".to_string(), b"rune".to_string(), 1, sc.ctx());
  let it = item::mint_stack_for_testing(&tmpl, 7, sc.ctx());
  assert_eq!(item::amount(&it), 7);
  destroy(it);
  item::share_template(tmpl);
  sc.end();
}

#[test]
/// `merge` folds `b`'s units into `a` (same stackable template) and deletes `b`.
fun merge_folds_amount_and_deletes_b() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let mut a = item::mint_stack_for_testing(&tmpl, 3, sc.ctx());
  let b = item::mint_stack_for_testing(&tmpl, 4, sc.ctx());
  item::merge(&mut a, b); // b deleted; a now carries 7
  assert_eq!(item::amount(&a), 7);
  destroy(a);
  item::share_template(tmpl);
  sc.end();
}

#[test, expected_failure(abort_code = ETemplateMismatch, location = item)]
/// `merge` of two DIFFERENT templates aborts (a stack is per-template).
fun merge_wrong_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let t1 = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let t2 = item::new_template(b"Stone".to_string(), b"".to_string(), b"stone".to_string(), b"resource".to_string(), 1, sc.ctx());
  let mut a = item::mint_stack_for_testing(&t1, 3, sc.ctx());
  let b = item::mint_stack_for_testing(&t2, 4, sc.ctx());
  item::merge(&mut a, b); // ETemplateMismatch
  abort
}

#[test, expected_failure(abort_code = ENotStackable, location = item)]
/// `merge` of two SAME-template but NON-stackable items aborts (two identical gear NFTs never merge).
fun merge_non_stackable_aborts() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Sword".to_string(), b"".to_string(), b"sword".to_string(), b"sword".to_string(), 1, sc.ctx());
  let mut a = item::mint_for_testing(&tmpl, sc.ctx());
  let b = item::mint_for_testing(&tmpl, sc.ctx());
  item::merge(&mut a, b); // passes the template check, fails ENotStackable
  abort
}

#[test]
/// `split` takes `take` units into a NEW item, leaves the rest in `a`, and the new item carries a LockPledge that
/// FORCES a personal-kiosk lock (discharged here — proof the split re-imposes the constitution).
fun split_takes_amount_and_pledge_forces_lock() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let tmpl = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());
  let (mut ksk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut ksk, kcap, sc.ctx());

  let mut a = item::mint_stack_for_testing(&tmpl, 10, sc.ctx());
  let (b, pledge) = item::split(&mut a, 3, sc.ctx());
  assert_eq!(item::amount(&a), 7); // source left with the remainder
  assert_eq!(item::amount(&b), 3); // new item carries the taken units
  let bid = object::id(&b);
  item::lock_in_kiosk(pledge, b, &mut ksk, personal_kiosk::borrow(&pkcap), &policy); // the pledge MUST be discharged
  assert!(ksk.has_item(bid));

  item::share_template(tmpl);
  destroy(a); destroy(ksk); destroy(pkcap); destroy(policy); destroy(policy_cap); destroy(publisher);
  ts::return_shared(version);
  sc.end();
}

#[test, expected_failure(abort_code = ESplitTooLarge, location = item)]
/// `split` of `take == amount` aborts — a split must leave at least one unit in the source (never a zombie of 0).
fun split_over_amount_aborts() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let mut a = item::mint_stack_for_testing(&tmpl, 5, sc.ctx());
  let (_b, _pledge) = item::split(&mut a, 5, sc.ctx()); // ESplitTooLarge (would zero the source)
  abort
}

#[test, expected_failure(abort_code = EZeroQuantity, location = item)]
/// `split` of 0 units aborts.
fun split_zero_aborts() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, sc.ctx());
  let mut a = item::mint_stack_for_testing(&tmpl, 5, sc.ctx());
  let (_b, _pledge) = item::split(&mut a, 0, sc.ctx()); // EZeroQuantity
  abort
}

// ╔════════════════ [ Policy seam ] ═════════════════════════════════════════ ]

#[test]
fun create_item_policy_yields_policy_and_cap() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  item::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let version = sc.take_shared<Version>();
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &version, sc.ctx());

  destroy(policy);
  destroy(policy_cap);
  destroy(publisher);
  ts::return_shared(version);
  sc.end();
}

// ╔════════════════ [ Mint-roll: values land in [min,max], degenerate fields fixed ] ═ ]

#[test]
/// The core stat-roll math (the single stat-shape EVERY mint seam draws): every field rolls inside its [min,max]
/// and a degenerate range (min==max) yields the fixed value, over a sweep of seeds. The seed is what a seam draws
/// from `&Random`; the roll itself is a pure function of it — same seed, same block, on every machine.
fun roll_stays_within_ranges_and_fixes_degenerate() {
  // vitality varies in [100,200]; every other field degenerate at 5.
  let min = item_stats::new(100, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5);
  let max = item_stats::new(200, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5);
  let mut seed = 0;
  while (seed < 64) {
    let rolled = item_stats::roll(&min, &max, seed);
    let v = item_stats::vitality(&rolled);
    assert!(v >= 100 && v <= 200);
    assert_eq!(item_stats::wisdom(&rolled), 5); // min==max → fixed
    assert_eq!(item_stats::air_resistance(&rolled), 5);
    assert_eq!(item_stats::vitality(&item_stats::roll(&min, &max, seed)), v); // pure: same seed, same roll
    seed = seed + 1;
  };
}

#[test]
/// G5 relic dream-roll: authoring the range at the centered floor (SHIFT+1) up to a high max makes the GENERAL
/// [min,max] roll produce the full "1..max" trash-to-god spread — the special case falls out of the general one,
/// so no separate roll variant is needed.
fun relic_dream_roll_spans_floor_to_max() {
  let s = item_stats::shift(); // 32768 centre
  // vitality rolls across the WIDE relic span [s+1, s+2000]; every other field fixed at the centre.
  let min = item_stats::new(s + 1, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s);
  let max = item_stats::new(s + 2000, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s);
  // a spread of seeds lands DIFFERENT values across the span — the dream roll is not a fixed point
  let mut distinct = 0u64;
  let first = item_stats::vitality(&item_stats::roll(&min, &max, 0));
  let mut seed = 0;
  while (seed < 64) {
    let rolled = item_stats::roll(&min, &max, seed);
    let v = item_stats::vitality(&rolled);
    assert!(v >= s + 1 && v <= s + 2000); // lands anywhere in the dream-roll span
    assert_eq!(item_stats::wisdom(&rolled), s); // a degenerate (centre) field is unaffected
    if (v != first) distinct = distinct + 1;
    seed = seed + 1;
  };
  assert!(distinct > 0);
}

// ╔════════════════ [ Stat clamp helpers (pure math) ] ═══════════════════════ ]

#[test]
/// `item_stats::clamp_to` takes the per-field MIN of a value block against a ceiling (the scribe clamp reuses it),
/// exercising the internal `min_u16` on BOTH branches, plus the crit-line getters. Pure math — no world.
fun stats_clamp_to_takes_per_field_min() {
  // critical_chance HIGH (over ceiling), critical_outcomes LOW (under ceiling); everything else 0.
  let value = item_stats::new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 250, 40, 0, 0, 0, 0);
  assert_eq!(item_stats::critical_chance(&value), 250);
  assert_eq!(item_stats::critical_outcomes(&value), 40);
  let ceiling = item_stats::uniform(100);
  let clamped = item_stats::clamp_to(&value, &ceiling);
  assert_eq!(item_stats::critical_chance(&clamped), 100); // 250 > 100 → min_u16 false-branch pins down
  assert_eq!(item_stats::critical_outcomes(&clamped), 40); // 40 < 100 → min_u16 true-branch keeps it
}

// ╔════════════════ [ Raw codec: centered block ⇄ de-centered magnitudes (malus preserved) ] ═ ]

#[test]
/// `to_raw` de-centers a stat block to raw magnitudes (a below-centre MALUS field crushes to 0), `zero_raw` is the
/// all-zero 17-vector (statless / rangeless → EXOTIC), and `is_malus` flags a below-centre field by catalog id.
fun stats_to_raw_zero_and_is_malus() {
  let s = item_stats::shift(); // 32768 centre
  // vitality +50 (bonus), wisdom at centre, strength −10 (malus); every other field at centre.
  let block = item_stats::new(s + 50, s, s - 10, s, s, s, s, s, s, s, s, s, s, s, s, s, s);

  let raw = item_stats::to_raw(&block);
  assert_eq!(raw.length(), 17);
  assert_eq!(*raw.borrow(0), 50); // vitality de-centered to its magnitude
  assert_eq!(*raw.borrow(1), 0); // wisdom at centre → 0
  assert_eq!(*raw.borrow(2), 0); // strength below centre (malus) → crushed to 0

  let z = item_stats::zero_raw();
  assert_eq!(z.length(), 17);
  assert_eq!(*z.borrow(0), 0);
  assert_eq!(*z.borrow(16), 0);

  assert!(item_stats::is_malus(&block, 2)); // strength (catalog id 2) is below centre
  assert!(!item_stats::is_malus(&block, 0)); // vitality is a bonus
  assert!(!item_stats::is_malus(&block, 1)); // wisdom at centre — not a malus
}

#[test]
/// `from_raw` re-centers a raw vector to a stat block, PRESERVING malus fields: a raw 0 whose ORIGINAL sat below
/// centre keeps the original (the forge reducer never zeroes a malus), while a nonzero raw re-centers to
/// centre+value. Round-trips `to_raw` exactly for a block whose non-malus fields sit at/above centre.
fun stats_from_raw_preserves_malus_and_round_trips() {
  let s = item_stats::shift();
  let orig = item_stats::new(s + 50, s, s - 10, s, s, s, s, s, s, s, s, s, s, s, s, s, s);

  // round-trip: from_raw(orig, to_raw(orig)) == orig (bonus kept, centre kept, malus PRESERVED via the raw-0 rule).
  let back = item_stats::from_raw(&orig, &item_stats::to_raw(&orig));
  assert_eq!(item_stats::vitality(&back), s + 50); // bonus survives
  assert_eq!(item_stats::wisdom(&back), s); // centre survives
  assert_eq!(item_stats::strength(&back), s - 10); // malus PRESERVED (raw 0 + orig below centre → keep orig)

  // a NONZERO raw re-centers even a formerly-malus field to centre+value (the forge lifted it above centre).
  let lifted = item_stats::from_raw(&orig, &vector<u64>[0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert_eq!(item_stats::strength(&lifted), s + 7); // strength raw 7 → centre+7 (overrides the malus)
  assert_eq!(item_stats::vitality(&lifted), s); // vitality raw 0, orig ≥ centre → back to centre
}

// ╔════════════════ [ Level gate (z37 boundary cases) ] ═════════ ]

#[test]
fun assert_usable_by_at_and_above_level_passes() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Boots".to_string(), b"".to_string(), b"boots".to_string(), b"boots".to_string(), 30, sc.ctx());
  item::z37(&tmpl, 30); // exactly the required level — OK
  item::z37(&tmpl, 31); // above — OK
  item::z37(&tmpl, 200); // well above — OK
  item::share_template(tmpl);
  sc.end();
}

#[test, expected_failure(abort_code = ELevelTooLow, location = item)]
fun assert_usable_by_below_level_aborts() {
  let mut sc = ts::begin(OWNER);
  let tmpl = item::new_template(b"Boots".to_string(), b"".to_string(), b"boots".to_string(), b"boots".to_string(), 30, sc.ctx());
  item::z37(&tmpl, 29); // one under → ELevelTooLow
  abort
}

#[test]
/// 2026-07-12 rider: per-template flavor text — the template CARRIES it and every mint COPIES it onto the item
/// (Display interpolates `{description}` off the object's own field; keys unchanged).
fun description_carries_and_copies_on_mint() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  test_world::whitelist(&mut sc, b"sword");
  let tid = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  sc.next_tx(OWNER);
  {
    let tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, tid);
    assert!(item::template_description(&tmpl) == b"A test artifact of the harness.".to_string()); // the template carries it
    ts::return_shared(tmpl);
  };
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, tid);
  sc.next_tx(OWNER);
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let g: &Item = k.borrow(personal_kiosk::borrow(&pkcap), gear);
    assert!(item::description(g) == b"A test artifact of the harness.".to_string()); // the mint copied it
    ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  sc.end();
}
