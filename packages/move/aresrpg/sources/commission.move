// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// COMMISSION — the artisan-commission crafting flow (supersedes the pay-X escrow
/// v1): "the CUSTOMER provides the RESOURCES and an OPTIONAL payment; the ARTISAN provides the KNOWLEDGE". A customer
/// who can't (or won't) craft a recipe themselves asks a qualified artisan to craft it FOR them, from the customer's
/// own ingredients, and pays them a commission fee of AT LEAST 0.1 SUI (the v1 zero-payment
/// "social favour" path is retired). The output lands kiosk-LOCKED in the CUSTOMER's kiosk; the escrow
/// releases to the ARTISAN. Three txs, because two OWNED resources must combine and one signer signs per tx:
///
///   ① request(CUSTOMER): share a `CraftRequest{customer, artisan, recipe, payment (≥ 0.1 SUI), accepted:false}`.
///      The ingredients STAY kiosk-locked in the customer's kiosk — they are NEVER escrowed (they physically CAN'T
///      be: the kiosk-lock constitution forbids a personal-kiosk item leaving except into another kiosk, so a shared
///      escrow object could only hold them UNLOCKED = a defect). The craft re-asserts EXACT ingredients at ③ and
///      reverts atomically if short — nothing strands (the customer can always `cancel`).
///   ② accept(ARTISAN): the named artisan proves their KNOWLEDGE on-chain — their OWN character's job level (read
///      through their soulbound personal-kiosk cap) must be ≥ the recipe's `required_level` (`EUnderLevel`) — and
///      flips `accepted`, RECORDING their proven `artisan_level` + `artisan_character` on the request (③ reads them:
///      the roll runs at the artisan's skill, the XP credits the artisan's character). Only the NAMED artisan
///      (`sender == request.artisan`) can accept (`EWrongArtisan`).
///   ③ execute(CUSTOMER): with an accepted request, the customer runs the craft on THEIR OWN kiosk/cap/ingredients
///      (`crafting::craft_consume` burns the locked inputs; the reference-formula success roll runs at the recorded
///      `artisan_level`; `crafting::settle_output` mints the output LOCKED into the customer's kiosk ON SUCCESS) and
///      the escrow releases to the artisan. `execute` consumes the shared request BY VALUE, so double-execute and
///      execute-after-cancel are impossible by construction.
///   cancel(EITHER party, pre-execute): refund the escrow to the CUSTOMER (its owner). Ownership-gated ONLY (never a
///      kill-switch), so funds can never strand.
///
/// SUCCESS CHANCE: `crafting::craft` is NO LONGER deterministic — it rolls the reference-formula
/// success chance. A commission therefore CAN FAIL: `execute` rolls `success_rate_bp(artisan_level)` (the artisan's
/// KNOWLEDGE drives the odds — the whole point of hiring a qualified artisan). ESCROW ON FAILURE — the artisan KEEPS
/// the payment NET of the 10% platform cut (the closest reference-design fit): the artisan sold their qualified ATTEMPT, not a guaranteed
/// output; the customer accepted the RNG when they commissioned (the 0.1 SUI-minimum fee buys the attempt, not the
/// outcome). The customer's ingredients burn on a failed roll exactly as in self-craft. A REFUND-on-failure model was rejected —
/// it would let customers extract free qualified labour on the unlucky roll and strand the artisan's real skill.
///
/// ARTISAN XP: the craft job XP credits the ARTISAN,
/// success OR failure (the reference server grants craft XP per attempt). MECHANICS — job XP is a dynamic field ON the Character
/// object; writing it needs `&mut Character` = the character's kiosk-owner cap. In the CUSTOMER-signed `execute` the
/// artisan's soulbound cap is unavailable, so a SYNCHRONOUS credit to the artisan's character is mechanically
/// IMPOSSIBLE (verified against `character_link`'s write path; the gather precedent credits the SIGNER's own char,
/// and fight rewards to a non-signer already use MARK-AND-CLAIM). Moving job XP to a shared registry keyed by
/// character-id — the only synchronous alternative — would serialise EVERY gather/craft/forgemagie tx through one
/// shared object (the consensus-chokepoint anti-pattern we explicitly avoid). So `execute` MINTS a `CraftXpVoucher`
/// (the artisan's proven `artisan_character` + `job` + `xp`) and transfers it to the artisan, who `redeem_craft_xp`s
/// it in their OWN tx (borrowing their OWN character with their OWN cap) — the exact fight-reward-claim pattern. The
/// XP is fully computed + owed ATOMICALLY at execute; the claim is a redemption, not a deferred feature.
module aresrpg::commission;

