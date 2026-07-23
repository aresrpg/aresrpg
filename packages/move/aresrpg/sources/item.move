// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ITEM — the generic on-chain item base: pure DATA + package-private factories, ZERO game semantics and ZERO
/// authority plumbing. An `Item` is a minted NFT stamped with its blueprint (`template`) and the catalog slug
/// its art is keyed by (`item_type`); an `ItemTemplate` is the shared authoring blueprint. Meaning (categories,
/// stats, equip rules) lives in DATA and in the modules that own those decisions.
///
/// PLACEMENT-BY-RESPONSIBILITY: this module owns only what an item IS. It holds NO supply ledger (a supply cap
/// is the sale gate's concern — a future mob-loot gate mints with no cap at all), NO price, NO authority caps.
/// `new_template` and `mint` are `public(package)` factories: the package's authoring surface (`admin`) and its
/// sale gate (`shop`) call them; nothing outside the package can mint. The module boundary IS the security
/// boundary.
///
/// LOCK-PLEDGE CONSTITUTION (type-enforced): `mint` returns a `LockPledge` hot potato with NO abilities. The
/// ONLY function that consumes it is `lock_in_kiosk`, which asserts the pledge matches the item and locks it
/// under the `TransferPolicy<Item>`. A minter therefore CANNOT leave a fresh item unlocked — the type system
/// forces a same-PTB kiosk lock. There is NO address-delivery path anywhere in this package.
module aresrpg::item;

use aresrpg::version::Version;
use kiosk::personal_kiosk;
use std::string::{utf8, String};
use sui::{
  display,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  package::{Self, Publisher},
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap},
  tx_context::sender
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EPledgeMismatch: u64 = 101; // lock_in_kiosk: pledge id != item id
const ELevelTooLow: u64 = 102; // assert_usable_by: character level below the template's required level
const ENotPersonalKiosk: u64 = 103; // lock_in_kiosk: destination kiosk is not PERSONAL (constitution)
const ENotStackable: u64 = 104; // mint_stack/merge/split: the item's category does not stack (gear is a unique NFT)
const EZeroQuantity: u64 = 105; // mint_stack/split: a stack (or split) must carry at least 1 unit
const ETemplateMismatch: u64 = 106; // merge: the two stacks are different templates
const ESplitTooLarge: u64 = 107; // split: take >= amount (a split must leave at least 1 unit in the source)

// House stackability rule (§10): consumable + resource + rune categories are FUNGIBLE — many units fold into one
// `amount`; every OTHER category is a unique NFT (`amount` always 1). Single-homed HERE: the item base owns "what
// an item is," including whether it stacks. `consumable_effect` reads `category_consumable()` so the `consumable`
// slug lives in exactly ONE place. Growth: this rule is DATA-derived from the category string, never a per-item flag.
// RUNE joined 2026-07-11 (crush single-tx lane): Retro runes are fungible per family — the sibling forge
// package's `crush` (brand-gated mint door) mints
// them as STACKS (`mint_item_stack`) and `scribe_rune` consumes UNITS off a stack; the live seed templates are
// category `rune`, so without this membership every crush mint aborted `ENotStackable` (latent, test-masked).
const CATEGORY_CONSUMABLE: vector<u8> = b"consumable";
const CATEGORY_RESOURCE: vector<u8> = b"resource";
const CATEGORY_RUNE: vector<u8> = b"rune";

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A minted item instance. `template` = the blueprint it was stamped from; `item_type` = the catalog slug the
/// art CDN is keyed by, SNAPSHOTTED from the template at mint so `Display` resolves without hopping objects and
/// so it stands as immutable provenance. No supply/serial/stack fields — an item is a unique NFT here.
public struct Item has key, store {
  id: UID,
  template: ID,
  // Snapshotted from the template at mint (the Display name IS the exact English item name, and
  // Display can only interpolate the object's own fields — it cannot hop to the template).
  name: String,
  item_type: String,
  // R4 (owner "option A", 2026-07-23): the PER-VARIANT art slug — snapshotted from the template at mint like
  // name. `item_type` is a shared SLOT word (many variants), so the icon Display keyed on `{item_type}` emitted
  // one generic art per class; `{icon}` is the discriminating per-item slug the CDN art is actually keyed by.
  icon: String,
  // Snapshotted at mint like name (Display interpolates the object's OWN fields — no template hop).
  description: String,
  // Also snapshotted at mint: dispatch (equip slot / consume / burn / stackability) reads the category off the
  // item directly, no hop to the shared template — same rationale as name/item_type.
  category: String,
  // Fungible amount: ALWAYS 1 for a non-stackable category (unique NFT); a stackable item (consumable/resource)
  // carries N units in ONE object. Only `merge` (adds) and `split` (subtracts) change it — no other write path.
  amount: u64,
}

