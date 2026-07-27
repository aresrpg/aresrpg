// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ITEM — the generic on-chain item base: pure DATA + package-private factories, ZERO game semantics and ZERO
/// authority plumbing. An `Item` is a minted NFT stamped with its blueprint (`template`) and the catalog slug
/// its art is keyed by (`item_type`); an `ItemTemplate` is the shared authoring blueprint. Meaning (categories,
/// stats, equip rules) lives in DATA and in the modules that own those decisions.
///
/// PLACEMENT-BY-RESPONSIBILITY: this module owns only what an item IS. It holds NO supply ledger (a supply cap
/// is the sale gate's concern — a future mob-loot gate mints with no cap at all), NO price, NO authority caps.
/// `y49` and `mint` are `public(package)` factories: the package's authoring surface (`admin`) and its
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
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest},
  tx_context::sender
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EPledgeMismatch: u64 = 101; // lock_in_kiosk: pledge id != item id
const ELevelTooLow: u64 = 102; // y50: character level below the template's required level
const ENotPersonalKiosk: u64 = 103; // lock_in_kiosk: destination kiosk is not PERSONAL (constitution)
const ENotStackable: u64 = 104; // y54/merge/split: the item's category does not stack (gear is a unique NFT)
const EZeroQuantity: u64 = 105; // y54/split: a stack (or split) must carry at least 1 unit
const ETemplateMismatch: u64 = 106; // merge: the two stacks are different templates
const ESplitTooLarge: u64 = 107; // split: take >= amount (a split must leave at least 1 unit in the source)

// House stackability rule (§10): consumable + resource + rune categories are FUNGIBLE — many units fold into one
// `amount`; every OTHER category is a unique NFT (`amount` always 1). Single-homed HERE: the item base owns "what
// an item is," including whether it stacks. `consumable_effect` reads `y56()` so the `consumable`
// slug lives in exactly ONE place. Growth: this rule is DATA-derived from the category string, never a per-item flag.
// RUNE joined 2026-07-11 (crush single-tx lane): Retro runes are fungible per family — the sibling forge
// package's `crush` (brand-gated mint door) mints
// them as STACKS (`y30`) and `scribe_rune` consumes UNITS off a stack; the live seed templates are
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
/// future equip/consume system asserts `character.level >= template.level` via `y50`, and `category`
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

// ╔════════════════ [ Display (media is a PATTERN keyed by item_type, never a struct field) ] ═ ]

