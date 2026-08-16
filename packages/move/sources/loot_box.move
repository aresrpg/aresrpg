// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOOT BOX — the gacha box (legacy port), GENERIC over item type: a box is a consumable template
/// carrying the typed `LootBox` effect; opening it rolls on-chain randomness across a weighted pool
/// of ANY item templates (pets, gear, cosmetics, resources). Each row authors an exact quantity.
/// Two-phase, and WHY (the
/// same grind-safe shape as the crush):
///   • `open_box` (TERMINAL `&Random`): prove it's a gacha box + its table is set, BURN one box unit,
///     take ONE weighted draw, and mint a SOULBOUND `BoxClaim` recording the rolled item template.
///     The roll lands only in a transferred key-only object + an event — an in-tx composer cannot
///     read it, so it can't be observed-then-aborted for a free re-roll.
///   • `claim_loot` (TERMINAL `&Random`): present the claim + the now-known rolled template (its id
///     must match the claim), MINT one and burn the claim. If the item carries stat ranges (gear)
///     the stats ROLL here — terminal too, so THAT roll can't be re-rolled either.
/// The 1-of-N split exists because minting needs the TEMPLATE object and a call can't take a
/// `vector<&ItemTemplate>` — `open_box` learns WHICH item, `claim_loot` carries that one template.
///
/// The loot tables are CONTENT: authored row-by-row in the seeding (`seed::add_loot_reward`,
/// SeedCap-gated) and frozen with the rest — no live admin door post-seal.
module aresrpg::loot_box;