/// A shared authoring blueprint: a display `name`, the `item_type` catalog slug, the `category` (validated at
/// creation against the admin-editable `catalog` whitelist), and the required `level`. The descriptive game-data
/// (stat RANGES / damages / consumable effect) rides as TYPED DYNAMIC FIELDS attached at creation by `item_stats`
/// / `item_damages` / `consumable_effect` under this template's UID — the item base owns the STORAGE, those
/// modules own the DATA SHAPE (placement law). `category` + `level` are MANDATORY base fields: a
/// future equip/consume system asserts `character.level >= template.level` via `assert_usable_by`, and `category`
/// is the differentiator every such system dispatches on (gear slot, tool job, consumable…). NO supply ledger
/// (the sale gate's concern), NO media fields (art is a Display-only URL keyed by `item_type`). `key` only —
/// shared, never transferable/wrappable.
public struct ItemTemplate has key {
  id: UID,
  name: String,
  // Per-template flavor text (2026-07-12 fresh-publish rider: struct fields can never be ADDED by upgrade —
  // tonight was the only moment). Display interpolates it; external marketplaces render it.
  description: String,
  item_type: String,
  // R4: the per-variant art slug (see `Item.icon`) — the source of every minted item's snapshotted `icon`, and
  // the field the template's own `{icon}` Display resolves. Set at creation from the corpus row's slug.
  icon: String,
  category: String,
  level: u16,
}

/// The lock-pledge HOT POTATO — NO abilities (no drop/store/key). Carries the id of the item that must be
/// locked. The only consumer is `lock_in_kiosk`; because it cannot be dropped, stored, or transferred, the
/// compiler forces every minted item into a kiosk in the same PTB.
public struct LockPledge { item_id: ID }

/// One-Time Witness — claims the package `Publisher` at publish for Display + the `TransferPolicy<Item>` seam.
public struct ITEM has drop {}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct TemplateCreated has copy, drop { template: ID, item_type: String }

/// Emitted when a template is burned (deleted on-chain). Minted items are UNAFFECTED — since `shop::buy` rolls
/// stats AT PURCHASE, every sold item is already fully self-contained (its rolled block is on the item itself),
/// so a burn only retires the template for FUTURE sales and dangles nothing live. (This eliminates the old
/// sealed-item soft-rug: there is no "sold but unrevealed" state to brick.)
public struct TemplateBurned has copy, drop { template: ID, item_type: String }

/// Emitted when a template's display `name` (+ `description`) is patched IN PLACE by the AdminCap door
/// (`admin::set_template_name_description`) — an owner-canon correction that preserves the template object ID, so
/// the /v1 indexer re-projects the new name without a re-mint. Carries the NEW name (indexers key on `template`).
public struct TemplateRenamed has copy, drop { template: ID, name: String }

public struct ItemMinted has copy, drop { item: ID, template: ID, item_type: String, amount: u64 }

/// A stackable `from` folded into `into` (from deleted). `added` = units moved; `total` = `into`'s new amount.
public struct ItemMerged has copy, drop { into: ID, from: ID, added: u64, total: u64 }

/// `take` units split off `from` into the new item `into`; `remaining` = `from`'s amount after the split.
public struct ItemSplit has copy, drop { from: ID, into: ID, take: u64, remaining: u64 }

public struct ItemPolicyCreated has copy, drop { policy: ID }

// ╔════════════════ [ Display (media is a PATTERN keyed by the per-variant `icon` slug) ] ═ ]