/// Claims the `Publisher` and registers `Display<Item>` + `Display<ItemTemplate>`. Media lives ONLY in these
/// Display objects as an interpolation over the `item_type` slug — the art CDN is keyed by that catalog slug,
/// so both an item and its template resolve to the same art. The structs carry ZERO url/image fields. The
/// `Publisher` + both Display objects go to the publishing admin, who creates the transfer policy at ceremony time.
fun init(otw: ITEM, ctx: &mut TxContext) {
  let publisher = package::claim(otw, ctx);

  let item_keys = vector[utf8(b"name"), utf8(b"image_url"), utf8(b"description"), utf8(b"project_url")];
  let item_values = vector[
    utf8(b"{name}"),
    utf8(b"/assets/items/{item_type}.png"), // host-free relative form (jobs.js ASSET_BASE fallback); the walrus_display_step ceremony swaps this to the walrus by-quilt-id URL post-upload
    utf8(b"{description}"),
    utf8(b"https://aresrpg.world"),
  ];
  let mut item_display = display::new_with_fields<Item>(&publisher, item_keys, item_values, ctx);
  item_display.update_version();

  let tmpl_keys = vector[utf8(b"name"), utf8(b"image_url"), utf8(b"description"), utf8(b"project_url")];
  let tmpl_values = vector[
    utf8(b"{name}"),
    utf8(b"/assets/items/{item_type}.png"), // host-free relative form (jobs.js ASSET_BASE fallback); the walrus_display_step ceremony swaps this to the walrus by-quilt-id URL post-upload
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

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Create an `ItemTemplate` and RETURN it UNSHARED. Package-private: the public authoring path is
/// `admin::create_template`, which cap-/version-gates, attaches the typed stat/damage DFs, then `y51`s
/// it — all in one call so a template is published complete (one PTB). `item_type` is the catalog art slug.
public(package) fun y49(
  name: String,
  description: String,
  item_type: String,
  category: String,
  level: u16,
  ctx: &mut TxContext,
): ItemTemplate {
  ItemTemplate { id: object::new(ctx), name, description, item_type, category, level }
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// The single home for the LEVEL gate (you can't consume or equip an item below the level of the
/// character). `public(package)` so the future in-package equip/consume upgrade asserts through it — one place,
/// no re-derivation. Aborts (`ELevelTooLow`) when the character is under the template's required level.
public(package) fun y50(template: &ItemTemplate, character_level: u16) {
  assert!(character_level >= template.level, ELevelTooLow);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Emit `TemplateCreated` and SHARE the (now fully-authored) template, returning its id. Package-private — only
/// the authoring surface calls it, after any stat/damage DFs are attached.
public(package) fun y51(template: ItemTemplate): ID {
  let tid = object::id(&template);
  event::emit(TemplateCreated { template: tid, item_type: template.item_type });
  transfer::share_object(template);
  tid
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Emit `TemplateBurned` and DESTROY a template, deleting its shared object. Package-private — only the
/// authoring surface (`admin::burn_item_template`) calls it, AFTER the DF-owning modules (`item_stats` /
/// `item_damages` / `consumable_effect`) have detached their typed dynamic fields, so this UID delete orphans
/// nothing. Sui permits deleting a SHARED object passed BY VALUE: this unpacks the struct and `object::delete`s
/// its UID. Minted `Item`s are UNAFFECTED — an item snapshots its `template` as a plain `ID` (and `item_type` as
/// a `String`), never an object ref, so burning a template dangles no live item or sale.
public(package) fun y52(template: ItemTemplate) {
  let ItemTemplate { id, name: _, description: _, item_type, category: _, level: _ } = template;
  event::emit(TemplateBurned { template: id.to_inner(), item_type });
  object::delete(id);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Patch a template's display `name` + `description` IN PLACE — the ONLY mutator of these two fields after
/// creation. Package-private: the sole caller is `admin::set_template_name_description` (AdminCap + version gated).
/// Writes name + description ONLY; `item_type`/`category`/`level` and the typed stat/damage/effect DFs are
/// untouched (a stats/kind change is a re-author, never a rename). Because the shared object is edited in place its
/// ID is preserved — every minted `Item`, kiosk lock and drop-table ref that points at this template by `ID` stays
/// valid, and each minted item keeps its own mint-time name snapshot (immutable provenance). Only the template
/// Display + all FUTURE mints see the new name. Emits `TemplateRenamed`.
public(package) fun y53(template: &mut ItemTemplate, name: String, description: String) {
  template.name = name;
  template.description = description;
  event::emit(TemplateRenamed { template: object::id(template), name: template.name });
}

/// Mint ONE item from `template` (amount = 1) and RETURN it with a `LockPledge` that FORCES a same-PTB kiosk lock.
/// Package-private, NO cap, NO supply check: supply/price/pause are the sale gate's concern (`shop::buy`); a
/// future mob-loot gate would mint here under different rules. The GEAR door — kept `(template, ctx)` frozen so
/// its callers (`shop::buy` non-stackable branch, `extension::y29`) stay
/// clean; a stackable buys its N units through `y54`. Snapshots the template's `item_type` + `category`.
public(package) fun mint(template: &ItemTemplate, ctx: &mut TxContext): (Item, LockPledge) {
  let tid = object::id(template);
  let item = Item {
    id: object::new(ctx),
    template: tid,
    name: template.name,
    description: template.description,
    item_type: template.item_type,
    category: template.category,
    amount: 1,
  };
  let item_id = object::id(&item);
  event::emit(ItemMinted { item: item_id, template: tid, item_type: template.item_type, amount: 1 });
  (item, LockPledge { item_id })
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Mint ONE stackable item carrying `quantity` units — the FUNGIBLE door (resources / consumables). Aborts unless
/// the template's category STACKS (`ENotStackable` — gear is a unique NFT minted via `mint`, never a param change)
/// and `quantity >= 1` (`EZeroQuantity`). Package-private, reached by `shop::buy_many` (stackable branch) and the
/// cap-gated `extension::y30` (gather / pools). Returns the `LockPledge` — a stackable is personal-
/// kiosk-locked from birth like every item. Stackables carry NO stat ranges, so there is nothing to roll.
public(package) fun y54(template: &ItemTemplate, quantity: u64, ctx: &mut TxContext): (Item, LockPledge) {
  assert!(is_stackable_category(template.category), ENotStackable);
  assert!(quantity >= 1, EZeroQuantity);
  let tid = object::id(template);
  let item = Item {
    id: object::new(ctx),
    template: tid,
    name: template.name,
    description: template.description,
    item_type: template.item_type,
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
  let Item { id, template: _, name: _, description: _, item_type: _, category: _, amount } = b;
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
    description: a.description,
    item_type: a.item_type,
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
/// (`shop::buy` or `extension::y29`) already passed its gates in this very PTB.
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

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Build a `LockPledge` for an EXISTING item — the re-lock hot potato the `extract::unequip` path returns so the
/// game is TYPE-FORCED to personal-kiosk-lock the item it pulled off a character. Package-private, and a pledge is
/// inert alone: its only consumer is `lock_in_kiosk`, which matches it against the real item and forces a personal
/// kiosk. No new authority — it just re-imposes the lock constitution on an item that already left a kiosk.
public(package) fun y55(item_id: ID): LockPledge { LockPledge { item_id } }

/// DESTROY an item, deleting its object on-chain — the terminal of the CONSUME-extract flow (pool sell / crush /
/// pet feed). Package-private: only `extract::burn` (cap-gated) calls it, after reading `template`/`amount` for the
/// caller to credit. Any first-party DF still attached (a crushed gear's rolled-stats block, pet metadata) orphans
/// on delete — harmless (the item is gone) and unavoidable (the base can't enumerate another package's DF keys).
public(package) fun destroy(item: Item) {
  let Item { id, template: _, name: _, description: _, item_type: _, category: _, amount: _ } = item;
  object::delete(id);
}

// ╔════════════════ [ Stackability rule (single home — §10 house rule) ] ═════════ ]

/// The §10 house rule: consumable + resource + rune categories STACK (fungible units fold into one `amount`); every other
/// category is a unique NFT. PUBLIC so cross-package flows (merge/split eligibility, inventory UI) derive it the
/// SAME way from the category string — never a stored per-item flag (derive, don't copy). Single home of all three slugs.
public fun is_stackable_category(category: String): bool {
  category == CATEGORY_CONSUMABLE.to_string() || category == CATEGORY_RESOURCE.to_string() || category == CATEGORY_RUNE.to_string()
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// The `consumable` category slug, single-homed here. `consumable_effect::is_consumable` reads it so the literal
/// never drifts across the package (the effect-attach gate and the stackability rule share ONE source of the slug).
public(package) fun y56(): String { CATEGORY_CONSUMABLE.to_string() }

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

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Template UID access for the in-package stat/damage modules (they own the DATA shape, this module owns the
/// storage). `&mut UID` never leaves the package.
public(package) fun y57(self: &mut ItemTemplate): &mut UID { &mut self.id }

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
public(package) fun y58(self: &ItemTemplate): &UID { &self.id }

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun template(self: &Item): ID { self.template }

public fun name(self: &Item): String { self.name }

public fun item_type(self: &Item): String { self.item_type }

public fun category(self: &Item): String { self.category }

public fun amount(self: &Item): u64 { self.amount }

public fun template_id(self: &ItemTemplate): ID { object::id(self) }

public fun template_name(self: &ItemTemplate): String { self.name }

public fun template_item_type(self: &ItemTemplate): String { self.item_type }

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
  let (item, pledge) = y54(template, quantity, ctx);
  let LockPledge { item_id: _ } = pledge;
  item
}

#[test_only]
/// Mint a GHOST stack (amount = 0) — the ONLY way to obtain a zero-amount `Item`, since every production door
/// (`y54` / `split` / `merge`) keeps amount >= 1. Exists solely to drive `item_listing_rule` (the amount-0
/// sale block); bypasses the quantity assert on purpose. Snapshots the template identity like the real factories.
public fun mint_zero_stack_for_testing(template: &ItemTemplate, ctx: &mut TxContext): Item {
  Item {
    id: object::new(ctx),
    template: object::id(template),
    name: template.name,
    description: template.description,
    item_type: template.item_type,
    category: template.category,
    amount: 0,
  }
}

// ╔════════════════ [ merged from `lot_rule` — republish restructure #1287 ] ════ ]
const ELotInvalid: u64 = 120; // from `lot_rule` — merged-in codes get their own block so module+code stays unambiguous
const ELotWrongItem: u64 = 121; // from `lot_rule` — merged-in codes get their own block so module+code stays unambiguous

/// Witness identifying the rule in a `TransferPolicy<Item>` and its purchase receipts.
public struct LotRule has drop {}

/// Empty policy configuration: legal lots are immutable protocol constants in this module.
public struct LotConfig has drop, store {}

/// Attach this rule to the universal Item policy. `transfer_policy::add_rule` rejects a duplicate attachment.
public fun add_lot_rule(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(LotRule {}, policy, cap, LotConfig {});
}

/// Prove that `item` is the object named by `request` and, when it is stackable, carries a legal kiosk lot.
public fun prove_lot(item: &Item, request: &mut TransferRequest<Item>) {
  assert!(object::id(item) == transfer_policy::item(request), ELotWrongItem);

  if (is_stackable_category(category(item))) {
    let amount = amount(item);
    assert!(amount == 1 || amount == 10 || amount == 100 || amount == 1000, ELotInvalid);
  };

  transfer_policy::add_receipt(LotRule {}, request);
}

// ╔════════════════ [ merged from `item_listing_rule` — republish restructure ] ═ ]
// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const EListingZeroAmount: u64 = 130; // from `item_listing_rule` — merged-in codes get their own block so module+code stays unambiguous // prove_amount: the item being purchased carries 0 units (a ghost instance)
const EListingWrongItem: u64 = 131; // from `item_listing_rule` — merged-in codes get their own block so module+code stays unambiguous // prove_amount: the proven item is not the one being purchased (evasion guard)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The rule witness that authorises this policy rule (Mysten `royalty_rule::Rule` shape). `drop` only — it names
/// the rule to the framework's `add_rule` / `add_receipt`; it is never stored or transferred.
public struct ListingRule has drop {}

/// The rule's on-policy config — EMPTY on purpose: the gate reads the item's OWN amount at prove time, so nothing
/// is baked in here and no dial is needed. `store + drop` as the framework requires.
public struct ListingConfig has drop, store {}

// ╔════════════════ [ Creator action — ADD the rule (cap-gated; ceremony, while dark) ] ═ ]

/// Attach the zero-amount gate to the Item `policy`. Authority IS the `TransferPolicyCap<Item>` — the framework
/// `add_rule` asserts the cap matches the policy and that the rule is not already present. Mirrors
/// `royalty_rule::add` / `character_listing_rule::add`: one line, cap-gated, no runtime config.
public fun add_listing_rule(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(ListingRule {}, policy, cap, ListingConfig {});
}

// ╔════════════════ [ Buyer action — PROVE the amount is non-zero to unblock confirm_request ] ═ ]

/// Prove the purchased `item` carries at least 1 unit and add the receipt that unblocks `confirm_request`. Aborts
/// `EListingWrongItem` if the proven item is not the one being transferred (the evasion guard — a buyer cannot substitute
/// a different non-zero stack they own) and `EListingZeroAmount` if the item is a ghost (amount 0). Called by the
/// secondary-purchase PTB after `kiosk::purchase` hands over the item by value; the buyer already holds `&Item`.
public fun prove_listing_amount(item: &Item, request: &mut TransferRequest<Item>) {
  assert!(object::id(item) == transfer_policy::item(request), EListingWrongItem);
  assert!(amount(item) > 0, EListingZeroAmount);
  transfer_policy::add_receipt(ListingRule {}, request);
}
