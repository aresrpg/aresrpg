// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// COMMISSION tests: the artisan-commission crafting flow (customer brings the
/// RESOURCES + optional payment, artisan brings the KNOWLEDGE; the craft ROLLS the reference-corpus
/// success chance at the ARTISAN's level). Proves the 3-tx choreography end-to-end — request (customer) → accept (a
/// QUALIFIED artisan; records the proven level + character) → execute (customer crafts on their OWN kiosk; output
/// lands LOCKED in the customer's kiosk ON SUCCESS; escrow releases to the artisan REGARDLESS — the qualified attempt
/// is the paid service; the artisan's craft XP arrives as a `CraftXpVoucher` they redeem with their OWN cap) — plus
/// the adversary matrix: non-artisan accept, under-level accept (the KNOWLEDGE teeth — `required_level` is now
/// DERIVED from the ingredient-slot count, so the test recipe carries 3 slots → level 14), wrong-recipe accept,
/// execute-without-accept, non-customer execute, non-party cancel, the 0.1 SUI payment floor (exact-min pass +
/// sub-floor abort), and payment conservation on
/// both exit paths. Both roll BRANCHES are driven deterministically via `execute_forced` (the live `&Random` entry is
/// the same gate+body). DOUBLE-EXECUTE / execute-after-cancel are impossible BY CONSTRUCTION (both `execute` and
/// `cancel` consume the shared `CraftRequest` by value), so there is no runtime branch to test.
#[test_only]
module aresrpg::commission_tests;

use aresrpg::{
  admin::AdminCap,
  character_link,
  commission::{Self, CraftRequest, CraftXpVoucher},
  config::GameConfig,
  crafting::{Self, Recipe},
  extension,
  extract::ItemExtractPolicy,
  item::{Self, Item, ItemTemplate},
  test_world,
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  coin::{Self, Coin},
  kiosk::Kiosk,
  random::{Self, Random},
  sui::SUI,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const ARTISAN: address = @0xAA;
const CUSTOMER: address = @0xCC;
const PRICE: u64 = 1_000_000_000; // the escrow the customer picks (1 SUI — clears the 0.1 floor)
const MIN_PAYMENT: u64 = 100_000_000; // the 0.1 SUI commission floor (mirrors commission::MIN_PAYMENT_MIST)
const JOB: u8 = 0; // the recipe's required job (0 = FARMER)
const CRAFT_XP: u64 = 10; // the authored per-craft job XP baked on the test recipe
const ARTISAN_XP_BANK: u64 = 1000; // banked job xp → level 7 (curve: L7=905 ≤ 1000 < L8=1199)
// The artisan's owed craft XP at level 7 on a 1-input recipe: craft_xp_gain(10, 1, 7) = 10×(31−7)/(31−1) = 8
// (recipe_level 1, decay_start 1, zero_at 31 — the reference corpus's recipeLevelMultiplier).
const EXPECTED_VOUCHER_XP: u64 = 8;

// ── mirrored error values (module-local; `location` disambiguates the aborting module) ──
const EWrongArtisan: u64 = 101; // commission::accept
const EUnderLevel: u64 = 102; // commission::accept
const EAlreadyAccepted: u64 = 107; // commission::accept — the re-accept latch (money-hat P2)
const EAmountTooLow: u64 = 108; // commission::request — the escrowed payment is below the 0.1 SUI floor
const EWrongRecipe: u64 = 103; // commission::accept / execute
const ENotAccepted: u64 = 104; // commission::execute
const EWrongCustomer: u64 = 105; // commission::execute
const ENotParty: u64 = 106; // commission::cancel

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot + two characters (customer, artisan), each in their OWN shared personal kiosk. Kiosk ids are captured right
/// after each mint (two kiosks make bare `take_shared<Kiosk>` ambiguous). Returns (customer_kid, artisan_cid, artisan_kid).
fun boot_two(sc: &mut Scenario): (ID, ID, ID) {
  test_world::boot(sc);
  test_world::mint_character(sc, CUSTOMER);
  sc.next_tx(CUSTOMER);
  let customer_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  let artisan_cid = test_world::mint_character(sc, ARTISAN);
  sc.next_tx(ARTISAN);
  let artisan_kid = ts::most_recent_id_shared<Kiosk>().destroy_some();
  (customer_kid, artisan_cid, artisan_kid)
}

/// Boot + templates + a wheat×1→bread recipe (job JOB; 1 ingredient slot → DERIVED required_level 1, so any accept
/// passes the knowledge gate unless a test builds a bigger recipe) + ONE wheat locked in the customer's kiosk.
/// Returns (customer_kid, artisan_cid, artisan_kid, recipe_id, wheat_id, bread_tid).
fun stage(sc: &mut Scenario): (ID, ID, ID, ID, ID, ID) {
  let (customer_kid, artisan_cid, artisan_kid) = boot_two(sc);
  let wheat = test_world::make_template(sc, b"Wheat", b"wheat", b"resource", 1);
  let bread = test_world::make_template(sc, b"Bread", b"bread", b"resource", 1);
  let recipe = make_recipe(sc, vector[wheat], vector[1], bread);
  let wheat_id = mint_ingredient(sc, CUSTOMER, customer_kid, wheat, 1);
  (customer_kid, artisan_cid, artisan_kid, recipe, wheat_id, bread)
}

/// Author + share an `inputs → output×1` recipe (`required_level` is DERIVED from the slot count; craft_xp CRAFT_XP);
/// return its id.
fun make_recipe(sc: &mut Scenario, inputs: vector<ID>, quantities: vector<u64>, output_tid: ID): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  crafting::create_recipe(&cap, &ver, inputs, quantities, output_tid, 1, JOB, CRAFT_XP, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.next_tx(test_world::owner());
  ts::most_recent_id_shared<Recipe>().destroy_some()
}

/// Bank `xp` job experience for JOB on `who`'s character `cid` in their kiosk `kid` (levels an artisan up to qualify).
fun bank_xp(sc: &mut Scenario, who: address, kid: ID, cid: ID, xp: u64) {
  sc.next_tx(who);
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::add_job_xp(chr, JOB, xp, &ver);
  };
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(ver);
}