/// Claims the `Publisher` and registers `Display<Item>` + `Display<ItemTemplate>`. Media lives in these Display
/// objects as an interpolation over the `icon` field (R4) — the art CDN is keyed by that PER-VARIANT slug, so an
/// item resolves its own art on external explorers (the URL is ABSOLUTE, not host-relative). The `Publisher` +
/// both Display objects go to the publishing admin, who creates the transfer policy at ceremony time.
fun init(otw: ITEM, ctx: &mut TxContext) {
  let publisher = package::claim(otw, ctx);

  let item_keys = vector[utf8(b"name"), utf8(b"image_url"), utf8(b"description"), utf8(b"project_url")];
  let item_values = vector[
    utf8(b"{name}"),
    utf8(b"https://assets.aresrpg.world/items/{icon}.png"), // R4: ABSOLUTE (external explorers have no app host) + the PER-VARIANT `{icon}` slug (not the shared `{item_type}` slot word) so each item resolves its own art
    utf8(b"{description}"),
    utf8(b"https://aresrpg.world"),
  ];
  let mut item_display = display::new_with_fields<Item>(&publisher, item_keys, item_values, ctx);
  item_display.update_version();

  let tmpl_keys = vector[utf8(b"name"), utf8(b"image_url"), utf8(b"description"), utf8(b"project_url")];
  let tmpl_values = vector[
    utf8(b"{name}"),
    utf8(b"https://assets.aresrpg.world/items/{icon}.png"), // R4: ABSOLUTE (external explorers have no app host) + the PER-VARIANT `{icon}` slug (not the shared `{item_type}` slot word) so each item resolves its own art
    utf8(b"{description}"),
    utf8(b"https://aresrpg.world"),
  ];
  let mut tmpl_display = display::new_with_fields<ItemTemplate>(&publisher, tmpl_keys, tmpl_values, ctx);
  tmpl_display.update_version();

  transfer::public_transfer(publisher, sender(ctx));
  transfer::public_transfer(item_display, sender(ctx));
  transfer::public_transfer(tmpl_display, sender(ctx));
}

// ╔════════════════ [ Factories (package-private — only `admin` authors, only the sale gate mints) ] ═ ]

/// Create an `ItemTemplate` and RETURN it UNSHARED. Package-private: the public authoring path is
/// `admin::create_template`, which cap-/version-gates, attaches the typed stat/damage DFs, then `share_template`s
/// it — all in one call so a template is published complete (one PTB). `item_type` is the catalog art slug.
public(package) fun new_template(
  name: String,
  description: String,
  item_type: String,
  icon: String,
  category: String,
  level: u16,
  ctx: &mut TxContext,
): ItemTemplate {
  ItemTemplate { id: object::new(ctx), name, description, item_type, icon, category, level }
}

/// The single home for the LEVEL gate (you can't consume or equip an item below the level of the
/// character). `public(package)` so the future in-package equip/consume upgrade asserts through it — one place,
/// no re-derivation. Aborts (`ELevelTooLow`) when the character is under the template's required level.
public(package) fun assert_usable_by(template: &ItemTemplate, character_level: u16) {
  assert!(character_level >= template.level, ELevelTooLow);
}

/// Emit `TemplateCreated` and SHARE the (now fully-authored) template, returning its id. Package-private — only
/// the authoring surface calls it, after any stat/damage DFs are attached.
public(package) fun share_template(template: ItemTemplate): ID {
  let tid = object::id(&template);
  event::emit(TemplateCreated { template: tid, item_type: template.item_type });
  transfer::share_object(template);
  tid
}

/// Emit `TemplateBurned` and DESTROY a template, deleting its shared object. Package-private — only the
/// authoring surface (`admin::burn_item_template`) calls it, AFTER the DF-owning modules (`item_stats` /
/// `item_damages` / `consumable_effect`) have detached their typed dynamic fields, so this UID delete orphans
/// nothing. Sui permits deleting a SHARED object passed BY VALUE: this unpacks the struct and `object::delete`s
/// its UID. Minted `Item`s are UNAFFECTED — an item snapshots its `template` as a plain `ID` (and `item_type` as
/// a `String`), never an object ref, so burning a template dangles no live item or sale.
public(package) fun destroy_template(template: ItemTemplate) {
  let ItemTemplate { id, name: _, description: _, item_type, icon: _, category: _, level: _ } = template;
  event::emit(TemplateBurned { template: id.to_inner(), item_type });
  object::delete(id);
}