use aresrpg::{
  consumable,
  item::{Self, Item, ItemTemplate},
  protected_policy::AresRPG_TransferPolicy,
};
use sui::{
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  table::{Self, Table},
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EZeroWeight: u64 = 2904; // a pool whose total weight is zero can never roll
const ENotBox: u64 = 2905; // the template is not a gacha box, or the item is not that box
const ENoTable: u64 = 2906; // no loot table set for this box template
const EClaimMismatch: u64 = 2907; // claim_loot: the passed template is not the claim's rolled item
const EZeroAmount: u64 = 2908; // every rolled row must mint at least one item
const EUnstackableAmount: u64 = 2909; // quantities above one require a stackable reward template

#[test_only]
const ELengthMismatch: u64 = 2910;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One weighted row of a box's pool: the item template to mint on a hit + its RELATIVE weight
/// (basis is the row sum, so rows are addable/removable pre-seal without re-normalising).
public struct LootEntry has copy, drop, store { template: ID, weight: u64, amount: u32 }

/// The loot-table registry: box template id → its weighted item pool. Shared at init, seeded EMPTY.
public struct LootRegistry has key {
  id: UID,
  tables: Table<ID, vector<LootEntry>>,
}

/// The SOULBOUND claim minted by `open_box` (`key` only → non-transferable): records WHICH item the
/// roll picked. `claim_loot` redeems it (mint + kiosk-lock), then burns it — the roll can't be sold.
public struct BoxClaim has key {
  id: UID,
  box_template: ID,
  rolled_template: ID,
  amount: u32,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct LootTableSet has copy, drop { box_template: ID, rows: u64, weight_sum: u64 }

/// The reveal signal: the roll picked `rolled_template` (the mint follows in `claim_loot`).
public struct LootBoxOpened has copy, drop { box_template: ID, rolled_template: ID, amount: u32, opener: address }

public struct LootClaimed has copy, drop { box_template: ID, rolled_template: ID, amount: u32, opener: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(LootRegistry { id: object::new(ctx), tables: table::new(ctx) });
}

// ╔════════════════ [ Seeding authoring (seed.move gates, then calls) ] ══════ ]

/// Add one validated reward row. Taking both templates by reference proves that their IDs exist;
/// validating stackability here prevents a permanently unredeemable quantity from being sealed.
/// Zero-weight rows are inert and legal, but `has_valid_table` refuses an all-zero table at freeze.
public(package) fun add_loot_reward(
  registry: &mut LootRegistry,
  box_template: &ItemTemplate,
  reward_template: &ItemTemplate,
  weight: u64,
  amount: u32,
) {
  assert!(is_gacha_box(box_template), ENotBox);
  assert!(amount > 0, EZeroAmount);
  assert!(amount == 1 || item::template_is_stackable(reward_template), EUnstackableAmount);
  let box_id = item::template_id(box_template);
  let entry = LootEntry { template: item::template_id(reward_template), weight, amount };
  if (registry.tables.contains(box_id)) registry.tables.borrow_mut(box_id).push_back(entry)
  else registry.tables.add(box_id, vector[entry]);
  let entries = registry.tables.borrow(box_id);
  event::emit(LootTableSet { box_template: box_id, rows: entries.length(), weight_sum: total_weight(entries) });
}

public(package) fun has_valid_table(registry: &LootRegistry, box_template: &ItemTemplate): bool {
  let box_id = item::template_id(box_template);
  registry.tables.contains(box_id) && total_weight(registry.tables.borrow(box_id)) > 0
}

// ╔════════════════ [ OPEN — terminal &Random: burn, roll, mint the claim ] ══ ]

/// Burn one box unit and roll its pool into a soulbound claim. Every refusal fires before the burn.
public(package) fun open_box(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  protected_item: &AresRPG_TransferPolicy<Item>,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  assert!(is_gacha_box(box_template), ENotBox);
  let box_tid = item::template_id(box_template);
  assert!(registry.tables.contains(box_tid), ENoTable);
  let entries = *registry.tables.borrow(box_tid); // local copy — no borrow held across the burn
  let sum = total_weight(&entries);
  assert!(sum > 0, EZeroWeight);
  // the passed template must be the burned item's own
  assert!({ let it: &Item = kiosk.borrow(cap, box_item_id); it.template() } == box_tid, ENotBox);
  item::burn(kiosk, cap, protected_item, box_item_id, 1, ctx);

  let LootEntry { template: rolled_template, weight: _, amount } = pick(&entries, gen.generate_u64_in_range(0, sum - 1));
  let opener = ctx.sender();
  event::emit(LootBoxOpened { box_template: box_tid, rolled_template, amount, opener });
  transfer::transfer(BoxClaim { id: object::new(ctx), box_template: box_tid, rolled_template, amount }, opener);
}

// ╔════════════════ [ CLAIM — terminal &Random: mint the rolled item, burn claim ] ═ ]

/// Redeem a claim: present the item template the roll picked and MINT one of it — ANY category. Its
/// stats ROLL here if the template carries ranges (gear — which is why this stays terminal `&Random`,
/// grind-safe); a pet's authored max is fixed, a resource mints plainly. `existing` merges a STACKABLE
/// result into the player's held stack (no dust). Then burn the claim. Owner-only (the claim is soulbound).
public(package) fun claim_loot(
  claim: BoxClaim,
  rolled_template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let BoxClaim { id, box_template, rolled_template: rolled_tid, amount } = claim;
  assert!(item::template_id(rolled_template) == rolled_tid, EClaimMismatch);
  let loot = item::mint(rolled_template, amount, gen, ctx); // any item type — stats roll here if it has ranges
  item::deposit(kiosk, cap, item_policy, existing, loot);
  event::emit(LootClaimed { box_template, rolled_template: rolled_tid, amount, opener: ctx.sender() });
  id.delete();
}

// ╔════════════════ [ Internals (pure) ] ═════════════════════════════════════ ]

/// A box is a consumable template carrying the typed `LootBox` effect — nothing else opens.
fun is_gacha_box(template: &ItemTemplate): bool {
  consumable::is_loot_box(template)
}

fun total_weight(entries: &vector<LootEntry>): u64 {
  let mut sum = 0;
  let mut i = 0;
  while (i < entries.length()) { sum = sum + entries[i].weight; i = i + 1; };
  sum
}

/// Walk the weighted pool: `draw ∈ [0, sum)` lands in the first row whose cumulative window holds
/// it. Deterministic given the draw; the trailing abort is unreachable (caller ensures draw < sum).
fun pick(entries: &vector<LootEntry>, draw: u64): LootEntry {
  let mut acc = 0;
  let mut selected = entries[0];
  let mut i = 0;
  while (i < entries.length()) {
    let at_or_after_start = draw >= acc;
    acc = acc + entries[i].weight;
    let before_end = draw < acc;
    // Equality is true only inside this row's half-open window. Both comparisons run for every
    // row and exactly one assignment runs for every valid draw: selected position cannot alter gas.
    if (at_or_after_start == before_end) selected = entries[i];
    i = i + 1;
  };
  selected
}

#[test_only]
public fun test_pick(
  item_templates: vector<ID>,
  weights: vector<u64>,
  amounts: vector<u32>,
  draw: u64,
): (ID, u32) {
  assert!(item_templates.length() == weights.length() && weights.length() == amounts.length(), ELengthMismatch);
  let mut entries = vector[];
  let mut i = 0;
  while (i < item_templates.length()) {
    entries.push_back(LootEntry { template: item_templates[i], weight: weights[i], amount: amounts[i] });
    i = i + 1;
  };
  let LootEntry { template, weight: _, amount } = pick(&entries, draw);
  (template, amount)
}