/// Read `who`'s character `cid` job xp (kiosk `kid`).
fun job_xp_of(sc: &mut Scenario, who: address, kid: ID, cid: ID): u64 {
  sc.next_tx(who);
  let k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let xp = character_link::job_xp(k.borrow(personal_kiosk::borrow(&pkcap), cid), JOB);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  xp
}

/// Mint a `qty` stack of `tid` and LOCK it into `who`'s kiosk `kid`; return the item id (the customer's ingredient).
fun mint_ingredient(sc: &mut Scenario, who: address, kid: ID, tid: ID, qty: u64): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::z20(&tmpl, qty, &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl);
  ts::return_shared(ver);
  ts::return_shared(mkt);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  iid
}

/// The customer opens a request escrowing `amount` (0 → a zero coin) toward ARTISAN for `recipe_id`; return the id.
fun open_request(sc: &mut Scenario, recipe_id: ID, amount: u64): ID {
  sc.next_tx(CUSTOMER);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let pay = if (amount > 0) coin::mint_for_testing<SUI>(amount, sc.ctx()) else coin::zero<SUI>(sc.ctx());
  commission::request(ARTISAN, recipe_id, pay, &cfg, &ver, sc.ctx());
  ts::return_shared(cfg);
  ts::return_shared(ver);
  sc.next_tx(CUSTOMER);
  ts::most_recent_id_shared<CraftRequest>().destroy_some()
}