/// Patch a template's display `name` + `description` IN PLACE — the ONLY mutator of these two fields after
/// creation. Package-private: the sole caller is `admin::set_template_name_description` (AdminCap + version gated).
/// Writes name + description ONLY; `item_type`/`category`/`level` and the typed stat/damage/effect DFs are
/// untouched (a stats/kind change is a re-author, never a rename). Because the shared object is edited in place its
/// ID is preserved — every minted `Item`, kiosk lock and drop-table ref that points at this template by `ID` stays
/// valid, and each minted item keeps its own mint-time name snapshot (immutable provenance). Only the template
/// Display + all FUTURE mints see the new name. Emits `TemplateRenamed`.
public(package) fun set_name_description(template: &mut ItemTemplate, name: String, description: String) {
  template.name = name;
  template.description = description;
  event::emit(TemplateRenamed { template: object::id(template), name: template.name });
}

/// Mint ONE item from `template` (amount = 1) and RETURN it with a `LockPledge` that FORCES a same-PTB kiosk lock.
/// Package-private, NO cap, NO supply check: supply/price/pause are the sale gate's concern (`shop::buy`); a
/// future mob-loot gate would mint here under different rules. The GEAR door — kept `(template, ctx)` frozen so
/// its callers (`shop::buy` non-stackable branch, `extension::mint_item`) stay
/// clean; a stackable buys its N units through `mint_stack`. Snapshots the template's `item_type` + `category`.
public(package) fun mint(template: &ItemTemplate, ctx: &mut TxContext): (Item, LockPledge) {
  let tid = object::id(template);
  let item = Item {
    id: object::new(ctx),
    template: tid,
    name: template.name,
    item_type: template.item_type,
    icon: template.icon, // R4: snapshot the per-variant art slug
    description: template.description,
    category: template.category,
    amount: 1,
  };
  let item_id = object::id(&item);
  event::emit(ItemMinted { item: item_id, template: tid, item_type: template.item_type, amount: 1 });
  (item, LockPledge { item_id })
}

/// Mint ONE stackable item carrying `quantity` units — the FUNGIBLE door (resources / consumables). Aborts unless
/// the template's category STACKS (`ENotStackable` — gear is a unique NFT minted via `mint`, never a param change)
/// and `quantity >= 1` (`EZeroQuantity`). Package-private, reached by `shop::buy_many` (stackable branch) and the
/// cap-gated `extension::mint_item_stack` (gather / pools). Returns the `LockPledge` — a stackable is personal-
/// kiosk-locked from birth like every item. Stackables carry NO stat ranges, so there is nothing to roll.
public(package) fun mint_stack(template: &ItemTemplate, quantity: u64, ctx: &mut TxContext): (Item, LockPledge) {
  assert!(is_stackable_category(template.category), ENotStackable);
  assert!(quantity >= 1, EZeroQuantity);
  let tid = object::id(template);
  let item = Item {
    id: object::new(ctx),
    template: tid,
    name: template.name,
    item_type: template.item_type,
    icon: template.icon, // R4: snapshot the per-variant art slug
    description: template.description,
    category: template.category,
    amount: quantity,
  };
  let item_id = object::id(&item);
  event::emit(ItemMinted { item: item_id, template: tid, item_type: template.item_type, amount: quantity });
  (item, LockPledge { item_id })
}

/// Fold stack `b` into stack `a` (same stackable template) and DELETE `b`. Package-private — merging owned/kiosk
/// stacks is a future game flow (a cap-gated wrapper), but the building block is proven here now. Aborts unless
/// both are the SAME template (`ETemplateMismatch`) AND the category STACKS (`ENotStackable` — two identical gear
/// NFTs never merge). `b` is a stackable (same template ⇒ same category ⇒ no rolled-stats DF), so deleting its UID
/// orphans nothing.
public(package) fun merge(a: &mut Item, b: Item) {
  assert!(a.template == b.template, ETemplateMismatch);
  assert!(is_stackable_category(a.category), ENotStackable);
  let into_id = object::id(a);
  let Item { id, template: _, name: _, item_type: _, icon: _, description: _, category: _, amount } = b;
  a.amount = a.amount + amount;
  event::emit(ItemMerged { into: into_id, from: id.to_inner(), added: amount, total: a.amount });
  object::delete(id);
}

