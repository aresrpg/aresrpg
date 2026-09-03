// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CRAFTING — living recipes + bounded aggregate crafting (reference formulas ported
/// verbatim from the legacy Move port's citations, CraftingFormulas.java):
///   ① KNOWLEDGE GATE — `required_level` DERIVES from the ingredient-slot count
///     (2 slots at level 1, then 3/4/5/6/7/8 at 10/20/40/60/80/100), never authored by
///     hand — a recipe can never under-gate itself or exceed Retro's eight-slot maximum.
///   ② SUCCESS — `min(9900, 5000 + (level−1)×50)` bp: 50% at job level 1, +0.5%/level,
///     capped 99%. A batch sums exact odds, then two fixed draws round and add bounded variance.
///   ③ FAILURE — the ingredients STILL burn; only the output is withheld. Deterministic
///     refusals (wrong output, unknown/short/redundant ingredient, under-level) abort the
///     WHOLE tx BEFORE the roll — a wrong client never reaches the dice.
///   ④ JOB XP — credited on EVERY attempt: XP derives from distinct ingredient slots. A
///     recipe four or more slots below the crafter's current capacity grants no XP.
///   ⑤ BATCHING — deterministic validation, ingredient burns, XP, event, and output stack
///     aggregate once. One attempt keeps Bernoulli variance; larger batches approximate it.
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
use aresrpg_math::{craft_batch, job_xp};
use sui::{
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

// ╔════════════════ [ The craft door ] ═══════════════════════════════════════ ]

/// Complete receipt witness for the submitted batch and its aggregate outcome.
public struct Crafted has copy, drop {
  recipe: ID,
  character: ID,
  crafter: address,
  output_template: ID,
  attempts: u16,
  successes: u16,
  job_xp_gained: u64,
}

/// Craft a bounded batch for the signer. Deterministic refusals and the whole aggregate burn
/// plan resolve before the draw. Pure level-band math preserves sequential odds and XP floors,
/// then commits one XP write and the minimum number of output objects.
public(package) fun craft(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  existing: Option<ID>, // the crafter's held stack of the output — the mint merges in
  attempts: u16,
  protected_item: &AresRPG_TransferPolicy<Item>,
  item_policy: &TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let data = recipe_rows::active_data(recipe);
  let output_id = object::id(output_template);
  // the job that gates and earns is DERIVED from the output's category (owner 2026-08-11: a
  // sword is FORGER, hardcoded, never seed-authored) — falling back to the recipe's
  // authored job only where the category can't name one (consumables: alchemist vs baker).
  let category = item_rows::template_category(output_template);
  let (job, stackable, n) = craft_batch::shape(
    data, output_id, &category, attempts, input_item_ids.length(),
  );

  let current_xp = {
    let character: &Character = kiosk.borrow(cap, character_id);
    progression::job_xp_of(character, job)
  };
  craft_batch::assert_level(data, current_xp); // ①

  let (target_template, target_amount, target_listed, target_is_input) = if (existing.is_some()) {
    let target_id = *existing.borrow();
    let target: &Item = kiosk.borrow(cap, target_id);
    (
      option::some(item::template(target)),
      item::amount(target) as u64,
      kiosk.is_listed(target_id),
      input_item_ids.contains(&target_id),
    )
  } else {
    (option::none(), 0, false, false)
  };
  craft_batch::assert_output_target(
    stackable,
    attempts,
    output_id,
    target_template,
    target_amount,
    target_listed,
    target_is_input,
  );

  // ③ AGGREGATE CONSUMPTION — one ordered stack per recipe ingredient, the no-dust law.
  // Every burn and deterministic abort precedes the first roll; Move atomicity restores
  // earlier burns if a later ingredient proves the batch incomplete.
  let mut i = 0;
  while (i < n) {
    let id = input_item_ids[i];
    let (template, held) = {
      let stack: &Item = kiosk.borrow(cap, id);
      (item::template(stack), item::amount(stack) as u64)
    };
    let need = craft_batch::input_quantity(data, i, template, attempts, held);
    item::burn(kiosk, cap, protected_item, id, need, ctx);
    i = i + 1;
  };
  // ② + ④: one fractional draw + one symmetric variance draw over aggregate level-band math.
  let rounding_roll = generator.generate_u16_in_range(0, 9999);
  let variance_roll = generator.generate_u16_in_range(0, 9999);
  let (successes, gained_xp) = craft_batch::resolve(
    n, current_xp, attempts, rounding_roll, variance_roll,
  );

  // ⑤ Stackables collapse successes into one object; unique recipes stay one attempt.
  if (successes > 0) {
    let minted = item::mint(output_template, successes as u32, generator, ctx);
    item::deposit(kiosk, cap, item_policy, existing, minted);
  };

  {
    let character: &mut Character = kiosk.borrow_mut(cap, character_id);
    progression::bank_job_xp(character, job, gained_xp);
  };
  event::emit(Crafted {
    recipe: object::id(recipe),
    character: character_id,
    crafter: ctx.sender(),
    output_template: output_id,
    attempts,
    successes,
    job_xp_gained: gained_xp,
  });
}

#[test_only]
public fun test_craft_xp_for(n: u64): u64 { job_xp::craft_xp(n) }

#[test_only]
public fun event_for_testing(
  crafted: &Crafted,
  recipe: ID,
  character: ID,
  output_template: ID,
  crafter: address,
): vector<u64> {
  vector[
    if (crafted.recipe == recipe) 1 else 0,
    if (crafted.character == character) 1 else 0,
    if (crafted.output_template == output_template) 1 else 0,
    if (crafted.crafter == crafter) 1 else 0,
    crafted.attempts as u64,
    crafted.successes as u64,
    crafted.job_xp_gained,
  ]
}