/// The qualified artisan `who` accepts `req_id` for `recipe_id`, proving level from their character `cid` in `kid`.
fun do_accept(sc: &mut Scenario, who: address, req_id: ID, recipe_id: ID, kid: ID, cid: ID) {
  sc.next_tx(who);
  let mut req = ts::take_shared_by_id<CraftRequest>(sc, req_id);
  let recipe = ts::take_shared_by_id<Recipe>(sc, recipe_id);
  let k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  commission::accept(&mut req, &recipe, &k, &pkcap, cid, &cfg, &ver, sc.ctx());
  ts::return_shared(req);
  ts::return_shared(recipe);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

/// The customer executes `req_id` with an INJECTED roll outcome (`execute_forced` — the live `&Random` entry shares
/// the exact gate+body): craft on their kiosk `c_kid` from `input_ids`, minting `output_tid` on success, pay artisan.
fun do_execute(sc: &mut Scenario, req_id: ID, recipe_id: ID, c_kid: ID, input_ids: vector<ID>, output_tid: ID, success: bool) {
  sc.next_tx(CUSTOMER);
  let req = ts::take_shared_by_id<CraftRequest>(sc, req_id);
  let recipe = ts::take_shared_by_id<Recipe>(sc, recipe_id);
  let mut k = ts::take_shared_by_id<Kiosk>(sc, c_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, output_tid);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  commission::execute_forced(req, &recipe, &mut k, &pkcap, input_ids, &out_tmpl, success, &xpolicy, &policy, &cfg, &ver, sc.ctx());
  ts::return_shared(recipe);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(out_tmpl);
  ts::return_shared(xpolicy);
  ts::return_shared(policy);
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

// ╔════════════════ [ Happy paths ] ══════════════════════════════════════════ ]

#[test]
/// The full choreography, roll SUCCESS: a qualified artisan accepts, the customer executes — the ingredient is
/// consumed, the output mints LOCKED into the customer's kiosk, and the artisan is paid EXACTLY the escrow.
fun happy_path_delivers_and_pays() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);

  let req = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_execute(&mut sc, req, recipe, c_kid, vector[wheat_id], bread, true);

  sc.next_tx(CUSTOMER);
  let ck = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  assert!(!ck.has_item(wheat_id)); // the customer's ingredient was consumed by the craft
  assert!(ck.item_count() == 2); // character + the minted bread — the output DID land (success branch)
  ts::return_shared(ck);
  sc.next_tx(ARTISAN);
  let paid = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(paid), PRICE - commission::platform_cut_of(PRICE)); // artisan NETS 90% (10% platform cut)
  sc.next_tx(@treasury);
  let cut = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(cut), commission::platform_cut_of(PRICE)); // the 10% cut routed to @treasury (money conserved)
  sc.end();
}

#[test]
/// Roll FAILURE (the money branch): the ingredients STILL burn, NO output mints — and the artisan STILL keeps the
/// escrow (the qualified attempt is the paid service; the customer accepted the RNG).
fun failed_roll_burns_ingredients_no_output_artisan_keeps_escrow() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);

  let req = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_execute(&mut sc, req, recipe, c_kid, vector[wheat_id], bread, false); // rolled FAILURE

  sc.next_tx(CUSTOMER);
  let ck = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  assert!(!ck.has_item(wheat_id)); // ingredients burned on the failed roll (matches the reference corpus's semantics)
  assert!(ck.item_count() == 1); // ONLY the character — NO bread minted
  ts::return_shared(ck);
  sc.next_tx(ARTISAN);
  let paid = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(paid), PRICE - commission::platform_cut_of(PRICE)); // artisan keeps the NET escrow on failure (10% cut still taken)
  sc.end();
}

#[test]
/// ARTISAN XP: execute mints a `CraftXpVoucher` (success OR failure — here failure), and the artisan redeems it with
/// their OWN cap — their job xp grows by the recipe-level-decayed craft XP computed at THEIR level.
fun artisan_redeems_craft_xp_voucher() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK); // level 7

  let req = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_execute(&mut sc, req, recipe, c_kid, vector[wheat_id], bread, false); // XP flows on FAILURE too

  sc.next_tx(ARTISAN);
  let voucher = sc.take_from_sender<CraftXpVoucher>();
  let mut ak = ts::take_shared_by_id<Kiosk>(&sc, a_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  commission::redeem_craft_xp(voucher, &mut ak, &pkcap, &ver, sc.ctx());
  ts::return_shared(ak);
  sc.return_to_sender(pkcap);
  ts::return_shared(ver);

  assert_eq!(job_xp_of(&mut sc, ARTISAN, a_kid, a_cid), ARTISAN_XP_BANK + EXPECTED_VOUCHER_XP);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongArtisan, location = aresrpg::commission)]
