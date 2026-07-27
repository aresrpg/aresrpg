// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Crafting tests: the ported craft tx — consume the crafter's kiosk-locked inputs, ROLL the success chance off the
/// crafter's job level, mint the output ON SUCCESS (locked), and credit the craft job XP either way. Adversarial-first:
/// a short / missing / wrong / over-supplied ingredient aborts in `craft_consume` BEFORE the roll (reverting the burns
/// — items are never lost), a forged output template is impossible (`EWrongOutput`), and an under-levelled crafter is
/// refused (`EUnderLevel`). Success/failure branches are driven deterministically via `craft_forced`; the ported
/// ported reference-corpus formulas are unit-proven; the real `&Random` `craft` entry is exercised end-to-end.
#[test_only]
module aresrpg::crafting_tests;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, crafting::{Self, Recipe}, extract::ItemExtractPolicy, item::{Item, ItemTemplate}, test_world, version::Version};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{kiosk::Kiosk, random::{Self, Random, RandomGenerator}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
/// The stat-roll seed the forced-craft door injects (the live entry draws it from its `&Random` generator).
const CRAFT_SEED: u64 = 0xC0FFEE;

const EWrongOutput: u64 = 101; // crafting
const EUnknownIngredient: u64 = 102; // crafting
const EIngredientOverSupply: u64 = 103; // crafting
const EMissingIngredient: u64 = 104; // crafting
const EUnderLevel: u64 = 108; // crafting

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot + a character (for its kiosk) + four stackable resource templates. Returns (cid, wheat, iron, ore, bread).
fun stage(sc: &mut Scenario): (ID, ID, ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  let wheat = test_world::make_template(sc, b"Wheat", b"wheat", b"resource", 1);
  let iron = test_world::make_template(sc, b"Iron", b"iron", b"resource", 1);
  let ore = test_world::make_template(sc, b"Ore", b"ore", b"resource", 1);
  let bread = test_world::make_template(sc, b"Bread", b"bread", b"resource", 1);
  (cid, wheat, iron, ore, bread)
}

/// Author a recipe (required_job 0 = FARMER, craft_xp 10). `required_level` is DERIVED from the ingredient-slot count
/// (`min_level_for_ingredients`) — a 2-input recipe unlocks at level 1, so a fresh (level-1) crafter qualifies.
fun make_recipe(sc: &mut Scenario, inputs: vector<ID>, quantities: vector<u64>, output: ID, output_qty: u64) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  crafting::create_recipe(&cap, &ver, inputs, quantities, output, output_qty, 0, 10, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Craft with an INJECTED outcome (deterministic branch coverage — no rng): the real gate + burn run, then `success`
/// decides mint-vs-not; XP is credited either way. `who`'s character `cid` is the crafter.
fun do_craft(sc: &mut Scenario, who: address, cid: ID, input_ids: vector<ID>, output_tid: ID, success: bool): Option<ID> {
  sc.next_tx(who);
  let recipe = sc.take_shared<Recipe>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, output_tid);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let minted = crafting::craft_forced(&recipe, &mut k, &pkcap, cid, input_ids, &out_tmpl, success, CRAFT_SEED, &xpolicy, &policy, &cfg, &ver, sc.ctx());
  ts::return_shared(recipe); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(out_tmpl); ts::return_shared(xpolicy); ts::return_shared(policy);
  ts::return_shared(cfg); ts::return_shared(ver);
  minted
}

/// Read `who`'s character `cid` job xp for `job`.
fun job_xp_of(sc: &mut Scenario, who: address, cid: ID, job: u8): u64 {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let xp = character_link::job_xp(k.borrow(personal_kiosk::borrow(&pkcap), cid), job);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  xp
}

// ╔════════════════ [ Success / failure branches ] ═══════════════════════════ ]

#[test]
/// SUCCESS: 2 wheat + 3 iron → 1 bread — the inputs are consumed, exactly one output is minted, and job XP is credited.
fun craft_success_consumes_inputs_mints_output_and_grants_xp() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i], bread, true);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  assert!(!k.has_item(w)); // both inputs consumed
  assert!(!k.has_item(i));
  assert!(k.item_count() == 2); // character + the 1 minted bread
  ts::return_shared(k);
  assert_eq!(job_xp_of(&mut sc, OWNER, cid, 0), 10); // full in-band craft_xp granted
  sc.end();
}

