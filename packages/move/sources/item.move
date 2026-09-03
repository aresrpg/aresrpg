// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Items ride IMMUTABLE templates: minted at addresses DERIVED from `item_type` (client
/// computes them offline — no indexer) and FROZEN forever by the one-time seeding that lives
/// in seed.move. This module is the RUNTIME: what an item IS, the rolling mint, the stack law,
/// and the package-private template internals only the defining module can own.
module aresrpg::item;

use aresrpg_seed::item_rows::{Self, ItemTemplate};
use aresrpg_math::{content_rules, item_damages::ItemDamages, item_stats::{Self, ItemStatistics}};
use std::string::String;
use sui::{
  derived_object,
  display_registry::{Self, DisplayRegistry},
  dynamic_field as dfield,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  package::{Self, Publisher},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENotStackable: u64 = 202;
const EWrongAmount: u64 = 203;
const EWrongTemplate: u64 = 204;
const EPlainNeedsRoll: u64 = 207; // mint_plain: a ranged template must roll — use `mint`
const EDistributionNeedsNeutralShape: u64 = 208;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A minted item. `name`/`item_type`/`category`/`level` are snapshotted from the template at
/// mint (Display interpolates the object's OWN fields — no template hop). `amount` > 1 only
/// for stackable categories; merge/split are the only writers.
public struct Item has key, store {
  id: UID,
  template: ID,
  name: String,
  item_type: String,
  category: String,
  level: u8,
  amount: u32,
}

/// An authenticated PTB-local mint value prepared from one immutable template before the
/// terminal Random call. Private fields prevent a caller from forging item facts.
public struct PM has drop {
  template: ID,
  name: String,
  item_type: String,
  category: String,
  level: u8,
  stats_min: vector<u16>,
  stats_max: vector<u16>,
  damages: vector<ItemDamages>,
  existing: Option<ID>,
}

/// One-time seal marker on the registry — its presence closes the seeding forever.

/// DF keys: authored stat RANGES on the template; the ROLLED block + damage snapshot on the item.
public struct StatsKey() has copy, drop, store;
public struct DamagesKey() has copy, drop, store;

// one time witness
public struct ITEM has drop {}

// ╔════════════════ [ init ] ═════════════════════════════════════════════════ ]

fun init(otw: ITEM, ctx: &mut TxContext) {
  transfer::public_transfer(package::claim(otw, ctx), ctx.sender());
}

/// Display V2, once post-publish through `admin::create_item_display`. Returns the cap.
public(package) fun create_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Item> {
  let (mut d, cap) = display_registry::new_with_publisher<Item>(registry, publisher, ctx);
  display_registry::set(&mut d, &cap, b"name".to_string(), b"{name}".to_string());
  display_registry::set(&mut d, &cap, b"link".to_string(), b"https://aresrpg.world".to_string());
  display_registry::set(
    &mut d,
    &cap,
    b"image_url".to_string(),
    b"https://aresrpg.world/item/{item_type}_hd.png".to_string(),
  );
  display_registry::set(&mut d, &cap, b"description".to_string(), b"Item from the AresRPG universe.".to_string());
  display_registry::set(&mut d, &cap, b"project_url".to_string(), b"https://aresrpg.world".to_string());
  display_registry::set(&mut d, &cap, b"creator".to_string(), b"AresRPG".to_string());
  display_registry::share(d);
  cap
}

// ╔════════════════ [ Seed internals (the seeding lives in seed.move) ] ══════ ]

public(package) fun prepare_plan(template: &ItemTemplate, existing: Option<ID>): PM {
  let has_stats = item_rows::has_stats(template);
  let stats_lo = if (has_stats) item_rows::stats_min(template).to_vector() else vector[];
  let stats_hi = if (has_stats) item_rows::stats_max(template).to_vector() else vector[];
  PM {
    template: item_rows::template_id(template),
    name: item_rows::template_name(template),
    item_type: item_rows::template_type(template),
    category: item_rows::template_category(template),
    level: item_rows::template_level(template),
    stats_min: stats_lo,
    stats_max: stats_hi,
    damages: item_rows::damage_lines(template),
    existing,
  }
}

/// Consume the exact rolled quantity of `wanted` through its authenticated blueprint. Stackable
/// items become one combined stack; non-stackable items become `total` distinct rolled objects.
public(package) fun deliver_drops(
  plan: &mut vector<PM>,
  wanted: &String,
  total: u32,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let mut i = 0;
  while (i < plan.length() && &plan[i].item_type != wanted) i = i + 1;
  // A missing authenticated template aborts on the vector bound before any transaction commits.
  let row = plan.remove(i);
  if (content_rules::is_stackable(&row.category)) {
    deposit(kiosk, cap, policy, row.existing, mint_from_plan(&row, total, generator, ctx));
  } else {
    let mut n = 0;
    while (n < total) {
      deposit(kiosk, cap, policy, option::none(), mint_from_plan(&row, 1, generator, ctx));
      n = n + 1;
    };
  };
}

// ╔════════════════ [ Package ] ══════════════════════════════════════════════ ]

/// Mint an item off a frozen template. `amount` > 1 requires a stackable category. THE ROLL LIVES
/// HERE (ruling 2026-08-09): when the template carries stat ranges, this boundary resolves each
/// stat uniformly through on-chain randomness before the one internal constructor runs.
public(package) fun mint(
  template: &ItemTemplate,
  amount: u32,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
): Item {
  let row = prepare_plan(template, option::none());
  mint_from_plan(&row, amount, generator, ctx)
}

fun mint_from_plan(row: &PM, amount: u32, generator: &mut RandomGenerator, ctx: &mut TxContext): Item {
  let stats = if (!row.stats_min.is_empty()) {
    let mut rolled = vector[];
    let mut i = 0;
    while (i < row.stats_min.length()) {
      rolled.push_back(generator.generate_u16_in_range(row.stats_min[i], row.stats_max[i]));
      i = i + 1;
    };
    option::some(item_stats::from_vector(rolled))
  } else option::none();
  mint_resolved_from_plan(row, amount, stats, ctx)
}

/// THE item constructor. Every supply source resolves an optional stat block, then lands here;
/// source identity cannot change the resulting Item shape.
fun mint_resolved_from_plan(
  row: &PM,
  amount: u32,
  stats: Option<ItemStatistics>,
  ctx: &mut TxContext,
): Item {
  assert!(amount >= 1, EWrongAmount);
  if (amount > 1) assert!(content_rules::is_stackable(&row.category), ENotStackable);
  let mut item = Item {
    id: object::new(ctx),
    template: row.template,
    name: row.name,
    item_type: row.item_type,
    category: row.category,
    level: row.level,
    amount,
  };
  if (stats.is_some()) dfield::add(&mut item.id, StatsKey(), stats.destroy_some());
  if (!row.damages.is_empty()) dfield::add(&mut item.id, DamagesKey(), row.damages);
  item
}

/// Mint WITHOUT a generator — legal only for templates that carry NO stat ranges (Mastery
/// rewards and runes). A ranged template MUST roll, so it aborts here — the rolling `mint`
/// is its only door.
public(package) fun mint_plain(template: &ItemTemplate, amount: u32, ctx: &mut TxContext): Item {
  assert!(!item_rows::has_stats(template), EPlainNeedsRoll);
  let row = prepare_plan(template, option::none());
  mint_resolved_from_plan(&row, amount, option::none(), ctx)
}

/// Distribution admits statless, damage-less items and one fixed-endpoint pet at a time.
/// A pet stores its eventual fully-fed endpoint, while `pet::scaled_stats` contributes neutral
/// live stats until feeding begins. Authoring rejects any voucher that redemption could not mint.
public(package) fun assert_distribution(template: &ItemTemplate, amount: u32) {
  let category = item_rows::template_category(template);
  let is_pet = category == b"pet".to_string();
  assert!(amount == 1 || content_rules::is_stackable(&category), ENotStackable);
  assert!(item_rows::damage_lines(template).is_empty(), EDistributionNeedsNeutralShape);
  if (is_pet) {
    assert!(item_rows::has_stats(template), EDistributionNeedsNeutralShape);
    assert!(item_rows::stats_min(template) == item_rows::stats_max(template), EDistributionNeedsNeutralShape);
  } else {
    assert!(!item_rows::has_stats(template), EDistributionNeedsNeutralShape);
  };
}

public(package) fun mint_distribution(template: &ItemTemplate, amount: u32, ctx: &mut TxContext): Item {
  assert_distribution(template, amount);
  let row = prepare_plan(template, option::none());
  let stats = if (item_rows::has_stats(template)) option::some(item_rows::stats_min(template)) else option::none();
  mint_resolved_from_plan(&row, amount, stats, ctx)
}

/// Land a minted stack in the owner's kiosk: MERGE into the presented existing stack
/// (owner 2026-08-10: a player who already holds the resource GROWS it — every mint door
/// obeys, no dust objects), or lock as a new object when none is presented. A wrong
/// `existing` id aborts on the borrow or the template check — it can never mis-merge.
public(package) fun deposit(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  existing: Option<ID>,
  minted: Item,
) {
  if (existing.is_some()) {
    let target: &mut Item = kiosk.borrow_mut(cap, *existing.borrow());
    target.merge(minted);
  } else {
    kiosk.lock(cap, policy, minted);
  }
}

/// Merge a whole stack into this one — same template only.
public(package) fun merge(self: &mut Item, item: Item) {
  assert!(content_rules::is_stackable(&self.category), ENotStackable);
  assert!(self.template == item.template, EWrongTemplate);
  self.amount = self.amount + item.amount;
  item.destroy();
}

public(package) fun split(self: &mut Item, amount: u32, ctx: &mut TxContext): Item {
  assert!(content_rules::is_stackable(&self.category), ENotStackable);
  assert!(amount >= 1, EWrongAmount);
  assert!(self.amount > amount, EWrongAmount);
  self.amount = self.amount - amount;
  Item {
    id: object::new(ctx),
    template: self.template,
    name: self.name,
    item_type: self.item_type,
    category: self.category,
    level: self.level,
    amount,
  }
}

public(package) fun destroy(self: Item) {
  let Item { id, .. } = self;
  id.delete();
}

/// Burn `amount` units off a kiosk-locked stack (pet feeding, consumables, craft inputs):
/// fewer than the stack holds decrements IN PLACE — the remainder never leaves the kiosk;
/// the whole stack extracts through the protected policy and dies. Returns the category so
/// the caller asserts what it burned. Over-burn aborts.
public(package) fun burn(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected: &aresrpg::protected_policy::AresRPG_TransferPolicy<Item>,
  id: ID,
  amount: u32,
  ctx: &mut TxContext,
): String {
  assert!(amount >= 1, EWrongAmount);
  let held = { let stack: &Item = kiosk.borrow(cap, id); stack.amount };
  assert!(amount <= held, EWrongAmount);
  if (amount < held) {
    let stack: &mut Item = kiosk.borrow_mut(cap, id);
    stack.amount = stack.amount - amount;
    stack.category
  } else {
    let stack: Item = protected.extract_from_kiosk(kiosk, cap, id, ctx);
    let category = stack.category;
    stack.destroy();
    category
  }
}

public(package) fun uid_mut(self: &mut Item): &mut UID {
  &mut self.id
}

public(package) fun uid(self: &Item): &UID {
  &self.id
}

// ╔════════════════ [ Reads ] ════════════════════════════════════════════════ ]

public fun template(self: &Item): ID { self.template }

public fun item_type(self: &Item): String { self.item_type }

public fun category(self: &Item): String { self.category }

public fun level(self: &Item): u8 { self.level }

public fun amount(self: &Item): u32 { self.amount }

public fun has_stats(self: &Item): bool { dfield::exists(&self.id, StatsKey()) }

public fun stats(self: &Item): ItemStatistics { *dfield::borrow(&self.id, StatsKey()) }

/// Overwrite the rolled block — the forgemagie scribe's one writer (the item already carries a
/// rolled block from mint; scribing replaces it). Aborts if the item was never rolled.
public(package) fun set_stats(self: &mut Item, stats: ItemStatistics) {
  *dfield::borrow_mut(&mut self.id, StatsKey()) = stats;
}

public fun has_damages(self: &Item): bool { dfield::exists(&self.id, DamagesKey()) }

public fun damages(self: &Item): vector<ItemDamages> { *dfield::borrow(&self.id, DamagesKey()) }

// ╔════════════════ [ Private ] ══════════════════════════════════════════════ ]

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ITEM {}, ctx) }

#[test_only]
public fun split_preserves_template_for_testing(ctx: &mut TxContext): bool {
  let template_uid = object::new(ctx);
  let template = template_uid.to_inner();
  template_uid.delete();
  let mut stack = Item {
    id: object::new(ctx),
    template,
    name: b"potion".to_string(),
    item_type: b"potion".to_string(),
    category: b"consumable".to_string(),
    level: 1,
    amount: 2,
  };
  let lot = stack.split(1, ctx);
  let preserved = lot.template == stack.template && lot.amount == 1 && stack.amount == 1;
  lot.destroy();
  stack.destroy();
  preserved
}

#[test_only]
public fun destroy_for_testing(item: Item) { item.destroy(); }