/// The redeem sender-guard: even HOLDING a voucher, a non-artisan cannot bank its XP. The voucher is soulbound
/// (key-only) so it can never actually reach a wrong sender in production — a test-only mint routes one to the
/// CUSTOMER to prove the belt-and-suspenders `EWrongArtisan` guard fires first (before any character borrow).
fun redeem_by_wrong_artisan_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, _a_kid, _recipe, _wheat_id, _bread) = stage(&mut sc);
  // a voucher NAMING the artisan but handed to the CUSTOMER (the wrong party)
  sc.next_tx(test_world::owner());
  commission::mint_voucher_for_testing(ARTISAN, a_cid, JOB, EXPECTED_VOUCHER_XP, CUSTOMER, sc.ctx());

  sc.next_tx(CUSTOMER);
  let voucher = sc.take_from_sender<CraftXpVoucher>();
  let mut ck = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  commission::redeem_craft_xp(voucher, &mut ck, &pkcap, &ver, sc.ctx()); // sender=CUSTOMER != ARTISAN → EWrongArtisan
  ts::return_shared(ck);
  sc.return_to_sender(pkcap);
  ts::return_shared(ver);
  abort
}

#[test]
/// Payment FLOOR: a request at EXACTLY the 0.1 SUI minimum is accepted and the full
/// choreography delivers — the artisan is paid EXACTLY the floor (the boundary that must PASS).
fun min_payment_exactly_works() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);

  let req = open_request(&mut sc, recipe, MIN_PAYMENT); // EXACTLY 0.1 SUI — the floor
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_execute(&mut sc, req, recipe, c_kid, vector[wheat_id], bread, true);

  sc.next_tx(CUSTOMER);
  let ck = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  assert!(!ck.has_item(wheat_id)); // crafted at the minimum payment
  ts::return_shared(ck);
  sc.next_tx(ARTISAN);
  let paid = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(paid), MIN_PAYMENT - commission::platform_cut_of(MIN_PAYMENT)); // artisan nets the floor minus the 10% cut
  sc.end();
}

#[test, expected_failure(abort_code = EAmountTooLow, location = aresrpg::commission)]
/// The 0.1 SUI floor has teeth: a request ONE MIST below the minimum aborts at the create door — no sub-floor
/// commission can ever be opened (the client clamps to match; this is the on-chain guarantee).
fun below_min_payment_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, _a_cid, _a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  open_request(&mut sc, recipe, MIN_PAYMENT - 1); // one MIST under 0.1 SUI → EAmountTooLow
  abort
}

#[test]
/// Cancel before any accept refunds the customer's own escrow in full.
fun cancel_refunds_customer() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let req_id = open_request(&mut sc, object::id_from_address(@0xADD), PRICE);

  sc.next_tx(CUSTOMER);
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  commission::cancel(req, sc.ctx());

  sc.next_tx(CUSTOMER);
  let refund = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(refund), PRICE); // whole escrow back to the customer
  sc.end();
}

#[test]
/// The artisan may DECLINE post-accept — cancel still refunds the CUSTOMER (never the artisan), funds can't strand.
fun artisan_cancel_refunds_customer() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, a_cid, a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);

  let req_id = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req_id, recipe, a_kid, a_cid);

  sc.next_tx(ARTISAN); // the artisan declines AFTER accepting
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  commission::cancel(req, sc.ctx());

  sc.next_tx(CUSTOMER);
  let refund = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(refund), PRICE); // refund goes to the CUSTOMER, not the declining artisan
  sc.end();
}

// ╔════════════════ [ Adversarial matrix ] ═══════════════════════════════════ ]

#[test, expected_failure(abort_code = EWrongArtisan, location = aresrpg::commission)]
/// Only the NAMED artisan may accept — a stranger (here the customer) cannot flip acceptance on their own request.
fun accept_by_non_artisan_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, _a_cid, _a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  let req = open_request(&mut sc, recipe, PRICE);
  // The customer tries to accept their OWN request (their kiosk/cap/character) — sender != request.artisan.
  do_accept(&mut sc, CUSTOMER, req, recipe, c_kid, _a_cid);
  abort
}

