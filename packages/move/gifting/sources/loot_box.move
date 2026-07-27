// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOOT BOX — the §11 gacha PET box: a consumable whose USE rolls on-chain randomness across a weighted table of
/// pet templates and mints ONE of them, kiosk-locked. This module owns BOTH the admin-authored loot TABLE (a
/// shared `LootRegistry`, keyed by box template id — the same shape as `pet::PetFeedConfig` /
/// `scribe::ScribeConfig`) AND the player door, which honors the `consumable_effect::KIND_GACHA_ROLL` reserved
/// vocabulary (a box is exactly a consumable template carrying that effect).
///
/// TWO-PHASE, and WHY (the terminal-`&Random` law): minting a pet needs the template OBJECT (no mint-by-id exists),
/// and a 1-of-N gacha only learns WHICH template at roll time — you cannot pass N shared template refs into one
/// call (Move has no `vector<&T>`; a shared object cannot be passed by-value-and-returned). So this mirrors the
/// codebase's OTHER roll-then-mint system, `results.move`:
///   • `open_box` (terminal `&Random`): assert it's a box + the table is set, BURN exactly one box unit from the
///     opener's kiosk, take ONE weighted draw, and mint a SOULBOUND `PetBoxClaim` recording the rolled template.
///     The roll lands only in a transferred soulbound object + the `LootBoxOpened` event — neither readable by an
///     in-tx wrapper, so a composer cannot observe-then-abort the draw (grind-safe, exactly as `results::open`).
///   • `claim_pet` (deterministic): present the claim + the now-known rolled `&ItemTemplate`, assert its id matches
///     the claim, MINT the pet NFT into the opener's personal kiosk (kiosk-lock constitution), burn the claim.
/// The claim is `key`-only (soulbound) on purpose — a tradeable claim would be a second market nobody ordered.
///
/// REFUSALS-FIRST: every abort (not-a-box, no/empty table, zero-weight sum, version/global freeze) fires BEFORE the
/// box is burned — a bad open costs only gas. A single draw; no auto-retry semantics anywhere.
module aresrpg_gifting::loot_box;

use aresrpg::{admin::AdminCap, character_link, config::GameConfig, consumable_effect, extract::ItemExtractPolicy, item::{Self, Item, ItemTemplate}, version::Version};
use aresrpg_gifting::gifting;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{event, kiosk::Kiosk, random::{Self, Random, RandomGenerator}, table::{Self, Table}, transfer_policy::TransferPolicy, tx_context::sender};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ENoTable: u64 = 101; // open_box: no loot table set for this box template (unset or empty)
const EZeroWeight: u64 = 102; // set/open: the table's total weight is zero (nothing can be rolled)
const ENotBox: u64 = 103; // open_box: the template is not a gacha box (no KIND_GACHA_ROLL consumable effect)
const EEmptyTable: u64 = 104; // admin_set_loot_table: an empty entries vector is refused
const ELengthMismatch: u64 = 105; // admin_set_loot_table: pet_templates and weights differ in length
const EClaimMismatch: u64 = 106; // claim_pet: the passed template is not the claim's rolled template

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One weighted row of a box's pool: the pet template to mint on a hit + its RELATIVE weight (basis is the row
/// sum, not a fixed denominator — so rows are addable/removable pre-mainnet without re-normalising).
public struct LootEntry has store, copy, drop {
  template: ID,
  weight: u64,
}

/// The admin-authored loot-table registry: box template id → its weighted pet pool. Shared once at init, seeded
/// EMPTY (a box with no table aborts `ENoTable` on open). Rows are replaceable pre-mainnet (the setter upserts).
public struct LootRegistry has key {
  id: UID,
  tables: Table<ID, vector<LootEntry>>,
}