#[test]
/// #758 REGRESSION: a CRAFTED gear output is born with its rolled `StatsKey`. Before the fix the craft mint door
/// never rolled, so a crafted weapon's owned-stat block was blank forever while the same template bought from the
/// shop rolled fine. The roll rides the craft's OWN entropy (the live entry's `&Random` generator; the forced door
/// injects `CRAFT_SEED`), so it is fixed at mint and lands inside the authored [min,max].
fun crafted_gear_output_carries_rolled_stats() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, _bread) = stage(&mut sc);
  test_world::whitelist(&mut sc, b"weapon");
  let sword = test_world::make_ranged_gear_template(&mut sc, b"sword", b"weapon", 100, 200);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], sword, 1);

  let kid = { sc.next_tx(OWNER); let k = sc.take_shared<Kiosk>(); let id = object::id(&k); ts::return_shared(k); id };
  let minted = do_craft(&mut sc, OWNER, cid, vector[w, i], sword, true);
  assert!(minted.is_some());

  // red pre-#758: `rolled_stats` aborts on the crafted item — it never carried a StatsKey
  let v = test_world::rolled_vitality(&mut sc, OWNER, kid, *minted.borrow());
  assert!(v >= 100 && v <= 200);
  sc.end();
}

#[test]
/// FAILURE (③): a failed roll STILL burns the ingredients and STILL grants job XP — only the OUTPUT is withheld
/// (matches the reference corpus's craft-queue behavior). Nothing is minted; the tx does NOT revert.
fun craft_failure_burns_inputs_grants_xp_no_output() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i], bread, false); // rolled FAILURE

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  assert!(!k.has_item(w)); // ingredients STILL burned on failure
  assert!(!k.has_item(i));
  assert!(k.item_count() == 1); // ONLY the character — NO bread minted
  ts::return_shared(k);
  assert_eq!(job_xp_of(&mut sc, OWNER, cid, 0), 10); // XP granted on failure too
  sc.end();
}

// ╔════════════════ [ ① Knowledge-level gate ] ═══════════════════════════════ ]

#[test, expected_failure(abort_code = EUnderLevel, location = crafting)]
/// A 3-ingredient recipe unlocks at job level 14 (`min_level_for_ingredients(3)`). A fresh (level-1) crafter is
/// refused — the reference corpus's knowledge gate.
fun craft_under_level_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 1);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 1);
  let o = test_world::mint_lock_stack(&mut sc, OWNER, ore, 1);
  make_recipe(&mut sc, vector[wheat, iron, ore], vector[1, 1, 1], bread, 1); // 3 inputs → gate 14
  do_craft(&mut sc, OWNER, cid, vector[w, i, o], bread, true); // level-1 crafter < 14
  abort
}

#[test]
/// A crafter banked past the derived gate (3-input → level 14) crafts successfully.
fun craft_at_level_succeeds() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, ore, bread) = stage(&mut sc);
  test_world::bank_job_xp(&mut sc, OWNER, cid, 0, 10000); // → job level 22 ≥ 14
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 1);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 1);
  let o = test_world::mint_lock_stack(&mut sc, OWNER, ore, 1);
  make_recipe(&mut sc, vector[wheat, iron, ore], vector[1, 1, 1], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i, o], bread, true);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  assert!(k.item_count() == 2); // character + minted bread
  ts::return_shared(k);
  sc.end();
}

// ╔════════════════ [ Recipe getters ] ═══════════════════════════════════════ ]

#[test]
/// Recipe getters read straight off a shared authored recipe: input count, output quantity, output template, craft_xp,
/// and the DERIVED required_level (2 inputs → 1).
fun recipe_getters_reflect_authoring() {
  let mut sc = ts::begin(OWNER);
  let (_cid, wheat, iron, _ore, bread) = stage(&mut sc);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 4);

  sc.next_tx(OWNER);
  let recipe = sc.take_shared<Recipe>();
  assert!(crafting::input_count(&recipe) == 2);
  assert!(crafting::output_quantity(&recipe) == 4);
  assert!(crafting::output_template(&recipe) == bread);
  assert!(crafting::required_job(&recipe) == 0);
  assert!(crafting::required_level(&recipe) == 1); // derived from 2 inputs
  assert!(crafting::craft_xp(&recipe) == 10);
  ts::return_shared(recipe);
  sc.end();
}