#[test, expected_failure(abort_code = EAlreadyAccepted, location = aresrpg::commission)]
/// The re-accept LATCH (money-hat P2): once accepted, the proven level/character can never be swapped — a second
/// accept (even by the same artisan, same character) aborts, so the customer's paid odds are immutable post-accept.
fun accept_twice_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, a_cid, a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  let req = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  abort
}

#[test, expected_failure(abort_code = EUnderLevel, location = aresrpg::commission)]
/// The KNOWLEDGE teeth: `required_level` is DERIVED from the slot count — a 3-ingredient recipe unlocks at job level
/// 14 (`min_level_for_ingredients(3)`), so an unbanked (level-1) artisan cannot accept it.
fun accept_under_level_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, a_cid, a_kid, _recipe, _wheat_id, _bread) = stage(&mut sc); // artisan NOT banked → level 1
  let t1 = test_world::make_template(&mut sc, b"Ore", b"ore", b"resource", 1);
  let t2 = test_world::make_template(&mut sc, b"Coal", b"coal", b"resource", 1);
  let t3 = test_world::make_template(&mut sc, b"Flux", b"flux", b"resource", 1);
  let out = test_world::make_template(&mut sc, b"Bar", b"bar", b"resource", 1);
  let big = make_recipe(&mut sc, vector[t1, t2, t3], vector[1, 1, 1], out); // 3 slots → level 14

  let req = open_request(&mut sc, big, PRICE);
  do_accept(&mut sc, ARTISAN, req, big, a_kid, a_cid);
  abort
}

#[test, expected_failure(abort_code = EWrongRecipe, location = aresrpg::commission)]
/// The request binds a recipe — accepting against a DIFFERENT recipe than requested is refused (no bait-and-switch).
fun accept_wrong_recipe_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, a_cid, a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);
  // a SECOND, unrelated recipe the artisan will wrongly present
  let other = test_world::make_template(&mut sc, b"Ore", b"ore", b"resource", 1);
  let other_out = test_world::make_template(&mut sc, b"Bar", b"bar", b"resource", 1);
  let other_recipe = make_recipe(&mut sc, vector[other], vector[1], other_out);

  let req = open_request(&mut sc, recipe, PRICE); // bound to `recipe`
  do_accept(&mut sc, ARTISAN, req, other_recipe, a_kid, a_cid); // presents `other_recipe`
  abort
}

#[test, expected_failure(abort_code = ENotAccepted, location = aresrpg::commission)]
/// Execute requires a prior accept — a customer cannot self-serve the craft + drain the escrow before an artisan signs.
fun execute_without_accept_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, _a_cid, _a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  let req = open_request(&mut sc, recipe, PRICE); // NO accept
  do_execute(&mut sc, req, recipe, c_kid, vector[wheat_id], bread, true);
  abort
}

#[test, expected_failure(abort_code = EWrongRecipe, location = aresrpg::commission)]
/// Execute is bound to the request's recipe at BOTH ends — presenting a DIFFERENT recipe at execute (after a
/// legit accept) is refused (`execute_gate`'s EWrongRecipe), so no post-accept swap can redirect the craft.
fun execute_wrong_recipe_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);
  // a SECOND, unrelated recipe the customer will wrongly present at execute
  let other_in = test_world::make_template(&mut sc, b"Ore", b"ore", b"resource", 1);
  let other_out = test_world::make_template(&mut sc, b"Bar", b"bar", b"resource", 1);
  let other_recipe = make_recipe(&mut sc, vector[other_in], vector[1], other_out);

  let req = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req, recipe, a_kid, a_cid);
  do_execute(&mut sc, req, other_recipe, c_kid, vector[wheat_id], bread, true); // WRONG recipe at execute
  abort
}

#[test, expected_failure(abort_code = EWrongCustomer, location = aresrpg::commission)]
/// Only the customer may execute — the artisan (or anyone) cannot force-execute on the customer's kiosk.
fun execute_by_non_customer_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);
  let req_id = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req_id, recipe, a_kid, a_cid);

  sc.next_tx(ARTISAN); // NOT the customer
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  let rec = ts::take_shared_by_id<Recipe>(&sc, recipe);
  let mut k = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, bread);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  commission::execute_forced(req, &rec, &mut k, &pkcap, vector[wheat_id], &out_tmpl, true, &xpolicy, &policy, &cfg, &ver, sc.ctx());
  let _ = a_cid;
  abort
}