use aresrpg::{
  character::Character,
  character_link,
  config::{Self, GameConfig},
  crafting::{Self, Recipe},
  extract::ItemExtractPolicy,
  item::{Item, ItemTemplate},
  version::Version
};
use aresrpg_foundation::job_xp;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  balance::{Self, Balance},
  coin::{Self, Coin},
  event,
  kiosk::Kiosk,
  random::{Self, Random},
  sui::SUI,
  transfer_policy::TransferPolicy,
  tx_context::sender
};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const EWrongArtisan: u64 = 101; // accept / redeem: the caller is not this request's / voucher's named artisan
const EUnderLevel: u64 = 102; // accept: the artisan's job level is below the recipe's required knowledge level
const EWrongRecipe: u64 = 103; // accept / execute: the passed recipe is not the one this request is bound to
const ENotAccepted: u64 = 104; // execute: no qualified artisan has accepted yet
const EWrongCustomer: u64 = 105; // execute: the caller is not this request's customer
const ENotParty: u64 = 106; // cancel: the caller is neither the customer nor the artisan
const EAlreadyAccepted: u64 = 107; // accept: re-accept latch — the proven level/character can never be swapped post-accept
const EAmountTooLow: u64 = 108; // request: the escrowed payment is below the 0.1 SUI commission minimum

// ╔════════════════ [ Config ] ═══════════════════════════════════════════════ ]

/// The MINIMUM escrowed payment a commission must carry (a 0.1 SUI floor).
/// 0.1 SUI = 100_000_000 MIST. The v1 "optional / may be zero" payment is retired — a commission now always pays
/// the named artisan at least this floor. The frontend clamps the payment input to match; this assert is the
/// on-chain guarantee (`request` aborts `EAmountTooLow` below it).
const MIN_PAYMENT_MIST: u64 = 100_000_000;

/// The platform's 10% cut of the artisan's payment — taken at the PAYOUT moment (`execute`) and routed to the fixed
/// `@treasury`, the SAME royalty-treasury home the marketplace 10% uses (one home, never a per-sale field). Mirrors
/// the 1000-bp royalty convention; a DISTINCT policy fact from the marketplace royalty, so its own const (decoupled —
/// retuning one never silently moves the other). Composes with the floor: min payment 0.1 SUI → min net 0.09 / cut 0.01.
const PLATFORM_CUT_BPS: u64 = 1_000;
const BPS_DENOM: u64 = 10_000;

/// The 10% platform cut on `amount` — FLOORED (`mul_div` rounds down; the artisan nets the remainder). `mul_div`
/// upcasts to u128 internally, so `amount × 1000` cannot overflow. A FREE read (== execution) the SDK/tests project.
public fun platform_cut_of(amount: u64): u64 { amount.mul_div(PLATFORM_CUT_BPS, BPS_DENOM) }

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A shared craft-commission binding the CUSTOMER (who funds it + brings the ingredients) to the ARTISAN they named.
/// `recipe` is the bound recipe id — `accept`/`execute` must pass the SAME `Recipe` (`EWrongRecipe`). `payment` is
/// the escrowed SUI (≥ 0.1 SUI, the commission floor). `accepted` is flipped true ONLY by the named artisan's qualifying
/// `accept`, which also records `artisan_level` (the roll runs at it) + `artisan_character` (the XP voucher credits
/// it). No item/ingredient field — the ingredients stay kiosk-locked in the customer's kiosk. `key` only — shared.
public struct CraftRequest has key {
  id: UID,
  customer: address,
  artisan: address,
  recipe: ID,
  payment: Balance<SUI>,
  accepted: bool,
  artisan_level: u64, // set at accept — the artisan's proven job level; the success roll runs at it
  artisan_character: ID, // set at accept — the artisan's character the XP voucher credits
}

/// A claimable craft-XP credit minted to the ARTISAN by `execute` (see the module doc — synchronous cross-party
/// character writes are impossible, so the artisan claims exactly like a fight reward). Owned by the artisan;
/// `redeem_craft_xp` borrows their `character` through their own cap and banks `xp` into `job`. `key` only.
public struct CraftXpVoucher has key {
  id: UID,
  artisan: address,
  character: ID,
  job: u8,
  xp: u64,
}

// ╔════════════════ [ Events (the indexer projects the commission lifecycle) ] ═ ]

