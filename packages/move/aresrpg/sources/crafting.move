// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CRAFTING — admin-authored RECIPES + the single-transaction craft (§6/§10/§12;
/// craft is NOT deterministic — it rolls a reference-formula SUCCESS CHANCE off the
/// crafter's job level). A recipe is EXACT-INGREDIENT: a fixed list of `(input template, quantity)` folds toward a
/// fixed `(output template, quantity)` — but the fold only MINTS on a successful roll. The craft tx CONSUMES the
/// crafter's own kiosk-locked input items through the items BURN door and, ON SUCCESS, MINTS the output through the
/// cap-gated MINT door, locked into the crafter's personal kiosk — every cross-package item op flows through the ONE
/// `character_link` seam (its charter). No item ever reaches a raw address; the whole flow is one atomic tx.
///
/// THE REFERENCE CRAFT PROCESS (ported VERBATIM from the retired legacy reference server's crafting plugin —
/// replicated exactly). Four pieces, each cited to its source:
///   ① KNOWLEDGE GATE — a recipe needs job level `y92(slots)` (CraftingFormulas.java:38-42,
///      the dual of the `maxIngredients(level)` gate enforced at CraftingPage.java:255,340). The recipe's ITEM tier
///      is NOT the y16 (CraftingPage.java:252-253) — the y16 is the ingredient-slot count. `create_recipe`
///      DERIVES `required_level` from the slot count so it can never be mis-authored; `craft` refuses an
///      under-levelled crafter (`EUnderLevel`). Commission reads the SAME field (accept-time knowledge proof).
///   ② SUCCESS CHANCE — `y91(level) = min(9900, 5000 + (level−1)×50)` bp, i.e. 50% at job level 1,
///      +0.5%/level, capped 99% (CraftingFormulas.java:13-15). Rolled `< bp` over a framework `&Random` draw
///      (CraftQueue.java:197,201 `rng.nextDouble() < successRate`). ONE terminal `&Random` command (the buy_many /
///      gather law): the roll + the conditional mint compose INSIDE the entry — nothing defers to a later command.
///   ③ FAILURE SEMANTICS — on a failed roll the ingredients are STILL fully consumed (CraftQueue.java:212 burns
///      `n × quantity` for every attempt regardless of outcome) and only the OUTPUT is withheld. Deterministic
///      refusals (missing / wrong / over-supplied ingredients, under-level, forged output) still abort the WHOLE tx
///      BEFORE the roll — so a wrong client fails 100% deterministically, never only on the dice (gather's lead
///      ruling). A rolled FAILURE loses the ingredients but reverts nothing.
///   ④ JOB XP — granted on EVERY attempt, success OR failure (CraftQueue.java:209 `totalXp = xpPerCraft × n`),
///      = the recipe's authored `craft_xp` (baked in the seeds, the reference `craftXpFromIngredients` output) scaled by
///      the recipe-level decay multiplier (CraftQueue.java:192-194 × `recipeLevelMultiplier`, CraftingFormulas.java
///      :60-69) — full in-band, linear decay to 0 over the +30 window once the crafter out-levels the recipe tier.
///      The `xpRate` factor is a reference-server per-player dial — 1.0 on-chain (no per-player rate exists).
///
/// A LARGER input stack is TOLERATED: the craft AUTO-SPLITS it — consuming only the units the
/// recipe needs and re-locking the surplus remainder into the crafter's kiosk. There is NO free-standing split door
/// (no object-duplication / dust-fee surface); splitting happens ONLY inside consuming functions like this one.
///
/// PLACEMENT-BY-RESPONSIBILITY: this module owns the recipe DATA + the ingredient-match RULE + the craft roll; the
/// cap authority + the burn/mint primitives live in `character_link`. The exact-ingredient shape is the security
/// boundary — the output is the recipe's OWN `output_template` (a shared admin object; the passed template is
/// asserted to match), so a caller can never craft a richer item than the recipe authorises, and the ingredient
/// tally must land EXACT before any roll. `y18` / `y19` / `y20` / `y21` are
/// `public(package)` so `commission::execute` composes the SAME craft off a customer's kiosk at the ARTISAN's level.
module aresrpg::crafting;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, version::Version};
use aresrpg::{extract::{Self, ItemExtractPolicy}, item::{Self, Item, ItemTemplate}};
use aresrpg_foundation::job_xp;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{event, kiosk::Kiosk, random::{Self, Random, RandomGenerator}, transfer_policy::TransferPolicy, tx_context::sender};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const EWrongOutput: u64 = 101; // craft: the passed output template is not this recipe's output
const EUnknownIngredient: u64 = 102; // craft: a consumed item's template is not in the recipe
const EIngredientOverSupply: u64 = 103; // craft: a supplied stack's ingredient is already fully satisfied (redundant input); a LARGER single stack is NOT an error — it auto-splits and re-locks the remainder
const EMissingIngredient: u64 = 104; // craft: an ingredient is missing or short after all inputs were consumed
const ELengthMismatch: u64 = 105; // create_recipe: the templates and quantities vectors differ in length
const EEmptyRecipe: u64 = 106; // create_recipe: a recipe with no inputs would be a free mint
const EZeroQuantity: u64 = 107; // create_recipe: an input/output quantity of 0 is meaningless
const EUnderLevel: u64 = 108; // craft: the crafter's job level is below the recipe's required knowledge level (① knowledge gate)