// ╔════════════════ [ Adversarial matrix (aborts in craft_consume, BEFORE the roll) ] ═ ]

#[test, expected_failure(abort_code = EMissingIngredient, location = crafting)]
/// Short: the recipe needs 3 iron but only 2 are supplied — the tally never zeroes.
fun craft_short_input_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 2);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i], bread, true);
  abort
}

#[test, expected_failure(abort_code = EMissingIngredient, location = crafting)]
/// Missing: an entire ingredient (iron) is never supplied.
fun craft_missing_input_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w], bread, true);
  abort
}

#[test, expected_failure(abort_code = EUnknownIngredient, location = crafting)]
/// Wrong: an item whose template is not in the recipe is supplied.
fun craft_wrong_ingredient_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat], vector[2], bread, 1); // recipe: wheat only — iron is unknown
  do_craft(&mut sc, OWNER, cid, vector[i], bread, true);
  abort
}

#[test]
/// Over-supply is TOLERATED via AUTO-SPLIT: 5 iron supplied where the recipe needs 3 → the craft
/// SUCCEEDS, the original over-large stack is consumed, exactly ONE surplus remainder is re-locked, and the output mints.
fun craft_over_supply_auto_splits_and_relocks_remainder() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2); // exact
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 5); // over by 2
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i], bread, true);

  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  assert!(!k.has_item(w)); // the exact wheat stack fully consumed
  assert!(!k.has_item(i)); // the original over-large iron stack consumed (its surplus is a NEW re-locked object)
  assert!(k.item_count() == 3); // character + 1 bread + EXACTLY ONE iron remainder
  ts::return_shared(k);
  sc.end();
}

#[test, expected_failure(abort_code = EIngredientOverSupply, location = crafting)]
/// Redundant input: the recipe needs 3 iron; the first stack (3) satisfies it exactly, so a SECOND iron stack has no
/// remaining need — a redundant input that aborts (the whole tx reverts; the already-burned inputs are restored).
fun craft_redundant_ingredient_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i1 = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3); // satisfies iron exactly
  let i2 = test_world::mint_lock_stack(&mut sc, OWNER, iron, 1); // redundant — iron already fully needed
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i1, i2], bread, true);
  abort
}

#[test, expected_failure(abort_code = EWrongOutput, location = crafting)]
/// A forged (richer) output template can never be crafted — it must be the recipe's own output.
fun craft_wrong_output_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let decoy = test_world::make_template(&mut sc, b"Decoy", b"decoy", b"resource", 1);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);
  do_craft(&mut sc, OWNER, cid, vector[w, i], decoy, true);
  abort
}

// ╔════════════════ [ Ported reference-corpus formulas (pure) ] ══════════════ ]

#[test]
/// ② success_rate_bp = min(9900, 5000 + (level−1)×50): 50% at L1, +0.5%/level, capped 99% (CraftingFormulas.java:13-15).
fun success_rate_formula_matches_hytale() {
  assert_eq!(crafting::test_success_rate_bp(1), 5000); // 50%
  assert_eq!(crafting::test_success_rate_bp(2), 5050);
  assert_eq!(crafting::test_success_rate_bp(80), 8950);
  assert_eq!(crafting::test_success_rate_bp(99), 9900); // cap reached
  assert_eq!(crafting::test_success_rate_bp(100), 9900); // stays capped
}

#[test]
/// ① min_level_for_ingredients: 2→1, 3→14, 4→26, 10→100 (CraftingFormulas.java:38-42).
fun min_level_formula_matches_hytale() {
  assert_eq!(crafting::test_min_level_for_ingredients(1), 1);
  assert_eq!(crafting::test_min_level_for_ingredients(2), 1);
  assert_eq!(crafting::test_min_level_for_ingredients(3), 14);
  assert_eq!(crafting::test_min_level_for_ingredients(4), 26);
  assert_eq!(crafting::test_min_level_for_ingredients(10), 100);
}

