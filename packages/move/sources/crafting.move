// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CRAFTING — living recipes + the single-transaction craft (reference formulas ported
/// verbatim from the legacy Move port's citations, CraftingFormulas.java):
///   ① KNOWLEDGE GATE — `required_level` DERIVES from the ingredient-slot count
///     (2 slots at level 1, then 3/4/5/6/7/8 at 10/20/40/60/80/100), never authored by
///     hand — a recipe can never under-gate itself or exceed Retro's eight-slot maximum.
///   ② SUCCESS — `min(9900, 5000 + (level−1)×50)` bp: 50% at job level 1, +0.5%/level,
///     capped 99%. Rolled off fresh `&Random`.
///   ③ FAILURE — the ingredients STILL burn; only the output is withheld. Deterministic
///     refusals (wrong output, unknown/short/redundant ingredient, under-level) abort the
///     WHOLE tx BEFORE the roll — a wrong client never reaches the dice.
///   ④ JOB XP — credited on EVERY attempt: XP derives from distinct ingredient slots. A
///     recipe four or more slots below the crafter's current capacity grants no XP.
///
/// A recipe lives at an address derived from its OUTPUT item type and can be rebalanced or
/// retired until the one permanent content freeze. The exact-ingredient shape is the security boundary: the
/// output is the recipe's own pinned template — nobody crafts a richer item than authored.
/// A LARGER input stack burns only what the recipe needs — the remainder never leaves the
/// kiosk (`item::burn`, the one amount-aware destroy door).
/// Commissions (craft-for-others) are CUT (owner 2026-08-10) — the artisan feature is dead.
module aresrpg::crafting;

use aresrpg_seed::{item_rows::{Self, ItemTemplate}, recipe_rows::{Self, Recipe}};
use aresrpg::{
  character::Character,
  item::{Self, Item},
  progression,
  protected_policy::AresRPG_TransferPolicy,
};
use aresrpg_math::{content_rules, job_xp, recipe_data::{Self, RecipeData}};
use std::string::String;
use sui::{
  derived_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongOutput: u64 = 2301; // craft: the passed template is not this recipe's output
const EUnknownIngredient: u64 = 2302; // craft: a consumed item's template is not in the recipe
const ERedundantInput: u64 = 2303; // craft: this ingredient is already fully supplied
const EMissingIngredient: u64 = 2304; // craft: an ingredient is missing or short
const EUnderLevel: u64 = 2305; // craft: job level below the recipe's knowledge gate (①)
const ERecipeRetired: u64 = 2306;
// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

// ╔════════════════ [ The craft door ] ═══════════════════════════════════════ ]

/// Success tells consumers whether the fixed one-item output was minted.
public struct Crafted has copy, drop {
  recipe: ID,
  crafter: address,
  output_template: ID,
  success: bool,
  job_xp_gained: u64,
}

/// Craft for the signer: gate (①), burn the exact ingredient tally (③ — deterministic
/// refusals first), roll (②), mint-on-success through the no-dust deposit, credit the job
/// xp (④, success or failure).
public(package) fun craft(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  existing: Option<ID>, // the crafter's held stack of the output — the mint merges in
  protected_item: &AresRPG_TransferPolicy<Item>,
  item_policy: &TransferPolicy<Item>,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  assert!(recipe_rows::is_active(recipe), ERecipeRetired);
  assert!(object::id(output_template) == recipe_data::output_template(recipe_rows::data(recipe)), EWrongOutput);
  // the job that gates and earns is DERIVED from the output's category (owner 2026-08-11: a
  // sword is FORGER, hardcoded, never seed-authored) — falling back to the recipe's
  // authored job only where the category can't name one (consumables: alchemist vs baker).
  let category = item_rows::template_category(output_template);
  let job = content_rules::craft_job_of(&category).destroy_with_default(recipe_data::job(recipe_rows::data(recipe)));
  let crafter_level = {
    let chr: &Character = kiosk.borrow(cap, character_id);
    progression::job_level_of(chr, job)
  };
  assert!(crafter_level >= recipe_data::required_level(recipe_rows::data(recipe)), EUnderLevel); // ①

  // ③ CONSUME — every abort in here fires BEFORE the roll. remaining[j] = units still owed.
  let n = recipe_data::input_count(recipe_rows::data(recipe));
  let mut remaining = vector[];
  let mut j = 0;
  while (j < n) {
    remaining.push_back(recipe_data::input_quantity(recipe_rows::data(recipe), j));
    j = j + 1;
  };
  let mut i = 0;
  while (i < input_item_ids.length()) {
    let id = input_item_ids[i];
    let (template, held) = {
      let stack: &Item = kiosk.borrow(cap, id);
      (item::template(stack), item::amount(stack) as u64)
    };
    let k = recipe_data::ingredient_index(recipe_rows::data(recipe), template);
    assert!(k.is_some(), EUnknownIngredient);
    let k = k.destroy_some();
    let need = remaining[k];
    assert!(need >= 1, ERedundantInput);
    // burn only what the recipe still needs — a larger stack DECREMENTS in place and its
    // remainder never leaves the kiosk (item::burn, the one amount-aware destroy door).
    let take = if (held < need) held else need;
    item::burn(kiosk, cap, protected_item, id, take as u32, ctx);
    *&mut remaining[k] = remaining[k] - take;
    i = i + 1;
  };
  let mut m = 0;
  while (m < n) {
    assert!(remaining[m] == 0, EMissingIngredient);
    m = m + 1;
  };

  // ② the roll, then settle
  let success = gen.generate_u64_in_range(0, 9999) < job_xp::craft_success_bp(crafter_level);
  if (success) {
    let minted = item::mint(output_template, 1, gen, ctx);
    item::deposit(kiosk, cap, item_policy, existing, minted);
  };

  // ④ xp on every attempt
  let gained_xp = job_xp::craft_xp_at_level(n, crafter_level);
  {
    let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
    progression::bank_job_xp(chr, job, gained_xp);
  };
  event::emit(Crafted {
    recipe: object::id(recipe),
    crafter: ctx.sender(),
    output_template: recipe_data::output_template(recipe_rows::data(recipe)),
    success,
    job_xp_gained: gained_xp,
  });
}

#[test_only]
public fun test_craft_xp_for(n: u64): u64 { job_xp::craft_xp(n) }