public struct CraftRequested has copy, drop { request: ID, customer: address, artisan: address, recipe: ID, amount: u64 }

public struct CraftAccepted has copy, drop { request: ID, artisan: address, artisan_level: u64, artisan_character: ID }

/// The commissioned craft outcome. `amount` — the gross the customer escrowed; `fee` — the 10% platform cut routed
/// to `@treasury` (the artisan nets `amount − fee`). `success` — did the reference-formula roll (at `artisan_level`) pass?
/// `artisan_xp` — the craft XP owed to the artisan (delivered as a `CraftXpVoucher`, credited on redeem). Indexer
/// re-point: `fee` is a NEW field (the treasury split); `CraftXpVoucher` objects + `CraftXpRedeemed` are projections.
public struct CraftExecuted has copy, drop { request: ID, customer: address, artisan: address, recipe: ID, amount: u64, fee: u64, success: bool, artisan_xp: u64 }

public struct CraftCancelled has copy, drop { request: ID, customer: address, artisan: address, amount: u64 }

public struct CraftXpRedeemed has copy, drop { artisan: address, character: ID, job: u8, xp: u64 }

// ╔════════════════ [ Request — the customer opens a commission (ingredients stay put) ] ═ ]

/// REQUEST a craft: escrow a `payment` of AT LEAST the 0.1 SUI commission floor (never a ZERO coin —
/// the v1 "optional payment" path is retired; `EAmountTooLow` below enforces the minimum) toward
/// `artisan` for `recipe_id`. The customer
/// is the tx sender; the ingredients are NOT touched (they stay kiosk-locked in the customer's kiosk until
/// `execute`). `artisan_level` / `artisan_character` are placeholders until `accept` records the artisan's proof.
public fun request(
  artisan: address,
  recipe_id: ID,
  payment: Coin<SUI>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  config.assert_enabled();
  config.assert_domain(config::domain_crafting());
  let customer = sender(ctx);
  let amount = payment.value();
  assert!(amount >= MIN_PAYMENT_MIST, EAmountTooLow); // the 0.1 SUI commission floor
  let req = CraftRequest {
    id: object::new(ctx),
    customer,
    artisan,
    recipe: recipe_id,
    payment: payment.into_balance(),
    accepted: false,
    artisan_level: 0,
    artisan_character: object::id_from_address(@0x0),
  };
  event::emit(CraftRequested { request: object::id(&req), customer, artisan, recipe: recipe_id, amount });
  transfer::share_object(req);
}

// ╔════════════════ [ Accept — the artisan proves their knowledge (job level) ] ═ ]

/// ACCEPT a request: the NAMED artisan proves their KNOWLEDGE and marks the request ready to execute. Only the named
/// artisan may accept (`sender == request.artisan`, `EWrongArtisan`); the passed `recipe` MUST be the bound one
/// (`EWrongRecipe`). The artisan's OWN character (borrowed through their soulbound personal-kiosk cap — holding it
/// proves they ARE the artisan) must hold job level ≥ `recipe.required_level` for the recipe's job (`EUnderLevel`).
/// RECORDS the proven `artisan_level` (the execute roll runs at it) + `artisan_character` (the XP voucher credits
/// it), then flips `accepted`. Reads only otherwise — the craft happens later in the customer's `execute`.
public fun accept(
  request: &mut CraftRequest,
  recipe: &Recipe,
  artisan_kiosk: &Kiosk,
  artisan_pkcap: &PersonalKioskCap,
  character_id: ID,
  config: &GameConfig,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  config.assert_enabled();
  config.assert_domain(config::domain_crafting());
  assert!(sender(ctx) == request.artisan, EWrongArtisan);
  assert!(object::id(recipe) == request.recipe, EWrongRecipe);
  // Money-hat P2 (07-12): accept LATCHES. A re-accept could swap in a lower-level character AFTER the
  // customer saw the proven odds — silently degrading a paid success rate. One accept, forever.
  assert!(!request.accepted, EAlreadyAccepted);
  let owner_cap = personal_kiosk::borrow(artisan_pkcap);
  let character = artisan_kiosk.borrow<Character>(owner_cap, character_id);
  let level = job_xp::level_from_xp(character_link::job_xp(character, crafting::required_job(recipe)));
  assert!(level >= crafting::required_level(recipe), EUnderLevel);
  request.accepted = true;
  request.artisan_level = level;
  request.artisan_character = character_id;
  event::emit(CraftAccepted { request: object::id(request), artisan: request.artisan, artisan_level: level, artisan_character: character_id });
}