/// Split `take` units off stack `a` into a NEW item, returned with its own `LockPledge` forcing a personal-kiosk
/// lock. Package-private. Aborts unless `a` STACKS (`ENotStackable`), `take >= 1` (`EZeroQuantity`), and
/// `take < a.amount` (`ESplitTooLarge` — a split must LEAVE at least one unit in `a`, so it never zeroes the
/// source into a zombie). The new item snapshots `a`'s template identity + category.
public(package) fun split(a: &mut Item, take: u64, ctx: &mut TxContext): (Item, LockPledge) {
  assert!(is_stackable_category(a.category), ENotStackable);
  assert!(take >= 1, EZeroQuantity);
  assert!(take < a.amount, ESplitTooLarge);
  a.amount = a.amount - take;
  let item = Item {
    id: object::new(ctx),
    template: a.template,
    name: a.name,
    item_type: a.item_type,
    icon: a.icon, // R4: the split inherits the source stack's per-variant art slug
    description: a.description,
    category: a.category,
    amount: take,
  };
  let item_id = object::id(&item);
  event::emit(ItemSplit { from: object::id(a), into: item_id, take, remaining: a.amount });
  (item, LockPledge { item_id })
}

/// The ONLY consumer of a `LockPledge`. Asserts the pledge matches `item` AND that the destination `kiosk` is
/// PERSONAL (ruling R-C2 — the kiosk-lock constitution is NOT weaker for items: a transferable `KioskOwnerCap`
/// on a shared kiosk is exactly the royalty-evasion / wholesale path the personal-kiosk law kills), then locks
/// it under `policy`. Composes freely: a kiosk-less minter can `kiosk::new` → `personal_kiosk::new` earlier in
/// the same PTB and lock here. No version/enabled gate — a live pledge can only exist because a mint door
/// (`shop::buy` or `extension::mint_item`) already passed its gates in this very PTB.
public fun lock_in_kiosk(
  pledge: LockPledge,
  item: Item,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
) {
  let LockPledge { item_id } = pledge;
  assert!(item_id == object::id(&item), EPledgeMismatch);
  assert!(personal_kiosk::is_personal(kiosk), ENotPersonalKiosk);
  kiosk.lock(cap, policy, item);
}

// ╔════════════════ [ Re-lock pledge + destroy — the extract seam's two package-private primitives ] ═ ]

/// Build a `LockPledge` for an EXISTING item — the re-lock hot potato the `extract::unequip` path returns so the
/// game is TYPE-FORCED to personal-kiosk-lock the item it pulled off a character. Package-private, and a pledge is
/// inert alone: its only consumer is `lock_in_kiosk`, which matches it against the real item and forces a personal
/// kiosk. No new authority — it just re-imposes the lock constitution on an item that already left a kiosk.
public(package) fun new_lock_pledge(item_id: ID): LockPledge { LockPledge { item_id } }

/// DESTROY an item, deleting its object on-chain — the terminal of the CONSUME-extract flow (pool sell / crush /
/// pet feed). Package-private: only `extract::burn` (cap-gated) calls it, after reading `template`/`amount` for the
/// caller to credit. Any first-party DF still attached (a crushed gear's rolled-stats block, pet metadata) orphans
/// on delete — harmless (the item is gone) and unavoidable (the base can't enumerate another package's DF keys).
public(package) fun destroy(item: Item) {
  let Item { id, template: _, name: _, item_type: _, icon: _, description: _, category: _, amount: _ } = item;
  object::delete(id);
}

// ╔════════════════ [ Stackability rule (single home — §10 house rule) ] ═════════ ]

/// The §10 house rule: consumable + resource + rune categories STACK (fungible units fold into one `amount`); every other
/// category is a unique NFT. PUBLIC so cross-package flows (merge/split eligibility, inventory UI) derive it the
/// SAME way from the category string — never a stored per-item flag (derive, don't copy). Single home of all three slugs.
public fun is_stackable_category(category: String): bool {
  category == CATEGORY_CONSUMABLE.to_string() || category == CATEGORY_RESOURCE.to_string() || category == CATEGORY_RUNE.to_string()
}

/// The `consumable` category slug, single-homed here. `consumable_effect::is_consumable` reads it so the literal
/// never drifts across the package (the effect-attach gate and the stackability rule share ONE source of the slug).
public(package) fun category_consumable(): String { CATEGORY_CONSUMABLE.to_string() }

// ╔════════════════ [ Kiosk / royalty seam — Publisher gated ] ═════════════════ ]