#[test]
/// ④ craft_xp_gain = base × recipeLevelMultiplier: full in-band, linear decay to 0 over +30 (CraftingFormulas.java:60-69).
fun craft_xp_decay_matches_hytale() {
  // 2-input recipe: recipe_level=1, decay_start=14, zero_at=31.
  assert_eq!(crafting::test_craft_xp_gain(100, 2, 1), 100); // in band (≤ decay_start)
  assert_eq!(crafting::test_craft_xp_gain(100, 2, 14), 100); // at decay_start — still full
  assert_eq!(crafting::test_craft_xp_gain(100, 2, 20), 64); // decaying: 100×(31−20)/(31−14) = 64
  assert_eq!(crafting::test_craft_xp_gain(100, 2, 31), 0); // at zero_at
  assert_eq!(crafting::test_craft_xp_gain(100, 2, 50), 0); // past zero_at
}

#[test]
/// ② the roll consumes the rng and returns a bool (framework test generator — coverage of the draw path).
fun success_roll_draws() {
  let mut gen: RandomGenerator = random::new_generator_for_testing();
  let _ = crafting::test_success_roll(1, &mut gen); // 50% — either outcome is valid; proves the draw composes
  let _ = crafting::test_success_roll(100, &mut gen); // 99%
}

// ╔════════════════ [ The rng door (shares the exact body the live &Random entry wraps) ] ═ ]

#[test]
/// `craft_for_testing` (framework test rng — the live `&Random` entry is the same 3-line wrap over
/// `self_craft_body`, the gather/`gather_for_testing` precedent): the roll REALLY draws, and the ingredients are
/// consumed + XP credited REGARDLESS of its outcome (the mint is roll-dependent — branch-proven above via
/// `craft_forced`).
fun craft_rng_door_burns_and_credits_regardless_of_roll() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);

  sc.next_tx(OWNER);
  let recipe = sc.take_shared<Recipe>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, bread);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  crafting::craft_for_testing(&recipe, &mut k, &pkcap, cid, vector[w, i], &out_tmpl, &xpolicy, &policy, &cfg, &ver, sc.ctx());
  assert!(!k.has_item(w)); // ingredients consumed regardless of the roll
  assert!(!k.has_item(i));
  ts::return_shared(recipe); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(out_tmpl); ts::return_shared(xpolicy); ts::return_shared(policy);
  ts::return_shared(cfg); ts::return_shared(ver);
  assert_eq!(job_xp_of(&mut sc, OWNER, cid, 0), 10); // XP credited through the rng door
  sc.end();
}

#[test]
/// The REAL `&Random` `craft` entry (the `*_for_testing` twin shares its exact 3-line body): consumes a seeded
/// framework Random and runs the full gate → burn → roll → mint-on-success → credit-XP pipeline. Proves the entry
/// wrapper composes; the ingredients burn and job XP credits REGARDLESS of the roll (the mint is roll-dependent —
/// branch-proven above via `craft_forced`, so only the roll-independent invariants are asserted here).
fun craft_random_entry_burns_and_credits() {
  let mut sc = ts::begin(OWNER);
  let (cid, wheat, iron, _ore, bread) = stage(&mut sc);
  let w = test_world::mint_lock_stack(&mut sc, OWNER, wheat, 2);
  let i = test_world::mint_lock_stack(&mut sc, OWNER, iron, 3);
  make_recipe(&mut sc, vector[wheat, iron], vector[2, 3], bread, 1);

  // seed a framework Random (create + first-round update as @0x0)
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0404040404040404040404040404040404040404040404040404040404040404", sc.ctx());
  ts::return_shared(r);

  sc.next_tx(OWNER);
  let recipe = sc.take_shared<Recipe>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let out_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, bread);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let rr = sc.take_shared<Random>();
  crafting::craft(&recipe, &mut k, &pkcap, cid, vector[w, i], &out_tmpl, &xpolicy, &policy, &cfg, &ver, &rr, sc.ctx());
  assert!(!k.has_item(w)); // ingredients consumed regardless of the roll
  assert!(!k.has_item(i));
  ts::return_shared(recipe); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(out_tmpl); ts::return_shared(xpolicy); ts::return_shared(policy);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(rr);
  assert_eq!(job_xp_of(&mut sc, OWNER, cid, 0), 10); // XP credited through the real &Random entry
  sc.end();
}
