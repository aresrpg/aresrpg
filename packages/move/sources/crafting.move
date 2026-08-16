// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CRAFTING — frozen recipes + the single-transaction craft (reference formulas ported
/// verbatim from the legacy Move port's citations, CraftingFormulas.java):
///   ① KNOWLEDGE GATE — `required_level` DERIVES from the ingredient-slot count
///     (`n ≤ 2 → 1`, else `min(100, ceil((n−2)×99/8) + 1)`), never authored by hand — a
///     recipe can never under-gate itself.
///   ② SUCCESS — `min(9900, 5000 + (level−1)×50)` bp: 50% at job level 1, +0.5%/level,
///     capped 99%. Rolled off fresh `&Random`.
///   ③ FAILURE — the ingredients STILL burn; only the output is withheld. Deterministic
///     refusals (wrong output, unknown/short/redundant ingredient, under-level) abort the
///     WHOLE tx BEFORE the roll — a wrong client never reaches the dice.
///   ④ JOB XP — credited on EVERY attempt: XP derives from distinct ingredient slots, then
///     receives the recipe-level decay
///     (full until the next slot tier, linear to 0 over +30 once out-leveled).
///
/// A RECIPE IS FROZEN SEED CONTENT (owner 2026-08-10) — not an admin object: minted in
/// the seeding at an address derived from its OUTPUT item type, then frozen forever
/// with the rest of the corpus. The exact-ingredient shape is the security boundary: the
/// output is the recipe's own pinned template — nobody crafts a richer item than authored.
/// A LARGER input stack burns only what the recipe needs — the remainder never leaves the
/// kiosk (`item::burn`, the one amount-aware destroy door).
/// Commissions (craft-for-others) are CUT (owner 2026-08-10) — the artisan feature is dead.
module aresrpg::crafting;

use aresrpg::{
  character::Character,
  item::{Self, Item, ItemTemplate, TemplateRegistry},
  progression,
  protected_policy::AresRPG_TransferPolicy,
};
use aresrpg_math::job_xp;
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
const ELengthMismatch: u64 = 2306; // authoring: templates and quantities differ in length
const EEmptyRecipe: u64 = 2307; // authoring: a recipe with no inputs is a free mint
const EZeroQuantity: u64 = 2308; // authoring: a zero quantity is meaningless

// ② min(9900, 5000 + (level−1)×50) bp — CraftingFormulas.java:13-15.
const SUCCESS_BASE_BP: u64 = 5000;
const SUCCESS_PER_LEVEL_BP: u64 = 50;
const SUCCESS_CAP_BP: u64 = 9900;
// ④ full xp until the next slot tier, linear to 0 over +30 — CraftingFormulas.java:58-69.
const RECIPE_XP_DECAY_RANGE: u64 = 30;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Keys a recipe's derived address by its OUTPUT item type — one recipe per output, the
/// client derives it offline like every template.
public struct RecipeKey(String) has copy, drop, store;

/// One recipe input: `quantity` units of the item `template`.
public struct Ingredient has copy, drop, store {
  template: ID,
  quantity: u64,
}

/// A frozen recipe. Knowledge and XP both derive from the distinct ingredient-slot count.
/// Every successful craft mints exactly one output; neither derived fact is authored or stored.
public struct Recipe has key {
  id: UID,
  inputs: vector<Ingredient>,
  output_template: ID,
  job: String, // one of the 12 craft-job slugs — gates and earns
  required_level: u64,
}

public struct RecipeCreated has copy, drop {
  recipe: ID,
  output_template: ID,
  input_count: u64,
  job: String,
  required_level: u64,
}

/// Success tells consumers whether the fixed one-item output was minted.
public struct Crafted has copy, drop {
  recipe: ID,
  crafter: address,
  output_template: ID,
  success: bool,
  job_xp_gained: u64,
}

// ╔════════════════ [ Seeding authoring (seed.move gates, then calls) ] ══════ ]

/// Mint a recipe at its output-type-derived address. `input_templates[i]` needs
/// `input_quantities[i]` units (distinct templates by authoring convention). Key-only —
/// `freeze_recipe` is its single exit; the seal closes this door with the rest.
public(package) fun new_recipe(
  registry: &mut TemplateRegistry,
  output_type: String,
  output_template: ID,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
): Recipe {
  let inputs = zip_inputs(input_templates, input_quantities);
  let n = inputs.length();
  let recipe = Recipe {
    id: derived_object::claim(item::registry_uid_mut(registry), RecipeKey(output_type)),
    inputs,
    output_template,
    job,
    required_level: required_level_for(n), // ① derived, never mis-authored
  };
  event::emit(RecipeCreated {
    recipe: recipe.id.to_inner(),
    output_template,
    input_count: n,
    job: recipe.job,
    required_level: recipe.required_level,
  });
  recipe
}

public(package) fun freeze_recipe(recipe: Recipe) {
  transfer::freeze_object(recipe);
}