/// Create the `TransferPolicy<Item>` for the marketplace (version-gated; authority IS the `Publisher`). Kept
/// GENERIC: it returns the policy + its cap so the ceremony composes the binding — the kiosk-lock rule and the
/// royalty rule are added later by their external rules packages using the returned `TransferPolicyCap<Item>`.
/// This package deliberately binds NO rule itself and depends on no rules package. The publishing admin shares the policy
/// and keeps the cap in custody.
public fun create_item_policy(
  publisher: &Publisher,
  version: &Version,
  ctx: &mut TxContext,
): (TransferPolicy<Item>, TransferPolicyCap<Item>) {
  version.assert_latest();
  let (policy, cap) = transfer_policy::new<Item>(publisher, ctx);
  event::emit(ItemPolicyCreated { policy: object::id(&policy) });
  (policy, cap)
}

// ╔════════════════ [ UID access — the extension seam (&mut UID never leaves the package) ] ═ ]
// `uid_mut` is PACKAGE-PRIVATE and never widens: the in-package `item_stats` attaches the rolled block through
// it, and the in-package `aresrpg::extension` module reaches it to serve the cap-gated, namespace-scoped
// cross-package writes the SEPARATE `aresrpg_game` package needs (hp/jobs/pet-power/scribe). Because the
// adopted topology splits progression into a different package, a bare `uid_mut` is provably not enough (it
// cannot be called across the package boundary) — the `extension` cap gate is the required seam (ruling R-C1;
// the old "no capability-gated module needed" note here was void once character/progression split packages).
// `uid` is PUBLIC: `&UID` is read-only, so any package or off-chain reader inspects attached fields for free —
// only the `&mut UID` write path is gated.

public(package) fun uid_mut(self: &mut Item): &mut UID { &mut self.id }

public fun uid(self: &Item): &UID { &self.id }

/// The mint-snapshotted flavor text (2026-07-12 rider — Display interpolates the same field).
public fun description(self: &Item): String { self.description }

/// The template's flavor text (copied onto every mint).
public fun template_description(self: &ItemTemplate): String { self.description }

/// Template UID access for the in-package stat/damage modules (they own the DATA shape, this module owns the
/// storage). `&mut UID` never leaves the package.
public(package) fun template_uid_mut(self: &mut ItemTemplate): &mut UID { &mut self.id }

public(package) fun template_uid(self: &ItemTemplate): &UID { &self.id }

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun template(self: &Item): ID { self.template }

public fun name(self: &Item): String { self.name }

public fun item_type(self: &Item): String { self.item_type }

public fun icon(self: &Item): String { self.icon } // R4: the per-variant art slug

public fun category(self: &Item): String { self.category }

public fun amount(self: &Item): u64 { self.amount }

public fun template_id(self: &ItemTemplate): ID { object::id(self) }

public fun template_name(self: &ItemTemplate): String { self.name }

public fun template_item_type(self: &ItemTemplate): String { self.item_type }

public fun template_icon(self: &ItemTemplate): String { self.icon } // R4: the per-variant art slug

public fun template_category(self: &ItemTemplate): String { self.category }

public fun template_level(self: &ItemTemplate): u16 { self.level }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ITEM {}, ctx) }

#[test_only]
/// Mint a RAW item (the lock pledge discarded) for unit tests that drive the fungible primitives (merge / split /
/// amount / destroy) in isolation — the lock constitution itself is proven by the real mint→lock tests.
public fun mint_for_testing(template: &ItemTemplate, ctx: &mut TxContext): Item {
  let (item, pledge) = mint(template, ctx);
  let LockPledge { item_id: _ } = pledge;
  item
}

#[test_only]
/// Mint a RAW stackable of `quantity` units (pledge discarded) — same test-only escape as `mint_for_testing`.
public fun mint_stack_for_testing(template: &ItemTemplate, quantity: u64, ctx: &mut TxContext): Item {
  let (item, pledge) = mint_stack(template, quantity, ctx);
  let LockPledge { item_id: _ } = pledge;
  item
}

#[test_only]
/// Mint a GHOST stack (amount = 0) — the ONLY way to obtain a zero-amount `Item`, since every production door
/// (`mint_stack` / `split` / `merge`) keeps amount >= 1. Exists solely to drive `item_listing_rule` (the amount-0
/// sale block); bypasses the quantity assert on purpose. Snapshots the template identity like the real factories.
public fun mint_zero_stack_for_testing(template: &ItemTemplate, ctx: &mut TxContext): Item {
  Item {
    id: object::new(ctx),
    template: object::id(template),
    name: template.name,
    item_type: template.item_type,
    icon: template.icon,
    description: template.description,
    category: template.category,
    amount: 0,
  }
}