/// The SOULBOUND (`key` only — no `store`) claim minted by `open_box`: records WHICH pet the roll picked + the
/// opener. `claim_pet` redeems it (mint + kiosk-lock), then burns it. Non-transferable by construction — the roll
/// outcome cannot be sold, only claimed.
public struct PetBoxClaim has key {
  id: UID,
  opener: address,
  box_template: ID,
  rolled_template: ID,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

/// A box's loot table was set/replaced — carries the box, the row count, and the weight sum (the DialChanged-class
/// signal the indexer projects the live pool from).
public struct LootTableSet has copy, drop { box_template: ID, rows: u64, weight_sum: u64 }

/// A box was opened: the roll picked `rolled_template`. The frontend reveal animation consumes THIS (the mint
/// follows in `claim_pet`).
public struct LootBoxOpened has copy, drop { box_template: ID, rolled_template: ID, opener: address }

/// The rolled pet was minted + kiosk-locked and the claim burned.
public struct PetClaimed has copy, drop { box_template: ID, rolled_template: ID, opener: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(LootRegistry { id: object::new(ctx), tables: table::new(ctx) });
}

// ╔════════════════ [ Admin (AdminCap + version-gated — tables authored while dark) ] ═ ]

/// Set (or replace) `box_template`'s weighted pet pool from two PARALLEL vectors (PTBs can't pass a vector of
/// tuples): `pet_templates[i]` mints at `weights[i]`. Aborts on an empty pool (`EEmptyTable`), a length mismatch
/// (`ELengthMismatch`), or a zero total weight (`EZeroWeight` — a table that can never roll is never stored). A
/// zero-weight ROW is allowed (inert) as long as the sum is positive. Admin data — no clamp (the pool is content;
/// a mis-set row rebalances rarity, it can never breach the money path — the mint is 1 pet either way).
public fun admin_set_loot_table(
  cap: &AdminCap,
  registry: &mut LootRegistry,
  box_template: ID,
  pet_templates: vector<ID>,
  weights: vector<u64>,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(!pet_templates.is_empty(), EEmptyTable);
  assert!(pet_templates.length() == weights.length(), ELengthMismatch);
  let mut entries = vector[];
  let mut sum = 0;
  let mut i = 0;
  while (i < pet_templates.length()) {
    let weight = *weights.borrow(i);
    sum = sum + weight;
    entries.push_back(LootEntry { template: *pet_templates.borrow(i), weight });
    i = i + 1;
  };
  assert!(sum > 0, EZeroWeight);
  if (registry.tables.contains(box_template)) *registry.tables.borrow_mut(box_template) = entries
  else registry.tables.add(box_template, entries);
  event::emit(LootTableSet { box_template, rows: pet_templates.length(), weight_sum: sum });
}

// ╔════════════════ [ OPEN (terminal &Random — burn one box, roll, mint the soulbound claim) ] ═ ]

/// Open ONE unit of the box: burn it and roll its pool, minting a soulbound `PetBoxClaim` for the rolled pet.
/// Terminal `&Random` (keep it the last command). Every refusal fires before the burn.
entry fun open_box(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  open_internal(registry, kiosk, pkcap, box_item_id, box_template, xpolicy, market_policy, config, version, &mut gen, ctx);
}

fun open_internal(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  config.assert_enabled(); // GLOBAL game freeze
  version.assert_enabled(); // package dark-ship + upgrade single-path

  // REFUSALS (gas-only) — prove it's a gacha box, then that its table is set + rollable.
  assert!(is_gacha_box(box_template), ENotBox);
  let box_tid = item::template_id(box_template);
  assert!(registry.tables.contains(box_tid), ENoTable);
  let entries = *registry.tables.borrow(box_tid); // local copy (≤ a handful of rows) — no borrow held across the burn
  assert!(!entries.is_empty(), ENoTable);
  let sum = total_weight(&entries);
  assert!(sum > 0, EZeroWeight);

  // BURN exactly one box unit from the opener's kiosk (re-mints the remainder as a fresh locked stack). The
  // passed `box_template` is asserted equal to the extracted item's template inside `consume_units`.
  gifting::burn_units(config, box_template, 1, box_item_id, kiosk, pkcap, xpolicy, market_policy, version, ctx);

  // ONE draw → deterministic weighted pick (draw ∈ [0, sum-1]; walk the cumulative windows).
  let rolled_template = pick(&entries, random::generate_u64_in_range(gen, 0, sum - 1));

  // Mint the SOULBOUND claim to the opener + emit (the mint is `claim_pet`'s job — 1-of-N cannot mint in-call).
  let opener = sender(ctx);
  event::emit(LootBoxOpened { box_template: box_tid, rolled_template, opener });
  transfer::transfer(PetBoxClaim { id: object::new(ctx), opener, box_template: box_tid, rolled_template }, opener);
}

// ╔════════════════ [ CLAIM (deterministic — mint the rolled pet, burn the claim) ] ═ ]

/// Redeem a claim: present the pet template the roll picked (its id must match the claim, `EClaimMismatch`), mint
/// the pet into your personal kiosk (kiosk-lock constitution — `mint_and_lock_output` mints ONE NFT for the
/// non-stackable pet category), and burn the claim. Only the claim's owner can call (owned object).
entry fun claim_pet(
  claim: PetBoxClaim,
  rolled_template: &ItemTemplate,
  config: &GameConfig,
  version: &Version,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  let PetBoxClaim { id, opener, box_template, rolled_template: rolled_tid } = claim;
  assert!(item::template_id(rolled_template) == rolled_tid, EClaimMismatch);
  character_link::mint_and_lock_output_brand(gifting::brand(), config, rolled_template, 1, version, kiosk, personal_kiosk::borrow(pkcap), policy, ctx);
  event::emit(PetClaimed { box_template, rolled_template: rolled_tid, opener });
  object::delete(id);
}

// ╔════════════════ [ Internals (pure) ] ═════════════════════════════════════ ]

/// A box is a consumable template carrying the reserved `KIND_GACHA_ROLL` effect — nothing else opens.
fun is_gacha_box(template: &ItemTemplate): bool {
  consumable_effect::has_effect(template)
    && consumable_effect::kind(consumable_effect::effect(template)) == consumable_effect::gacha_roll()
}

/// Total weight of a pool (the roll's denominator).
fun total_weight(entries: &vector<LootEntry>): u64 {
  let mut sum = 0;
  let mut i = 0;
  while (i < entries.length()) { sum = sum + entries.borrow(i).weight; i = i + 1; };
  sum
}

/// Walk the weighted pool: `draw` ∈ [0, sum) lands in the first row whose cumulative window contains it.
/// Deterministic given the draw. Caller guarantees a positive sum and `draw < sum`, so the loop always returns;
/// the trailing abort is unreachable (defends a future miscaller).
fun pick(entries: &vector<LootEntry>, draw: u64): ID {
  let mut cursor = 0;
  let mut i = 0;
  while (i < entries.length()) {
    let entry = entries.borrow(i);
    cursor = cursor + entry.weight;
    if (draw < cursor) return entry.template;
    i = i + 1;
  };
  abort EZeroWeight
}

// ╔════════════════ [ Reads (RPC + pre-flight) ] ═════════════════════════════ ]

public fun has_table(registry: &LootRegistry, box_template: ID): bool { registry.tables.contains(box_template) }

public fun table_rows(registry: &LootRegistry, box_template: ID): u64 { registry.tables.borrow(box_template).length() }

public fun table_weight_sum(registry: &LootRegistry, box_template: ID): u64 { total_weight(registry.tables.borrow(box_template)) }

/// The full weighted pool for a box (the frontend/RPC displays which pets drop at which odds).
public fun table_entries(registry: &LootRegistry, box_template: ID): &vector<LootEntry> { registry.tables.borrow(box_template) }

public fun entry_template(entry: &LootEntry): ID { entry.template }

public fun entry_weight(entry: &LootEntry): u64 { entry.weight }

public fun claim_opener(claim: &PetBoxClaim): address { claim.opener }

public fun claim_box(claim: &PetBoxClaim): ID { claim.box_template }

public fun claim_rolled(claim: &PetBoxClaim): ID { claim.rolled_template }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
/// Drive `open_box` through a deterministic test generator (no shared `Random` object needed).
public fun open_for_testing(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator_for_testing();
  open_internal(registry, kiosk, pkcap, box_item_id, box_template, xpolicy, market_policy, config, version, &mut gen, ctx);
}

#[test_only]
public fun test_pick(templates: vector<ID>, weights: vector<u64>, draw: u64): ID {
  let mut entries = vector[];
  let mut i = 0;
  while (i < templates.length()) { entries.push_back(LootEntry { template: *templates.borrow(i), weight: *weights.borrow(i) }); i = i + 1; };
  pick(&entries, draw)
}
