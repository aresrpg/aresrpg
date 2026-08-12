// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Items ride IMMUTABLE templates: minted at addresses DERIVED from `item_type` (client
/// computes them offline — no indexer) and FROZEN forever by the one-time seeding that lives
/// in seed.move. This module is the RUNTIME: what an item IS, the rolling mint, the stack law,
/// and the package-private template internals only the defining module can own.
module aresrpg::item;

use aresrpg_math::{item_damages::ItemDamages, item_stats::{Self, ItemStatistics}};
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

const EWrongCategory: u64 = 201;
const ENotStackable: u64 = 202;
const EWrongAmount: u64 = 203;
const EWrongTemplate: u64 = 204;
const EStackableStats: u64 = 205; // set_template_*: a stackable carries no stats/damages
const EPlainNeedsRoll: u64 = 207; // mint_plain: a ranged template must roll — use `mint`
const EInvalidStatRange: u64 = 206; // set_template_stats: a min above its max would poison every mint, forever
const EBadConsumable: u64 = 208; // set_template_consumable: kind out of the sealed 0..4 range

/// The consumable effect kinds: 0 heal · 1 reset-stat-points · 2 reset-spell-points ·
/// 3 teleport-to-center · 4 GACHA (a lootbox — opened via `loot_box`, never the plain `consume`).
const CONSUMABLE_KINDS: u8 = 5;

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

/// The frozen content blueprint. Stat ranges / damages / effects attach as dynamic fields by
/// their own modules BEFORE `freeze_template` seals it — frozen objects accept nothing more.
public struct ItemTemplate has key {
  id: UID,
  name: String,
  item_type: String,
  category: String,
  level: u8,
}

/// Derivation root for template addresses — one claim per `item_type`, duplicates abort.
public struct TemplateRegistry has key {
  id: UID,
}

/// One-time seal marker on the registry — its presence closes the seeding forever.
public struct SealedKey() has copy, drop, store;

/// DF keys: authored stat RANGES on the template; the ROLLED block + damage snapshot on the item.
public struct StatsMinKey() has copy, drop, store;
public struct StatsMaxKey() has copy, drop, store;
public struct StatsKey() has copy, drop, store;
public struct DamagesKey() has copy, drop, store;
public struct ConsumableKey() has copy, drop, store;

/// A consumable's authored effect, frozen on its template. `kind` in the sealed 0..3 set.
public struct ConsumableEffect has copy, drop, store { kind: u8, power: u32 }

// one time witness
public struct ITEM has drop {}

public struct TemplateCreated has copy, drop { template: ID, item_type: String }

// ╔════════════════ [ init ] ═════════════════════════════════════════════════ ]

fun init(otw: ITEM, ctx: &mut TxContext) {
  transfer::share_object(TemplateRegistry { id: object::new(ctx) });
  transfer::public_transfer(package::claim(otw, ctx), ctx.sender());
}