// ╔════════════════ [ Execute — the customer runs the craft on their own kiosk; escrow → artisan ] ═ ]

/// EXECUTE an accepted commission (terminal `&Random`): the CUSTOMER runs the craft on THEIR OWN kiosk —
/// `crafting::craft_consume` burns their kiosk-locked `input_item_ids`, the reference-formula success roll runs at the recorded
/// `artisan_level`, and `crafting::settle_output` mints the recipe's output LOCKED into the customer's kiosk ON
/// SUCCESS (auto-splitting any surplus input stack). The escrow releases to the artisan REGARDLESS of the roll —
/// NET of the 10% platform cut to `@treasury` (the artisan sold their qualified attempt); the craft XP is minted as a `CraftXpVoucher` (claimed via
/// `redeem_craft_xp`). Only the customer may execute (`EWrongCustomer`); the request must be `accepted`
/// (`ENotAccepted`) and the passed `recipe` must be the bound one (`EWrongRecipe`). The request is consumed BY
/// VALUE, so double-execute / execute-after-cancel are impossible. Any deterministic craft refusal (missing / short
/// ingredients, forged output) reverts the WHOLE tx — the escrow is untouched and the customer can still cancel.
entry fun execute(
  request: CraftRequest,
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  execute_gate(&request, recipe, ctx);
  let mut gen = random::new_generator(r, ctx);
  let success = crafting::success_roll(request.artisan_level, &mut gen);
  // the output's stat roll shares this one terminal draw with the success roll (#758).
  execute_body(request, recipe, kiosk, pkcap, input_item_ids, output_template, success, gen.generate_u64(), xpolicy, policy, config, version, ctx);
}

/// The execute preconditions (shared by the live entry and the deterministic test door): customer-only, accepted,
/// bound recipe. Checked BEFORE any randomness is drawn — an un-accepted request has `artisan_level` 0, which must
/// never reach the roll (the roll's `level − 1` floors at level 1).
fun execute_gate(request: &CraftRequest, recipe: &Recipe, ctx: &TxContext) {
  assert!(sender(ctx) == request.customer, EWrongCustomer);
  assert!(request.accepted, ENotAccepted);
  assert!(object::id(recipe) == request.recipe, EWrongRecipe);
}