#[test, expected_failure(abort_code = ENotParty, location = aresrpg::commission)]
/// Cancel is party-gated — a stranger (neither customer nor artisan) cannot pull the refund.
fun cancel_by_non_party_aborts() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let req_id = open_request(&mut sc, object::id_from_address(@0xADD), PRICE);

  sc.next_tx(@0xBEEF); // a third party
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  commission::cancel(req, sc.ctx());
  abort
}

// ╔════════════════ [ Getters + the real &Random execute entry ] ═════════════ ]

#[test]
/// The FREE-read getters the RPC/SDK project off a `CraftRequest`: a fresh request reflects its customer / artisan
/// / bound recipe / escrow amount and is NOT yet accepted; a qualified accept flips `accepted` true while the
/// escrow stays held.
fun request_getters_reflect_state() {
  let mut sc = ts::begin(test_world::owner());
  let (_c_kid, a_cid, a_kid, recipe, _wheat_id, _bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);
  let req_id = open_request(&mut sc, recipe, PRICE);

  sc.next_tx(CUSTOMER);
  {
    let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
    assert_eq!(commission::customer(&req), CUSTOMER);
    assert_eq!(commission::artisan(&req), ARTISAN);
    assert_eq!(commission::recipe(&req), recipe);
    assert_eq!(commission::amount(&req), PRICE);
    assert!(!commission::accepted(&req)); // fresh — no artisan has accepted yet
    ts::return_shared(req);
  };

  do_accept(&mut sc, ARTISAN, req_id, recipe, a_kid, a_cid);
  sc.next_tx(CUSTOMER);
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  assert!(commission::accepted(&req)); // flipped by the qualified accept
  assert_eq!(commission::amount(&req), PRICE); // escrow still held pre-execute
  ts::return_shared(req);
  sc.end();
}

#[test]
/// The REAL `&Random` `execute` entry (the `execute_forced` twin shares its exact gate + body): a qualified artisan
/// accepts, then the customer executes through the LIVE entry off a seeded framework Random. The ingredient burns
/// and the escrow releases to the artisan REGARDLESS of the roll (the mint is roll-dependent — branch-proven above
/// via `execute_forced`, so only the roll-independent invariants are asserted here).
fun execute_random_entry_consumes_and_pays() {
  let mut sc = ts::begin(test_world::owner());
  let (c_kid, a_cid, a_kid, recipe, wheat_id, bread) = stage(&mut sc);
  bank_xp(&mut sc, ARTISAN, a_kid, a_cid, ARTISAN_XP_BANK);

  let req_id = open_request(&mut sc, recipe, PRICE);
  do_accept(&mut sc, ARTISAN, req_id, recipe, a_kid, a_cid);

  // seed a framework Random (create + first-round update as @0x0)
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0404040404040404040404040404040404040404040404040404040404040404", sc.ctx());
  ts::return_shared(r);

  sc.next_tx(CUSTOMER);
  let req = ts::take_shared_by_id<CraftRequest>(&sc, req_id);
  let rec = ts::take_shared_by_id<Recipe>(&sc, recipe);
  let mut k = ts::take_shared_by_id<Kiosk>(&sc, c_kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, bread);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let rr = sc.take_shared<Random>();
  commission::execute(req, &rec, &mut k, &pkcap, vector[wheat_id], &out_tmpl, &xpolicy, &policy, &cfg, &ver, &rr, sc.ctx());
  assert!(!k.has_item(wheat_id)); // the ingredient burns regardless of the roll
  ts::return_shared(rec);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(out_tmpl);
  ts::return_shared(xpolicy);
  ts::return_shared(policy);
  ts::return_shared(cfg);
  ts::return_shared(ver);
  ts::return_shared(rr);
  let _ = a_cid;

  sc.next_tx(ARTISAN);
  let paid = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::burn_for_testing(paid), PRICE - commission::platform_cut_of(PRICE)); // NET escrow released to the artisan regardless of the roll
  sc.end();
}