// ╔════════════════ [ The craft door ] ═══════════════════════════════════════ ]

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
  assert!(object::id(output_template) == recipe.output_template, EWrongOutput);
  // the job that gates and earns is DERIVED from the output's category (owner 2026-08-11: a
  // longsword is SWORD_SMITH, hardcoded, never seed-authored) — falling back to the recipe's
  // authored job only where the category can't name one (consumables: alchemist vs baker).
  let job = item::craft_job_of(item::template_category(output_template)).destroy_with_default(recipe.job);
  let crafter_level = {
    let chr: &Character = kiosk.borrow(cap, character_id);
    progression::job_level_of(chr, job)
  };
  assert!(crafter_level >= recipe.required_level, EUnderLevel); // ①

  // ③ CONSUME — every abort in here fires BEFORE the roll. remaining[j] = units still owed.
  let n = recipe.inputs.length();
  let mut remaining = vector[];
  let mut j = 0;
  while (j < n) {
    remaining.push_back(recipe.inputs[j].quantity);
    j = j + 1;
  };
  let mut i = 0;
  while (i < input_item_ids.length()) {
    let id = input_item_ids[i];
    let (template, held) = {
      let stack: &Item = kiosk.borrow(cap, id);
      (item::template(stack), item::amount(stack) as u64)
    };
    let k = ingredient_index(recipe, template);
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
  let success = gen.generate_u64_in_range(0, 9999) < success_bp(crafter_level);
  if (success) {
    let minted = item::mint(output_template, 1, gen, ctx);
    item::deposit(kiosk, cap, item_policy, existing, minted);
  };

  // ④ xp on every attempt
  let gained_xp = decayed_xp(craft_xp_for(n), n, crafter_level);
  {
    let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
    progression::bank_job_xp(chr, job, gained_xp);
  };
  event::emit(Crafted {
    recipe: object::id(recipe),
    crafter: ctx.sender(),
    output_template: recipe.output_template,
    success,
    job_xp_gained: gained_xp,
  });
}

// ╔════════════════ [ Internals — the ported reference formulas ] ════════════ ]

/// ② `min(9900, 5000 + (level−1)×50)` bp. Level ≥ 1 always, so no underflow.
fun success_bp(level: u64): u64 {
  let bp = SUCCESS_BASE_BP + (level - 1) * SUCCESS_PER_LEVEL_BP;
  if (bp > SUCCESS_CAP_BP) SUCCESS_CAP_BP else bp
}

/// ① Minimum job level for `n` ingredient slots: `n ≤ 2 → 1`, else
/// `min(100, ceil((n−2)×99/8) + 1)` — CraftingFormulas.java:38-42.
fun required_level_for(n: u64): u64 {
  if (n <= 2) return 1;
  let v = ((n - 2) * 99 + 7) / 8 + 1;
  if (v > job_xp::max_level()) job_xp::max_level() else v
}

/// ④ Canonical Dofus craft XP by distinct ingredient slots. Slots above eight stay capped.
fun craft_xp_for(n: u64): u64 {
  if (n <= 2) 10
  else if (n == 3) 25
  else if (n == 4) 50
  else if (n == 5) 100
  else if (n == 6) 250
  else if (n == 7) 500
  else 1000
}

#[test_only]
public fun test_craft_xp_for(n: u64): u64 { craft_xp_for(n) }

/// ④ `base_xp × recipeLevelMultiplier(n, level)`: FULL until the next slot tier, then
/// LINEAR to 0 at `recipe_level + 30` — integer-exact port.
fun decayed_xp(base_xp: u64, n: u64, crafter_level: u64): u64 {
  let recipe_level = required_level_for(n);
  let zero_at = recipe_level + RECIPE_XP_DECAY_RANGE;
  let decay_start = required_level_for(n + 1);
  if (decay_start >= zero_at) {
    if (crafter_level >= zero_at) 0 else base_xp
  } else if (crafter_level <= decay_start) base_xp
  else if (crafter_level >= zero_at) 0
  else base_xp * (zero_at - crafter_level) / (zero_at - decay_start)
}

/// The FIRST recipe slot whose template matches (authoring convention: distinct inputs).
fun ingredient_index(recipe: &Recipe, template: ID): Option<u64> {
  let mut i = 0;
  while (i < recipe.inputs.length()) {
    if (recipe.inputs[i].template == template) return option::some(i);
    i = i + 1;
  };
  option::none()
}

/// Zip + validate the authored ingredient list — the one authoring-rule home.
fun zip_inputs(templates: vector<ID>, quantities: vector<u64>): vector<Ingredient> {
  let n = templates.length();
  assert!(n == quantities.length(), ELengthMismatch);
  assert!(n > 0, EEmptyRecipe);
  let mut inputs = vector[];
  let mut i = 0;
  while (i < n) {
    let quantity = quantities[i];
    assert!(quantity >= 1, EZeroQuantity);
    inputs.push_back(Ingredient { template: templates[i], quantity });
    i = i + 1;
  };
  inputs
}