/// Display V2, once post-publish through `admin::create_item_display`. Returns the cap.
public(package) fun new_display(
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

/// Sibling content modules (mob_template) derive under the SAME registry with their own
/// typed keys — one seeding, one seal, no slug collisions.
public(package) fun registry_uid_mut(registry: &mut TemplateRegistry): &mut UID {
  &mut registry.id
}

/// Is the seeding closed forever?
public fun is_sealed(registry: &TemplateRegistry): bool {
  dfield::exists(&registry.id, SealedKey())
}

/// Write the eternal seal — a second call aborts on the duplicate field.
public(package) fun seal(registry: &mut TemplateRegistry) {
  dfield::add(&mut registry.id, SealedKey(), true);
}

/// Mint a template at the address derived from its `item_type` — a second mint of the same
/// type aborts. NOT a hot potato (a potato can't become an object): `key` WITHOUT `store` is
/// the force — no transfer, no wrapping, no dynamic-field storage, and the only public
/// consumer is `freeze_template`. An unconsumed template fails the whole transaction.
public(package) fun new_template(
  registry: &mut TemplateRegistry,
  name: String,
  item_type: String,
  category: String,
  level: u8,
): ItemTemplate {
  verify_category(category);
  let template = ItemTemplate {
    id: derived_object::claim(&mut registry.id, item_type),
    name,
    item_type,
    category,
    level,
  };
  event::emit(TemplateCreated { template: template.id.to_inner(), item_type: template.item_type });
  template
}

/// Seeding: author the stat RANGES on a hot template. Possession IS the authorization — only
/// the seeding ever holds a template `&mut` (frozen right after). Gear only; every min ≤ its
/// max is asserted HERE, before the freeze can seal a poisoned range.
public(package) fun set_template_stats(template: &mut ItemTemplate, min: ItemStatistics, max: ItemStatistics) {
  assert!(!is_stackable(template.category), EStackableStats);
  let (lo, hi) = (min.to_vector(), max.to_vector());
  let mut i = 0;
  while (i < lo.length()) {
    assert!(lo[i] <= hi[i], EInvalidStatRange);
    i = i + 1;
  };
  dfield::add(&mut template.id, StatsMinKey(), min);
  dfield::add(&mut template.id, StatsMaxKey(), max);
}

/// Seeding: author the damage lines on a hot template (weapons). Same possession law.
public(package) fun set_template_damages(template: &mut ItemTemplate, lines: vector<ItemDamages>) {
  assert!(!is_stackable(template.category), EStackableStats);
  dfield::add(&mut template.id, DamagesKey(), lines);
}

/// Seeding: author a CONSUMABLE's effect on a hot template — `kind` in 0..3 (heal,
/// reset-stats, reset-spells, teleport-center), `power` its magnitude (hp for heal, 0 else).
/// The consume door reads it; the resolver lives in `consumable.move`.
public(package) fun set_template_consumable(template: &mut ItemTemplate, kind: u8, power: u32) {
  assert!(template.category == b"consumable".to_string(), EWrongCategory);
  assert!(kind < CONSUMABLE_KINDS, EBadConsumable);
  dfield::add(&mut template.id, ConsumableKey(), ConsumableEffect { kind, power });
}

public fun consumable_of(template: &ItemTemplate): (u8, u32) {
  let e: &ConsumableEffect = dfield::borrow(&template.id, ConsumableKey());
  (e.kind, e.power)
}

/// Seal a template forever — the chain rejects every future write, from anyone.
public(package) fun freeze_template(template: ItemTemplate) {
  transfer::freeze_object(template);
}

// ╔════════════════ [ Package ] ══════════════════════════════════════════════ ]

/// Mint an item off a frozen template — the only item factory. Consumers (gathering, shop,
/// drops, crafting) call through. `amount` > 1 requires a stackable category. THE ROLL LIVES
/// HERE (ruling 2026-08-09): when the template carries stat ranges, the mint itself rolls each
/// stat uniformly through on-chain randomness — unskippable; damage lines snapshot verbatim.
public(package) fun mint(
  template: &ItemTemplate,
  amount: u32,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
): Item {
  let mut item = mint_base(template, amount, ctx);
  if (dfield::exists(&template.id, StatsMinKey())) {
    let lo: &ItemStatistics = dfield::borrow(&template.id, StatsMinKey());
    let hi: &ItemStatistics = dfield::borrow(&template.id, StatsMaxKey());
    let (lo_v, hi_v) = (lo.to_vector(), hi.to_vector());
    let mut rolled = vector[];
    let mut i = 0;
    while (i < lo_v.length()) {
      rolled.push_back(gen.generate_u16_in_range(lo_v[i], hi_v[i]));
      i = i + 1;
    };
    dfield::add(&mut item.id, StatsKey(), item_stats::from_vector(rolled));
  };
  item
}

/// Mint WITHOUT a generator — legal only for templates that carry NO stat ranges (shop
/// sales, airdrops, giftcards: owner 2026-08-10, "no stats there"). A ranged template MUST
/// roll, so it aborts here — the rolling `mint` is its only door.
public(package) fun mint_plain(template: &ItemTemplate, amount: u32, ctx: &mut TxContext): Item {
  assert!(!dfield::exists(&template.id, StatsMinKey()), EPlainNeedsRoll);
  mint_base(template, amount, ctx)
}

/// The shared factory: the snapshot Item + the damage-line copy. `mint` adds the stat roll
/// on top; `mint_plain` stops here (stat-less by assertion). ONE Item construction home.
fun mint_base(template: &ItemTemplate, amount: u32, ctx: &mut TxContext): Item {
  assert!(amount >= 1, EWrongAmount);
  if (amount > 1) assert!(is_stackable(template.category), ENotStackable);
  let mut item = Item {
    id: object::new(ctx),
    template: template.id.to_inner(),
    name: template.name,
    item_type: template.item_type,
    category: template.category,
    level: template.level,
    amount,
  };
  if (dfield::exists(&template.id, DamagesKey())) {
    let lines: &vector<ItemDamages> = dfield::borrow(&template.id, DamagesKey());
    dfield::add(&mut item.id, DamagesKey(), *lines);
  };
  item
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
  assert!(is_stackable(self.category), ENotStackable);
  assert!(self.template == item.template, EWrongTemplate);
  self.amount = self.amount + item.amount;
  item.destroy();
}

/// Split `amount` units into a fresh stack — never empties the source. The marketplace
/// listing seam: a lot-rule listing (1/10/100/1000) splits off the seller's big stack.
public(package) fun split(self: &mut Item, amount: u32, ctx: &mut TxContext): Item {
  assert!(is_stackable(self.category), ENotStackable);
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

public fun template_id(template: &ItemTemplate): ID { template.id.to_inner() }

public fun template_type(template: &ItemTemplate): String { template.item_type }

public fun template_category(template: &ItemTemplate): String { template.category }

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

/// The template's authored MAX block — the forgemagie scribe reads it as the proximity ceiling.
public fun template_max_stats(template: &ItemTemplate): ItemStatistics {
  *dfield::borrow(&template.id, StatsMaxKey())
}

public fun has_damages(self: &Item): bool { dfield::exists(&self.id, DamagesKey()) }

public fun damages(self: &Item): vector<ItemDamages> { *dfield::borrow(&self.id, DamagesKey()) }

/// The craft/forgery job that owns a gear or weapon category — the FROZEN 1.29 category map (seed
/// SPEC §6). ONE home (owner 2026-08-11): crafting DERIVES a gear recipe's job here — never
/// seed-authored — and forgemagie's scribe gate reads the SAME map, so a longsword is
/// `SWORD_SMITH` for both and the two can never drift. `none` = the job is not category-derivable
/// (consumables split across alchemist/baker), and those recipes carry an authored job.
public fun craft_job_of(category: String): Option<String> {
  if (category == b"longsword".to_string() || category == b"sword".to_string() || category == b"daggers".to_string()) option::some(b"SWORD_SMITH".to_string())
  else if (category == b"axe".to_string() || category == b"battleaxe".to_string()) option::some(b"AXE_SMITH".to_string())
  else if (category == b"club".to_string() || category == b"mace".to_string()) option::some(b"BLUNT_SMITH".to_string())
  else if (category == b"staff".to_string() || category == b"spellbook".to_string()) option::some(b"STAFF_CARVER".to_string())
  else if (category == b"bow".to_string() || category == b"spear".to_string()) option::some(b"BOWYER".to_string())
  else if (category == b"helmet".to_string() || category == b"chestplate".to_string()) option::some(b"ARMORSMITH".to_string())
  else if (category == b"pants".to_string() || category == b"boots".to_string()) option::some(b"TAILOR".to_string())
  else if (category == b"belt".to_string() || category == b"gauntlets".to_string()) option::some(b"TANNER".to_string())
  else if (category == b"ring".to_string() || category == b"amulet".to_string()) option::some(b"JEWELER".to_string())
  else if (category == b"key".to_string()) option::some(b"HANDYMAN".to_string())
  else option::none()
}

/// Stackability is DERIVED from the category — never a stored flag.
public fun is_stackable(category: String): bool {
  category == b"consumable".to_string() ||
  category == b"resource".to_string() ||
  category == b"rune".to_string() ||
  category == b"pet_food".to_string()
}

// ╔════════════════ [ Private ] ══════════════════════════════════════════════ ]

/// The reconciled category law: gear slots + cosmetics + the 11 weapon families + the 3
/// gathering tools (dedicated tool slot — never the weapon slot) + the fungibles. No mount.
fun verify_category(category: String) {
  assert!(
    // gear
    category == b"helmet".to_string() ||
    category == b"chestplate".to_string() ||
    category == b"belt".to_string() ||
    category == b"gauntlets".to_string() ||
    category == b"pants".to_string() ||
    category == b"boots".to_string() ||
    category == b"amulet".to_string() ||
    category == b"ring".to_string() ||
    category == b"pet".to_string() ||
    category == b"relic".to_string() ||
    // cosmetics
    category == b"title".to_string() ||
    category == b"hat".to_string() ||
    category == b"cloak".to_string() ||
    // weapon families
    category == b"longsword".to_string() ||
    category == b"daggers".to_string() ||
    category == b"battleaxe".to_string() ||
    category == b"spear".to_string() ||
    category == b"staff".to_string() ||
    category == b"spellbook".to_string() ||
    category == b"bow".to_string() ||
    category == b"axe".to_string() ||
    category == b"mace".to_string() ||
    category == b"club".to_string() ||
    category == b"sword".to_string() ||
    // gathering tools
    category == b"tool_farmer".to_string() ||
    category == b"tool_herbalist".to_string() ||
    category == b"tool_miner".to_string() ||
    // the stackable fungibles (consumable/resource/rune/pet_food — one home: `is_stackable`)
    is_stackable(category) ||
    category == b"key".to_string(),
    EWrongCategory,
  );
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ITEM {}, ctx) }