/// The execute body shared by the live `&Random` entry and the deterministic test door — given the already-rolled
/// `success`: burn the customer's inputs, mint the output ON SUCCESS, mint the artisan's XP voucher, split the
/// escrow (artisan nets 90%, 10% → `@treasury`), emit, delete.
fun execute_body(
  request: CraftRequest,
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  success: bool,
  stat_seed: u64,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  let CraftRequest { id, customer, artisan, recipe: _, payment, accepted: _, artisan_level, artisan_character } = request;
  let amount = payment.value();

  // Run the craft on the CUSTOMER's kiosk at the ARTISAN's proven level: burn the locked inputs (deterministic
  // refusals abort ATOMICALLY — a wrong client's tx reverts whole, escrow untouched, never lost to the dice), then
  // mint LOCKED into the customer's OWN personal kiosk ON SUCCESS (kiosk-lock constitution — never a raw address).
  crafting::craft_consume(recipe, kiosk, pkcap, input_item_ids, output_template, artisan_level, xpolicy, policy, config, version, ctx);
  let owner_cap = personal_kiosk::borrow(pkcap);
  crafting::settle_output(recipe, output_template, success, stat_seed, kiosk, owner_cap, policy, version, ctx);

  // ARTISAN XP (always — success or failure): computed at the artisan's level, delivered as a claim voucher.
  let xp = crafting::craft_xp_gain(crafting::craft_xp(recipe), crafting::input_count(recipe), artisan_level);
  transfer::transfer(
    CraftXpVoucher { id: object::new(ctx), artisan, character: artisan_character, job: crafting::required_job(recipe), xp },
    artisan,
  );

  // Release the escrow REGARDLESS of the roll (the qualified attempt is the paid service): the 10% PLATFORM CUT
  // splits to `@treasury` FIRST, the artisan NETS 90% (`amount − fee`). FLOORED
  // — the artisan takes the remainder. The 0.1 SUI floor (`request`) guarantees a real escrow (min cut 0.01, min net
  // 0.09), so both are live transfers. SUI is not kiosk-locked → `public_transfer` is the sanctioned money move.
  let fee = platform_cut_of(amount);
  let mut bal = payment;
  let cut = bal.split(fee);
  transfer::public_transfer(coin::from_balance(cut, ctx), @treasury);
  transfer::public_transfer(coin::from_balance(bal, ctx), artisan); // net = amount − fee
  event::emit(CraftExecuted { request: id.to_inner(), customer, artisan, recipe: object::id(recipe), amount, fee, success, artisan_xp: xp });
  id.delete();
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Execute with an INJECTED roll outcome (no rng) — proves the success AND failure branches deterministically:
/// the real gate + burn + escrow-release + voucher run; `success` decides mint-vs-not. The live `&Random` entry
/// shares `execute_gate` + `execute_body` exactly.
public fun execute_forced(
  request: CraftRequest,
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  success: bool,
  stat_seed: u64,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  execute_gate(&request, recipe, ctx);
  execute_body(request, recipe, kiosk, pkcap, input_item_ids, output_template, success, stat_seed, xpolicy, policy, config, version, ctx);
}

#[test_only]
/// Mint a `CraftXpVoucher` to `to` — TEST ONLY. The live `execute` always mints the voucher to the request's
/// artisan, and the voucher is `key`-only (soulbound, untransferable), so it can NEVER reach a wrong sender in
/// production; this door routes one to the wrong party to drive `redeem_craft_xp`'s belt-and-suspenders
/// `EWrongArtisan` guard under test. Stripped from published bytecode.
public fun mint_voucher_for_testing(artisan: address, character: ID, job: u8, xp: u64, to: address, ctx: &mut TxContext) {
  transfer::transfer(CraftXpVoucher { id: object::new(ctx), artisan, character, job, xp }, to);
}

// ╔════════════════ [ Redeem — the artisan banks their earned craft XP (own cap) ] ═ ]

/// REDEEM a `CraftXpVoucher`: the artisan banks the owed craft XP into their OWN character's job. Consumes the
/// voucher BY VALUE (owning it proves the claim — the belt-and-suspenders `EWrongArtisan` re-asserts sender identity).
/// Borrows the voucher's `character` through the artisan's own personal-kiosk cap (`kiosk.borrow_mut` aborts if the
/// character is not in this kiosk) and adds `xp` to `job` — the SAME `character_link` write path gather/craft use.
/// The FIGHT-reward-claim pattern: the XP was owed atomically at `execute`; this is its redemption.
public fun redeem_craft_xp(
  voucher: CraftXpVoucher,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  let CraftXpVoucher { id, artisan, character, job, xp } = voucher;
  assert!(sender(ctx) == artisan, EWrongArtisan);
  let owner_cap = personal_kiosk::borrow(pkcap);
  let chr = kiosk.borrow_mut<Character>(owner_cap, character);
  character_link::add_job_xp(chr, job, xp, version);
  event::emit(CraftXpRedeemed { artisan, character, job, xp });
  id.delete();
}

// ╔════════════════ [ Cancel — refund the customer (either party, pre-execute) ] ═ ]

/// CANCEL a request pre-execute and REFUND the escrow to the CUSTOMER. Callable by EITHER the customer (changed their
/// mind) or the named artisan (declines the job) — `ENotParty` otherwise — but the refund ALWAYS goes to the customer
/// (the escrow's owner); an artisan-triggered cancel is a decline, never a claim. Ownership-gated ONLY (no kill-switch
/// / freeze can block a refund of the customer's OWN money). Consumes the request by value, so it can't race execute.
public fun cancel(request: CraftRequest, ctx: &mut TxContext) {
  let party = sender(ctx);
  assert!(party == request.customer || party == request.artisan, ENotParty);
  let CraftRequest { id, customer, artisan, recipe: _, payment, accepted: _, artisan_level: _, artisan_character: _ } = request;
  let amount = payment.value();
  // The 0.1 SUI floor (`request`) guarantees a real escrow, so the refund is always a live transfer to the customer.
  transfer::public_transfer(coin::from_balance(payment, ctx), customer);
  event::emit(CraftCancelled { request: id.to_inner(), customer, artisan, amount });
  id.delete();
}

// ╔════════════════ [ Getters (FREE reads — the RPC/SDK project these) ] ═════ ]

public fun customer(self: &CraftRequest): address { self.customer }

public fun artisan(self: &CraftRequest): address { self.artisan }

public fun recipe(self: &CraftRequest): ID { self.recipe }

public fun amount(self: &CraftRequest): u64 { self.payment.value() }

public fun accepted(self: &CraftRequest): bool { self.accepted }
