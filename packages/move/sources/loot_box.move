// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOOT BOX — the gacha box (legacy port), GENERIC over item type: a box is a consumable template
/// carrying the typed `LootBox` effect; opening it rolls on-chain randomness across a weighted pool
/// of ANY item templates (pets, equipment, resources). Each row authors an exact quantity.
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

use aresrpg_math::content_rules;
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use aresrpg_seed::item_rows::{Self, ItemTemplate};
use aresrpg::{
  consumable,
  item::{Self, Item, PM},
  protected_policy::AresRPG_TransferPolicy,
};
use aresrpg_math::loot_table::{Self, LootEntry};
use sui::{
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  table::{Self, Table},
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EBatchAmount: u64 = 2910;
const MAX_BOX_BATCH: u32 = 50;

const EZeroWeight: u64 = 2904; // a pool whose total weight is zero can never roll
const ENotBox: u64 = 2905; // the template is not a gacha box, or the item is not that box
const ENoTable: u64 = 2906; // no loot table set for this box template
const EClaimMismatch: u64 = 2907; // claim_loot: the passed template is not the claim's rolled item
const EZeroAmount: u64 = 2908; // every rolled row must mint at least one item
const EUnstackableAmount: u64 = 2909; // quantities above one require a stackable reward template

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

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
public struct LootBoxesOpened has copy, drop { box_template: ID, claim_ids: vector<ID> }

public struct LootBoxOpened has copy, drop { box_template: ID, rolled_template: ID, amount: u32, opener: address }

public struct LootClaimed has copy, drop { box_template: ID, rolled_template: ID, amount: u32, opener: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(LootRegistry { id: object::new(ctx), tables: table::new(ctx) });
}

// ╔════════════════ [ Seeding authoring (seed.move gates, then calls) ] ══════ ]

/// Add one validated reward row — a LIVING content door (AdminCap-gated, bumped through the
/// seed registry so `freeze_forever` closes it; pools are the RULED live-read: tuning applies
/// to owned boxes, the Dofus norm). Taking both templates by reference proves their IDs exist.
public fun add_loot_reward(
  cap: &AdminCap,
  root: &mut Registry,
  registry: &mut LootRegistry,
  box_template: &ItemTemplate,
  reward_template: &ItemTemplate,
  weight: u64,
  amount: u32,
  ctx: &TxContext,
) {
  assert!(is_gacha_box(box_template), ENotBox);
  assert!(amount > 0, EZeroAmount);
  assert!(amount == 1 || content_rules::is_stackable(&item_rows::template_category(reward_template)), EUnstackableAmount);
  let box_id = item_rows::template_id(box_template);
  let entry = loot_table::new_entry(item_rows::template_id(reward_template), weight, amount);
  if (registry.tables.contains(box_id)) registry.tables.borrow_mut(box_id).push_back(entry)
  else registry.tables.add(box_id, vector[entry]);
  let entries = registry.tables.borrow(box_id);
  event::emit(LootTableSet { box_template: box_id, rows: entries.length(), weight_sum: loot_table::total_weight(entries) });
  registry::bump(cap, root, b"loot_boxes".to_string(), item_rows::template_type(box_template), ctx);
}

/// Rebalance one box's whole pool in place — replace beats row surgery (modify/remove =
/// resetting the table, then adding the new rows in the same PTB).
public fun clear_loot_table(
  cap: &AdminCap,
  root: &mut Registry,
  registry: &mut LootRegistry,
  box_template: &ItemTemplate,
  ctx: &TxContext,
) {
  let box_id = item_rows::template_id(box_template);
  if (registry.tables.contains(box_id)) {
    let _: vector<loot_table::LootEntry> = registry.tables.remove(box_id);
  };
  registry::bump(cap, root, b"loot_boxes".to_string(), item_rows::template_type(box_template), ctx);
}

public(package) fun has_valid_table(registry: &LootRegistry, box_template: &ItemTemplate): bool {
  let box_id = item_rows::template_id(box_template);
  registry.tables.contains(box_id) && loot_table::total_weight(registry.tables.borrow(box_id)) > 0
}

public(package) fun assert_valid_box(registry: &LootRegistry, box_template: &ItemTemplate) {
  assert!(is_gacha_box(box_template), ENotBox);
  assert!(has_valid_table(registry, box_template), ENoTable);
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
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  open_boxes(registry, kiosk, cap, box_item_id, box_template, protected_item, 1, generator, ctx);
}

public(package) fun open_boxes(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  protected_item: &AresRPG_TransferPolicy<Item>,
  count: u32,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  assert!(count > 0 && count <= MAX_BOX_BATCH, EBatchAmount);
  assert!(is_gacha_box(box_template), ENotBox);
  let box_tid = item_rows::template_id(box_template);
  assert!(registry.tables.contains(box_tid), ENoTable);
  let entries = *registry.tables.borrow(box_tid); // local copy — no borrow held across the burn
  let sum = loot_table::total_weight(&entries);
  assert!(sum > 0, EZeroWeight);
  // the passed template must be the burned item's own
  assert!({ let it: &Item = kiosk.borrow(cap, box_item_id); it.template() } == box_tid, ENotBox);
  item::burn(kiosk, cap, protected_item, box_item_id, count, ctx);

  let mut claim_ids = vector[];
  count.do!(|_| {
    let picked = loot_table::pick(&entries, generator.generate_u64_in_range(0, sum - 1));
    let rolled_template = loot_table::template(&picked);
    let amount = loot_table::amount(&picked);
    let opener = ctx.sender();
    let id = object::new(ctx);
    claim_ids.push_back(object::uid_to_inner(&id));
    event::emit(LootBoxOpened { box_template: box_tid, rolled_template, amount, opener });
    transfer::transfer(BoxClaim { id, box_template: box_tid, rolled_template, amount }, opener);
  });
  event::emit(LootBoxesOpened { box_template: box_tid, claim_ids });
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
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  assert!(item_rows::template_id(rolled_template) == claim.rolled_template, EClaimMismatch);
  claim_batch(vector[claim], vector[item::prepare_plan(rolled_template, existing)], kiosk, cap, item_policy, generator, ctx);
}

/// Every claim is consumed in one terminal call; plans are authenticated before randomness.
public(package) fun claim_batch(
  mut claims: vector<BoxClaim>, mut plans: vector<PM>, kiosk: &mut Kiosk, cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>, generator: &mut RandomGenerator, ctx: &mut TxContext,
) {
  assert!(!claims.is_empty() && claims.length() <= (MAX_BOX_BATCH as u64), EBatchAmount);
  assert!(claims.length() == plans.length(), EClaimMismatch);
  claims.reverse();
  plans.reverse();
  while (!claims.is_empty()) {
    let BoxClaim { id, box_template, rolled_template, amount } = claims.pop_back();
    item::deliver_claim(plans.pop_back(), rolled_template, amount, kiosk, cap, item_policy, generator, ctx);
    event::emit(LootClaimed { box_template, rolled_template, amount, opener: ctx.sender() });
    id.delete();
  };
  claims.destroy_empty();
}

// ╔════════════════ [ Internals (pure) ] ═════════════════════════════════════ ]

// is_gacha_box
/// A box is a consumable template carrying the typed `LootBox` effect — nothing else opens.
fun is_gacha_box(template: &ItemTemplate): bool {
  {
    let effect = item_rows::consumable_effect(template);
    effect.is_some() && aresrpg_math::consumable_effect::is_loot_box(effect.borrow())
  }
}

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