// ╔════════════════ [ Success-chance / XP constants (reference CraftingFormulas.java, ported verbatim) ] ═ ]

// ② y91(level) = min(9900, 5000 + (level−1)×50): 50% at L1, +0.5%/level, capped 99% (:13-15).
const SUCCESS_BASE_BP: u64 = 5000; // 0.50 base
const SUCCESS_PER_LEVEL_BP: u64 = 50; // +0.005 per level
const SUCCESS_CAP_BP: u64 = 9900; // min(0.99, …)
// ④ recipeLevelMultiplier decay window: full XP until the next recipe tier, linear to 0 over +30 (:58,60-69).
const RECIPE_XP_DECAY_RANGE: u64 = 30;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One recipe input: `quantity` units of the item `template`. `copy + drop + store` — pure data on the recipe.
public struct Ingredient has copy, drop, store {
  template: ID,
  quantity: u64,
}

/// An admin-authored recipe. Shared (read by every craft tx); authored while the package is dark. Exact-ingredient:
/// `inputs` (each a distinct template by authoring convention) → `output_quantity` of `output_template`.
/// `required_job` is the job whose level gates + earns; `required_level` is the KNOWLEDGE threshold (§6/①) DERIVED
/// from the ingredient-slot count (`y92`) at authoring so it is always the exact reference y16
/// — `craft` refuses an under-levelled crafter and `commission::accept` proves the artisan holds it. `craft_xp` is
/// the authored per-craft job XP (④; the seeds bake it, the reference `craftXpFromIngredients`), decayed at runtime once
/// the crafter out-levels the recipe tier. ONE data home for each fact.
public struct Recipe has key {
  id: UID,
  inputs: vector<Ingredient>,
  output_template: ID,
  output_quantity: u64,
  required_job: u8,
  required_level: u64,
  craft_xp: u64,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct RecipeCreated has copy, drop { recipe: ID, output_template: ID, output_quantity: u64, input_count: u64, required_job: u8, required_level: u64, craft_xp: u64 }

/// A live recipe's ingredient list was REPLACED (`set_recipe_inputs`). Carries the re-derived `required_level`
/// because the knowledge gate MOVES with the slot count — an indexer that misses this keeps showing the old y16.
public struct RecipeInputsSet has copy, drop { recipe: ID, input_count: u64, required_level: u64 }

/// A recipe was RETIRED (`retire_recipe`) — its shared object is deleted and the id stops resolving. An indexer
/// drops the recipe from its craftable set on this event.
public struct RecipeRetired has copy, drop { recipe: ID, output_template: ID }

/// A live recipe's authored per-craft job XP was REPLACED (`set_recipe_craft_xp`). The runtime decay is derived from
/// the slot count, so this event carries the whole change — an indexer re-points its XP projection on it.
public struct RecipeCraftXpSet has copy, drop { recipe: ID, craft_xp: u64 }

/// A craft outcome. `success` — did the reference-formula roll pass (② )? `output_quantity` is the minted amount (0 on a
/// failed roll — the ingredients still burned). `job_xp_gained` is credited to the crafter regardless of `success`
/// (④). Indexer re-point: `success` + `job_xp_gained` are NEW fields on this shape.
public struct Crafted has copy, drop { recipe: ID, crafter: address, output_template: ID, output_quantity: u64, success: bool, job_xp_gained: u64 }

// ╔════════════════ [ Admin authoring (AdminCap + version gated — recipes authored while dark) ] ═ ]

/// Author + SHARE a recipe. `input_templates[i]` needs `input_quantities[i]` units; the two vectors zip 1:1
/// (`ELengthMismatch`). A recipe needs ≥1 input (`EEmptyRecipe` — else it is a free mint) and every quantity ≥1
/// (`EZeroQuantity`). Authoring convention: distinct input templates (the craft matcher takes the first match).
/// `required_level` is NOT a param — it is DERIVED from the distinct-ingredient count via `y92`
/// (the exact reference y16, CraftingFormulas.java:38-42) so it can never disagree with the success/XP math.
/// `required_job` + `craft_xp` are admin-trusted (like `output_quantity`); `craft_xp` is the seed-baked per-craft
/// job XP (④).
public fun create_recipe(
  cap: &AdminCap,
  version: &Version,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  output_template: ID,
  output_quantity: u64,
  required_job: u8,
  craft_xp: u64,
  ctx: &mut TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(output_quantity >= 1, EZeroQuantity);
  let inputs = y89(input_templates, input_quantities);
  let n = inputs.length();
  let required_level = y92(n); // ① derived, never mis-authored
  let recipe = Recipe { id: object::new(ctx), inputs, output_template, output_quantity, required_job, required_level, craft_xp };
  event::emit(RecipeCreated { recipe: object::id(&recipe), output_template, output_quantity, input_count: n, required_job, required_level, craft_xp });
  transfer::share_object(recipe);
}

/// HEAL a LIVE recipe's ingredient list IN PLACE — the door `create_recipe` never had. `input_templates` /
/// `input_quantities` fully REPLACE the old `inputs` (not a merge), and `required_level` is RE-DERIVED from the new
/// slot count through the SAME `y92` create uses, so a healed recipe is indistinguishable from
/// one authored correctly on day one. The same authoring rules apply (`ELengthMismatch` / `EEmptyRecipe` /
/// `EZeroQuantity`) — a recipe can never be emptied into a free mint.
///
/// WHY THIS EXISTS: `create_recipe` SHARES the `Recipe` with no update path, so a mis-authored ingredient list stayed
/// craftable forever — and because `required_level` is DERIVED FROM THE SLOT COUNT (① the reference knowledge gate),
/// an under-slotted recipe also under-gates itself: the live 3-slot bowyer recipes y16 at level 14 and mint
/// far-above-tier bows to any L14 crafter. Re-slotting them through this door re-derives the gate and closes it.
/// Patching in place is what makes the cure complete: the recipe ID is preserved, so every `Commission` already
/// pointing at it heals too — a burn-and-recreate would strand those and leave the old object craftable.
///
/// `output_template` / `output_quantity` / `required_job` / `craft_xp` are deliberately NOT touchable here — changing
/// what a recipe PRODUCES is a different recipe (author a new one), while what it CONSUMES is a correction.
///
/// UPGRADE-COMPAT: additive public function only; no existing type or signature changes.
public fun set_recipe_inputs(
  cap: &AdminCap,
  version: &Version,
  recipe: &mut Recipe,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  let inputs = y89(input_templates, input_quantities);
  let n = inputs.length();
  recipe.inputs = inputs;
  recipe.required_level = y92(n); // ① re-derived — the healed gate
  event::emit(RecipeInputsSet {
    recipe: object::id(recipe),
    input_count: n,
    required_level: recipe.required_level,
  });
}

/// Replace a live recipe's authored per-craft job XP (④) IN PLACE. `craft_xp` is admin-trusted at authoring and had
/// no setter, so a corpus XP re-balance could not reach recipes already on chain — every healed recipe would keep its
/// minted value while the corpus moved beneath it. Version-gated + AdminCap-gated exactly like the other doors, and
/// the recipe id is preserved, so this composes with `set_recipe_inputs` in the SAME healing PTB.
///
/// SCOPE: the authored BASE only. The runtime decay (`y21`) is derived from the slot count and the crafter's
/// level, so it follows automatically — there is no second XP fact to keep in sync. Emits `RecipeCraftXpSet`.
///
/// UPGRADE-COMPAT: additive public function only; no existing type or signature changes.
public fun set_recipe_craft_xp(cap: &AdminCap, version: &Version, recipe: &mut Recipe, craft_xp: u64, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  recipe.craft_xp = craft_xp;
  event::emit(RecipeCraftXpSet { recipe: object::id(recipe), craft_xp });
}

/// RETIRE a recipe: DELETE its shared object on-chain, so it can never be crafted again. The kill switch for the
/// recipes `set_recipe_inputs` cannot heal — an output template that no longer exists, or a duplicate of a recipe
/// kept elsewhere. Version-gated + AdminCap-gated, MIRRORING `admin::burn_item_template`: the `Recipe` is taken BY
/// VALUE, unpacked (every remaining field has `drop` — `Ingredient` is `copy + drop + store`), and its UID is
/// `object::delete`d. Sui permits deleting a shared object passed by value, so this is TRUE deletion, not an inert
/// flag: no `craftable` bit is added to the struct (that would be a layout change, and a flag leaves a live object
/// one bug away from crafting again). Emits `RecipeRetired`.
///
/// BLAST RADIUS — deliberate: a retired recipe's id stops resolving, so any `CraftRequest` bound to it can no longer
/// be accepted or executed (`commission` takes `&Recipe` — the object simply cannot be supplied). That is the POINT
/// of a kill switch; heal with `set_recipe_inputs` instead whenever the recipe should keep serving its commissions.
/// Items already crafted are untouched — they reference templates, never the recipe.
public fun retire_recipe(cap: &AdminCap, version: &Version, recipe: Recipe, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let Recipe { id, inputs: _, output_template, output_quantity: _, required_job: _, required_level: _, craft_xp: _ } = recipe;
  event::emit(RecipeRetired { recipe: id.to_inner(), output_template });
  object::delete(id);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Zip `templates` × `quantities` into the validated ingredient list — ONE home for the authoring rules both
/// `create_recipe` and `set_recipe_inputs` enforce: the vectors zip 1:1 (`ELengthMismatch`), a recipe needs ≥1 input
/// (`EEmptyRecipe` — else it is a free mint), and every quantity is ≥1 (`EZeroQuantity`).
fun y89(templates: vector<ID>, quantities: vector<u64>): vector<Ingredient> {
  let n = templates.length();
  assert!(n == quantities.length(), ELengthMismatch);
  assert!(n > 0, EEmptyRecipe);
  let mut inputs = vector<Ingredient>[];
  let mut i = 0;
  while (i < n) {
    let quantity = quantities[i];
    assert!(quantity >= 1, EZeroQuantity);
    inputs.push_back(Ingredient { template: templates[i], quantity });
    i = i + 1;
  };
  inputs
}

// ╔════════════════ [ CRAFT (terminal &Random — gate, burn, roll, mint-on-success, credit XP) ] ═ ]

/// Craft `recipe` for the SIGNER (self-craft): CONSUME the crafter's kiosk-locked `input_item_ids`, ROLL the reference-formula
/// success chance off THEIR job level, MINT the output into their personal kiosk ON SUCCESS, and credit the craft
/// job XP to their character (success OR failure). ONE terminal `&Random` command — the roll + mint compose here.
/// `output_template` MUST be the recipe's output (`EWrongOutput`); the crafter must hold `required_level` in
/// `required_job` (`EUnderLevel`); the ingredient tally must land EXACT before the roll (`EMissingIngredient` /
/// `EUnknownIngredient` / `EIngredientOverSupply`). Any deterministic refusal reverts the whole tx (burns AND
/// re-locks) — a wrong client never reaches the dice.
entry fun craft(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  let crafter_level = y93(kiosk, pkcap, character_id, recipe.required_job);
  let mut gen = random::new_generator(r, ctx);
  let success = y20(crafter_level, &mut gen);
  // the OUTPUT's stat roll rides the same terminal draw as the success roll (#758) — one generator, one call.
  y90(recipe, kiosk, pkcap, character_id, input_item_ids, output_template, crafter_level, success, gen.generate_u64(), xpolicy, policy, config, version, ctx);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// The self-craft body shared by the live `&Random` entry and the deterministic test doors. Given the crafter's
/// level + the already-rolled `success`, it runs the exact reference pipeline: gate + burn (deterministic refusals) →
/// mint the output ON SUCCESS → credit the craft XP to the crafter's OWN character (success OR failure) → emit.
fun y90(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  crafter_level: u64,
  success: bool,
  stat_seed: u64,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
): Option<ID> {
  y18(recipe, kiosk, pkcap, input_item_ids, output_template, crafter_level, xpolicy, policy, config, version, ctx);
  let owner_cap = personal_kiosk::borrow(pkcap);
  let minted = y19(recipe, output_template, success, stat_seed, kiosk, owner_cap, policy, version, ctx);
  let gained_xp = y21(recipe.craft_xp, recipe.inputs.length(), crafter_level);
  {
    let character = kiosk.borrow_mut(owner_cap, character_id);
    character_link::y3(character, recipe.required_job, gained_xp, version);
  };
  event::emit(Crafted {
    recipe: object::id(recipe),
    crafter: sender(ctx),
    output_template: recipe.output_template,
    output_quantity: if (success) recipe.output_quantity else 0,
    success,
    job_xp_gained: gained_xp,
  });
  minted
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ① + ③ CONSUME: the deterministic front half of a craft — assert enabled + kill-switch, output match, the ①
/// KNOWLEDGE GATE (`crafter_level ≥ required_level`, `EUnderLevel`), then burn the exact ingredient tally. Every
/// abort here reverts the WHOLE tx BEFORE any roll, so a wrong client fails 100% deterministically (never only on
/// the dice). Shared by self-craft and `commission::execute` (which passes the ARTISAN's proven level). A stack
/// LARGER than the recipe needs AUTO-SPLITS: only the required units burn; the surplus remainder re-locks into the
/// crafter's kiosk (no free-standing split door). Conservation holds per stack.
public(package) fun y18(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  crafter_level: u64,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  config.assert_domain(aresrpg::config::domain_crafting()); // S-46 kill-switch bit
  version.assert_enabled();
  assert!(item::template_id(output_template) == recipe.output_template, EWrongOutput);
  assert!(crafter_level >= recipe.required_level, EUnderLevel); // ① the reference knowledge gate

  // remaining[j] = units of recipe.inputs[j] still needed; consumed inputs subtract from it.
  let n = recipe.inputs.length();
  let mut remaining = vector<u64>[];
  let mut j = 0;
  while (j < n) { remaining.push_back(recipe.inputs[j].quantity); j = j + 1; };

  // CONSUME each supplied input against the recipe tally (proven by the extract seam's pkcap). A stack LARGER
  // than the recipe still needs is AUTO-SPLIT: only the needed units are burned; the surplus remainder re-locks into
  // the crafter's kiosk (no free-standing split door). Conservation holds per stack.
  let mut i = 0;
  while (i < input_item_ids.length()) {
    let (mut stack, burn_pledge) = extract::extract_for_burn(kiosk, pkcap, input_item_ids[i], xpolicy, version, ctx);
    let template = item::template(&stack);
    let amount = item::amount(&stack);
    let idx = y94(recipe, template);
    assert!(idx.is_some(), EUnknownIngredient);
    let k = idx.destroy_some();
    let need = remaining[k];
    // A stack for an ingredient the recipe no longer needs is a redundant input — nothing left to consume.
    assert!(need >= 1, EIngredientOverSupply);
    let take = if (need < amount) need else amount; // consume min(need, amount)
    if (take < amount) {
      // OVER-SUPPLY: split the surplus off into its OWN stack and re-lock it (the LockPledge type-forces the
      // personal-kiosk re-lock); `stack` is left holding exactly `take` units for the burn below. Conservation:
      // amount == take (burned) + (amount − take) (re-locked) — no unit is ever minted or lost.
      let (surplus, lock_pledge) = item::split(&mut stack, amount - take, ctx);
      item::lock_in_kiosk(lock_pledge, surplus, kiosk, personal_kiosk::borrow(pkcap), policy);
    };
    let (_template, burned) = extract::burn(burn_pledge, stack, version); // `stack` now holds exactly `take` ⇒ burned == take
    *remaining.borrow_mut(k) = remaining[k] - burned;
    i = i + 1;
  };

  // Every ingredient must be satisfied EXACTLY (a leftover > 0 means missing / short) — the last deterministic gate.
  let mut m = 0;
  while (m < n) { assert!(remaining[m] == 0, EMissingIngredient); m = m + 1; };
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ③ SETTLE: mint the recipe's output into the crafter's personal kiosk (locked) ONLY on a successful roll. On a
/// failed roll nothing mints — the ingredients already burned in `y18`. Shared by self-craft and
/// `commission::execute` (which mints into the CUSTOMER's kiosk via the customer's owner cap).
public(package) fun y19(
  recipe: &Recipe,
  output_template: &ItemTemplate,
  success: bool,
  stat_seed: u64,
  kiosk: &mut Kiosk,
  owner_cap: &sui::kiosk::KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
): Option<ID> {
  // `stat_seed` rides the SAME terminal `&Random` draw as the success roll (#758): a crafted gear NFT is born
  // with its rolled stat block, exactly like a bought or looted one. Returns the minted id (none on a failed roll).
  if (!success) return option::none();
  option::some(character_link::y10(output_template, recipe.output_quantity, option::some(stat_seed), version, kiosk, owner_cap, policy, ctx))
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ② The reference-formula success roll: draw `0..=9999` from the threaded rng and pass if `< y91(level)`
/// (CraftQueue.java:201 `rng.nextDouble() < successRate`). P(success) = bp/10000, exact. Shared by self-craft (the
/// crafter's level) and `commission::execute` (the ARTISAN's proven level).
public(package) fun y20(level: u64, gen: &mut RandomGenerator): bool {
  random::generate_u64_in_range(gen, 0, 9999) < y91(level)
}

// ╔════════════════ [ Internals — the ported reference formulas ] ════════════════ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ② `min(9900, 5000 + (level−1)×50)` bp (CraftingFormulas.java:13-15). `level ≥ 1` always (`level_from_xp` floors
/// at 1), so `level − 1` never underflows.
fun y91(level: u64): u64 {
  let bp = SUCCESS_BASE_BP + (level - 1) * SUCCESS_PER_LEVEL_BP;
  if (bp > SUCCESS_CAP_BP) SUCCESS_CAP_BP else bp
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ① Minimum job level to y16 a recipe with `n` distinct ingredient slots (CraftingFormulas.java:38-42):
/// `n ≤ 2 → 1`, else `min(100, ceil((n−2)×99/8) + 1)`. `ceil(a/8) = (a + 7)/8` in integer math.
fun y92(n: u64): u64 {
  if (n <= 2) return 1;
  let v = ((n - 2) * 99 + 7) / 8 + 1;
  if (v > job_xp::max_level()) job_xp::max_level() else v
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// ④ Craft job XP = `base_xp × recipeLevelMultiplier(n, level)` (CraftQueue.java:192-194, CraftingFormulas.java
/// :58-69): FULL `base_xp` until the crafter reaches the next recipe tier (`decay_start`), then LINEAR decay to 0 at
/// `recipe_level + 30` (`zero_at`). Integer-exact port of the Java float multiplier `(zero_at − level)/(zero_at −
/// decay_start)` applied to `base_xp`.
public(package) fun y21(base_xp: u64, n: u64, crafter_level: u64): u64 {
  let recipe_level = y92(n);
  let zero_at = recipe_level + RECIPE_XP_DECAY_RANGE;
  let decay_start = y92(n + 1);
  if (decay_start >= zero_at) { if (crafter_level >= zero_at) 0 else base_xp }
  else if (crafter_level <= decay_start) base_xp
  else if (crafter_level >= zero_at) 0
  else base_xp * (zero_at - crafter_level) / (zero_at - decay_start)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// The crafter's job level for `job`, read through the personal-kiosk cap (immutable borrow — ownership already
/// proven by holding the cap). Mirrors gather's job-level read.
fun y93(kiosk: &Kiosk, pkcap: &PersonalKioskCap, character_id: ID, job: u8): u64 {
  let character = kiosk.borrow(personal_kiosk::borrow(pkcap), character_id);
  job_xp::level_from_xp(character_link::job_xp(character, job))
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// The index of the FIRST recipe ingredient whose template is `template` (authoring convention: distinct inputs).
fun y94(recipe: &Recipe, template: ID): Option<u64> {
  let mut i = 0;
  while (i < recipe.inputs.length()) {
    if (recipe.inputs[i].template == template) return option::some(i);
    i = i + 1;
  };
  option::none()
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun output_template(recipe: &Recipe): ID { recipe.output_template }
public fun output_quantity(recipe: &Recipe): u64 { recipe.output_quantity }
public fun input_count(recipe: &Recipe): u64 { recipe.inputs.length() }
public fun required_job(recipe: &Recipe): u8 { recipe.required_job }
public fun required_level(recipe: &Recipe): u64 { recipe.required_level }
public fun craft_xp(recipe: &Recipe): u64 { recipe.craft_xp }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Deterministic self-craft (framework test rng) — the real `&Random` `craft` entry shares `y90`.
public fun craft_for_testing(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
): Option<ID> {
  let crafter_level = y93(kiosk, pkcap, character_id, recipe.required_job);
  let mut gen = random::new_generator_for_testing();
  let success = y20(crafter_level, &mut gen);
  y90(recipe, kiosk, pkcap, character_id, input_item_ids, output_template, crafter_level, success, gen.generate_u64(), xpolicy, policy, config, version, ctx)
}

#[test_only]
/// Self-craft with an INJECTED outcome (no rng) — proves the success AND failure BRANCHES deterministically: the
/// real gate + burn run, then `success` decides mint-vs-not; XP is credited either way. Returns the minted id.
public fun craft_forced(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  success: bool,
  stat_seed: u64,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
): Option<ID> {
  let crafter_level = y93(kiosk, pkcap, character_id, recipe.required_job);
  y90(recipe, kiosk, pkcap, character_id, input_item_ids, output_template, crafter_level, success, stat_seed, xpolicy, policy, config, version, ctx)
}

#[test_only]
public fun test_success_rate_bp(level: u64): u64 { y91(level) }

#[test_only]
public fun test_min_level_for_ingredients(n: u64): u64 { y92(n) }

#[test_only]
public fun test_craft_xp_gain(base_xp: u64, n: u64, crafter_level: u64): u64 { y21(base_xp, n, crafter_level) }

#[test_only]
public fun test_success_roll(level: u64, gen: &mut RandomGenerator): bool { y20(level, gen) }
