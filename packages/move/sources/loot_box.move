// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LOOT BOX — the gacha box (legacy port), GENERIC over item type: a box is a consumable template
/// carrying the 5th effect kind `GACHA`; opening it rolls on-chain randomness across a weighted pool
/// of ANY item templates (pets, gear, cosmetics, resources) and mints ONE. Two-phase, and WHY (the
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
/// The loot tables are CONTENT: authored in the seeding (`seed::set_loot_table`, SeedCap-gated)
/// and frozen with the rest — no live admin door post-seal.
module aresrpg::loot_box;

use aresrpg::{
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

const K_GACHA: u8 = 4; // the 5th consumable kind — a lootbox

const EEmptyTable: u64 = 2902; // an empty item pool is refused
const ELengthMismatch: u64 = 2903; // item_templates and weights differ in length
const EZeroWeight: u64 = 2904; // a pool whose total weight is zero can never roll
const ENotBox: u64 = 2905; // the template is not a gacha box, or the item is not that box
const ENoTable: u64 = 2906; // no loot table set for this box template
const EClaimMismatch: u64 = 2907; // claim_loot: the passed template is not the claim's rolled item

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One weighted row of a box's pool: the item template to mint on a hit + its RELATIVE weight
/// (basis is the row sum, so rows are addable/removable pre-seal without re-normalising).
public struct LootEntry has copy, drop, store { template: ID, weight: u64 }

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
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct LootTableSet has copy, drop { box_template: ID, rows: u64, weight_sum: u64 }

/// The reveal signal: the roll picked `rolled_template` (the mint follows in `claim_loot`).
public struct LootBoxOpened has copy, drop { box_template: ID, rolled_template: ID, opener: address }

public struct LootClaimed has copy, drop { box_template: ID, rolled_template: ID, opener: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(LootRegistry { id: object::new(ctx), tables: table::new(ctx) });
}

// ╔════════════════ [ Seeding authoring (seed.move gates, then calls) ] ══════ ]

/// Set (or replace, pre-seal) `box_template`'s weighted item pool from two PARALLEL vectors (a PTB
/// can't pass a vector of tuples). A zero-weight ROW is allowed (inert) as long as the SUM is
/// positive. The gate lives in the caller: `seed::set_loot_table` is `SeedCap`-gated, and the
/// SeedCap can only exist inside an open (Publisher-gated, pre-seal) seeding batch.
public(package) fun set_loot_table(
  registry: &mut LootRegistry,
  box_template: ID,
  item_templates: vector<ID>,
  weights: vector<u64>,
) {
  assert!(!item_templates.is_empty(), EEmptyTable);
  assert!(item_templates.length() == weights.length(), ELengthMismatch);
  let mut entries = vector[];
  let mut sum = 0;
  let mut i = 0;
  while (i < item_templates.length()) {
    let weight = weights[i];
    sum = sum + weight;
    entries.push_back(LootEntry { template: item_templates[i], weight });
    i = i + 1;
  };
  assert!(sum > 0, EZeroWeight);
  if (registry.tables.contains(box_template)) *registry.tables.borrow_mut(box_template) = entries
  else registry.tables.add(box_template, entries);
  event::emit(LootTableSet { box_template, rows: item_templates.length(), weight_sum: sum });
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

  let rolled_template = pick(&entries, gen.generate_u64_in_range(0, sum - 1));
  let opener = ctx.sender();
  event::emit(LootBoxOpened { box_template: box_tid, rolled_template, opener });
  transfer::transfer(BoxClaim { id: object::new(ctx), box_template: box_tid, rolled_template }, opener);
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
  let BoxClaim { id, box_template, rolled_template: rolled_tid } = claim;
  assert!(item::template_id(rolled_template) == rolled_tid, EClaimMismatch);
  let loot = item::mint(rolled_template, 1, gen, ctx); // any item type — stats roll here if it has ranges
  item::deposit(kiosk, cap, item_policy, existing, loot);
  event::emit(LootClaimed { box_template, rolled_template: rolled_tid, opener: ctx.sender() });
  id.delete();
}

// ╔════════════════ [ Internals (pure) ] ═════════════════════════════════════ ]

/// A box is a consumable template carrying the `GACHA` kind — nothing else opens.
fun is_gacha_box(template: &ItemTemplate): bool {
  item::template_category(template) == b"consumable".to_string()
    && { let (kind, _) = item::consumable_of(template); kind == K_GACHA }
}

fun total_weight(entries: &vector<LootEntry>): u64 {
  let mut sum = 0;
  let mut i = 0;
  while (i < entries.length()) { sum = sum + entries[i].weight; i = i + 1; };
  sum
}

/// Walk the weighted pool: `draw ∈ [0, sum)` lands in the first row whose cumulative window holds
/// it. Deterministic given the draw; the trailing abort is unreachable (caller ensures draw < sum).
fun pick(entries: &vector<LootEntry>, draw: u64): ID {
  let mut acc = 0;
  let mut i = 0;
  while (i < entries.length()) {
    acc = acc + entries[i].weight;
    if (draw < acc) return entries[i].template;
    i = i + 1;
  };
  abort EZeroWeight
}
