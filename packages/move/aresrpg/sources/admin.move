// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ADMIN — the ONE public authoring surface + the package authority model. A single SUPER `AdminCap` (never
/// expires) is minted at publish to the publishing admin; it can mint short-lived TEMP admin caps that expire at the next
/// epoch (≈24h), so day-to-day authoring runs from a throwaway cap while the root key stays cold.
///
/// PLACEMENT-BY-RESPONSIBILITY: every public authoring call lives HERE, each `verify`-gated (the cap is active
/// for the current epoch) + version-gated. It reaches into `item` and `version` through their package-private
/// factories/setters. No cap registry, no revocation ledger — the epoch IS the expiry; the super cap is the
/// root of trust. This module imports `item` + `version`; neither imports it, so there is no cycle.
module aresrpg::admin;

use aresrpg::{consumable_effect::{Self, ConsumableEffect}, item, item_damages::{Self, ItemDamages}, item_stats::{Self, ItemStatistics}, version::Version};
use std::string::String;
use sui::{event, table::{Self, Table}, tx_context::sender};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EAdminCapExpired: u64 = 101; // a temp cap was used after its epoch
const ESuperAdmin: u64 = 102; // delete_admin_cap: the super cap cannot be destroyed
const ENotSuperAdmin: u64 = 103; // mint_temp_admin_cap: only the super cap may mint temp caps
const EUnknownCategory: u64 = 104; // create_template: category is not in the catalog whitelist
const EStatsRangeMismatch: u64 = 105; // create_template: stats_min / stats_max must be both-or-neither
const EEffectNotConsumable: u64 = 106; // create_template: a consumable effect on a non-consumable category
const EStackableHasRanges: u64 = 107; // create_template: a stackable category (consumable/resource) may not carry stat ranges

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The package authority. `epoch = none` → the SUPER cap: minted once at publish, never expires, the sole
/// minter of temp caps. `epoch = some(e)` → a TEMP cap valid only during epoch `e` (expires the next epoch).
/// Possession is authority; `verify` enforces the epoch bound.
public struct AdminCap has key, store {
  id: UID,
  epoch: Option<u64>,
}

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: option::none() }, sender(ctx));
  // the category whitelist is born here too — `catalog` merged in at the republish restructure (#1287), and
  // Move allows exactly one `init` per module. Seeded EMPTY; the cap holder whitelists while the package is dark.
  transfer::share_object(Catalog { id: object::new(ctx), categories: table::new(ctx) });
}

// ╔════════════════ [ Temp cap lifecycle ] ═══════════════════════════════════ ]

/// Mint a TEMP admin cap (valid only THIS epoch) to `recipient`. Only the SUPER cap may call this
/// (`ENotSuperAdmin`) — a temp cap cannot mint further temp caps, bounding a leaked temp cap's blast radius.
public fun mint_temp_admin_cap(super: &AdminCap, recipient: address, ctx: &mut TxContext) {
  assert!(super.epoch.is_none(), ENotSuperAdmin);
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: option::some(ctx.epoch()) }, recipient);
}

/// Destroy a temp admin cap. NOT verified — an EXPIRED cap must still be deletable for cleanup. The SUPER cap
/// cannot be destroyed (`ESuperAdmin`), so the root authority can never be accidentally burned.
entry fun delete_admin_cap(cap: AdminCap) {
  assert!(cap.epoch.is_some(), ESuperAdmin);
  let AdminCap { id, epoch: _ } = cap;
  object::delete(id);
}

// ╔════════════════ [ Authority check (called by the authoring fns) ] ════════ ]

/// Abort unless `cap` is authorized RIGHT NOW: the super cap always passes; a temp cap must be used during its
/// own epoch (`EAdminCapExpired` otherwise). PUBLIC since the 2026-07-12 forge split: a pure liveness ASSERTION
/// over a cap the caller already HOLDS (possession is the authority — this grants nothing), so sibling feature
/// packages' own AdminCap-gated doors can verify the same cap.
public fun verify(cap: &AdminCap, ctx: &TxContext) {
  if (cap.epoch.is_some()) {
    assert!(*cap.epoch.borrow() == ctx.epoch(), EAdminCapExpired);
  };
}

// ╔════════════════ [ Authoring interface (cap + version gated) ] ════════════ ]

/// Create + SHARE an `ItemTemplate` with its typed game-data, returning its id. Version-gated (assert_latest)
/// only — the admin cap holder authors the catalog while dark. `category` MUST be in the `catalog` whitelist (`EUnknownCategory`)
/// and `level` is the mandatory usable-level. `item_type` is the art slug; `stats_min`/`stats_max`
/// (17 centered-u16 fields each) are the [min,max] ROLL RANGES `shop::buy` draws from at purchase — BOTH-or-NEITHER
/// (`EStatsRangeMismatch`; none for resources/consumables). `damages` (fixed weapon lines) and a consumable
/// `effect` (attachable ONLY when `category == consumable`, `EEffectNotConsumable`) ride as typed DFs. Everything
/// is attached BEFORE the template is shared — a template is published complete in ONE call (one PTB: build the
/// ranges + damages + effect, then this).
public fun create_template(
  cap: &AdminCap,
  catalog: &Catalog,
  name: String,
  description: String,
  item_type: String,
  category: String,
  level: u16,
  stats_min: Option<ItemStatistics>,
  stats_max: Option<ItemStatistics>,
  damages: vector<ItemDamages>,
  effect: Option<ConsumableEffect>,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  cap.verify(ctx);
  version.assert_latest();
  assert!(catalog.contains(category), EUnknownCategory);
  // Stackable categories (consumable/resource) are FUNGIBLE units — they carry no stat ranges (nothing to roll).
  // Reject at AUTHORING (root cause) so a stackable-with-ranges template can never exist; `shop::buy` re-asserts.
  if (item::is_stackable_category(category)) assert!(stats_min.is_none() && stats_max.is_none(), EStackableHasRanges);

  let mut template = item::new_template(name, description, item_type, category, level, ctx);

  // Stat ranges: BOTH-or-NEITHER — a gear template carries [min,max]; a resource/consumable carries none.
  if (stats_min.is_some() && stats_max.is_some()) {
    item_stats::attach_ranges(&mut template, stats_min.destroy_some(), stats_max.destroy_some());
  } else {
    assert!(stats_min.is_none() && stats_max.is_none(), EStatsRangeMismatch);
    stats_min.destroy_none();
    stats_max.destroy_none();
  };

  if (!damages.is_empty()) item_damages::attach(&mut template, damages)
  else damages.destroy_empty();

  // Consumable effect (the on-chain home for heal): attachable ONLY on the `consumable` category.
  if (effect.is_some()) {
    assert!(consumable_effect::is_consumable(category), EEffectNotConsumable);
    consumable_effect::attach(&mut template, effect.destroy_some());
  } else {
    effect.destroy_none();
  };

  item::share_template(template)
}

/// BURN a template: delete its shared object on-chain (on-chain deletion only — the
/// off-chain seed JSON is never touched by this). Version-gated (assert_latest) + AdminCap-gated, MIRRORING
/// `create_template` — the admin cap holder prunes the catalog while dark or live. Detaches the typed DFs (stat ranges /
/// damages / consumable effect) through their owning modules first (each value has `drop`), then destroys the
/// template struct via the package-private `item::destroy_template`, which unpacks it and `object::delete`s the
/// UID (Sui allows deleting a shared object passed BY VALUE). Emits `TemplateBurned`.
///
/// SAFETY: minted `Item`s and shop `Sale`s reference a template by a plain `ID` copy (and items snapshot
/// `item_type` as a `String`), NEVER by object ref — so burning dangles nothing live. And because `shop::buy`
/// rolls stats AT PURCHASE (single-step), every SOLD item is already fully self-contained (its rolled block lives
/// on the item), so a burn cannot brick it. There is NO "sold but unrevealed" state — the old sealed-item
/// soft-rug is gone. A burn only closes the template to FUTURE sales.
public fun burn_item_template(cap: &AdminCap, mut template: item::ItemTemplate, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  item_stats::drop_ranges(&mut template);
  item_damages::drop_damages(&mut template);
  consumable_effect::drop_effect(&mut template);
  item::destroy_template(template);
}

/// PATCH a live template's display `name` + `description` IN PLACE — the canonical name/description correction
/// door (a joke name minted into a shared `ItemTemplate` is fixed here WITHOUT a re-mint). Version-gated
/// (assert_latest) + AdminCap-gated, MIRRORING `create_template`/`burn_item_template`; reaches the shared template
/// through the package-private `item::set_name_description`, which writes ONLY those two fields and emits
/// `TemplateRenamed`. NOTHING else is touchable — `item_type`/`category`/`level` and the typed stat/damage/effect
/// DFs are immutable here (a stats/category change is a re-author, not a rename). Patches in place, so the template
/// object ID is preserved: every minted item, kiosk lock and drop-table ref that points at it stays valid.
///
/// UPGRADE-COMPAT: an ADDITIVE public fn on the upgraded package — legal under the COMPATIBLE policy (a new
/// function, no existing signature changed). This is the on-chain door that unblocks the name-restoration patch.
public fun set_template_name_description(
  cap: &AdminCap,
  template: &mut item::ItemTemplate,
  name: String,
  description: String,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  item::set_name_description(template, name, description);
}

/// Replace a live, non-stackable template's complete 17-slot [min,max] stat payload IN PLACE. The scalar arity
/// mirrors the release seeder's retired 34-value payload (all 17 mins, then all 17 maxes), so one PTB call updates
/// one template without constructing intermediate stat blocks off-chain. Version-gated + AdminCap-gated exactly
/// like the other authoring doors, and preserves the template object ID. Existing item rolls are immutable;
/// future mints roll from the replacement ranges.
///
/// This door intentionally has no `pods`/`heal` arguments: `pods` is absent from the deployed stat shape, while
/// heal is a separate typed `consumable_effect` DF on stackable consumables; stackable templates cannot carry stat
/// ranges (`EStackableHasRanges`). No base template field, damage line, or consumable effect is touched.
///
/// UPGRADE-COMPAT: additive public function only; no existing type or signature changes.
public fun set_template_stats(
  cap: &AdminCap,
  template: &mut item::ItemTemplate,
  min: ItemStatistics,
  max: ItemStatistics,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(!item::is_stackable_category(item::template_category(template)), EStackableHasRanges);
  item_stats::set_ranges(template, min, max);
}

/// Replace a live template's COMPLETE set of damage lines IN PLACE — the weapon re-magnitude door. `damages` is the
/// full replacement (not a merge): whatever lines the template carried are gone, and exactly these remain. An empty
/// vector CLEARS the lines, landing the template in the same state `create_template` gives an empty `damages`
/// argument. Version-gated + AdminCap-gated exactly like the other authoring doors, and it patches through
/// `item_damages::set_damages` so the template object ID is preserved — every minted item, kiosk lock and drop-table
/// ref that points at it stays valid.
///
/// SCOPE: the TEMPLATE's authored truth only. An already-equipped weapon keeps the snapshot `equipment::equip` copied
/// onto its instance (`ItemLinesKey`); re-equipping re-reads the template, so the correction reaches live gear the
/// same way a stat re-roll does. No base field, stat range or consumable effect is touched here.
///
/// UPGRADE-COMPAT: additive public function only; no existing type or signature changes.
public fun set_template_damages(
  cap: &AdminCap,
  template: &mut item::ItemTemplate,
  damages: vector<ItemDamages>,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  item_damages::set_damages(template, damages);
}

// ╔════════════════ [ Catalog control (AdminCap + version gated — authoring runs while dark) ] ═ ]

/// Whitelist an item category (`sword`, `ring`, `consumable`, `tool_farmer`, …). The category set is OPEN-ENDED
/// data (job tools are categories too) — cap-gated and editable, never a hardcoded enum. Aborts (table dup) if present.
public fun add_category(cap: &AdminCap, catalog: &mut Catalog, category: String, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  catalog.add(category);
}

/// Remove a category from the whitelist. Blocks FUTURE templates from authoring it; existing templates keep their
/// snapshotted category. Aborts (table) if absent.
public fun remove_category(cap: &AdminCap, catalog: &mut Catalog, category: String, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  catalog.remove(category);
}

// ╔════════════════ [ Version / enabled control ] ════════════════════════════ ]

/// Flip the master ENABLED switch (launch = `true`, emergency stop = `false`). Cap-gated but NOT version-gated
/// so an emergency stop always works.
public fun admin_set_enabled(cap: &AdminCap, version: &mut Version, enabled: bool, ctx: &TxContext) {
  cap.verify(ctx);
  version.set_enabled(enabled);
}

/// Write the source `PACKAGE_VERSION` into the shared object after an upgrade (the thing that CURES a stale
/// version — so NOT version-gated).
public fun admin_bump_version(cap: &AdminCap, version: &mut Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.bump();
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

/// `true` for the permanent super cap; `false` for an epoch-scoped temp cap.
public fun is_super(cap: &AdminCap): bool { cap.epoch.is_none() }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
/// Share ONLY the category whitelist (suites that stand up the catalog without the cap).
public fun test_init_catalog(ctx: &mut TxContext) {
  transfer::share_object(Catalog { id: object::new(ctx), categories: table::new(ctx) });
}

#[test_only]
/// Mint a temp cap stamped to an ARBITRARY epoch, so a test can forge an already-expired cap and prove `verify`
/// rejects it (`EAdminCapExpired`) without advancing real epochs.
public fun test_mint_temp_at(super: &AdminCap, epoch: u64, recipient: address, ctx: &mut TxContext) {
  assert!(super.epoch.is_none(), ENotSuperAdmin);
  transfer::transfer(AdminCap { id: object::new(ctx), epoch: option::some(epoch) }, recipient);
}

// ╔════════════════ [ merged from `catalog` — republish restructure #1287 ] ═════ ]
// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared category whitelist. `categories` key present (== `true`) → the category is allowed. Seeded empty;
/// the admin cap holder whitelists categories post-publish via the admin-gated wrappers. `key` only — shared, never moved.
public struct Catalog has key {
  id: UID,
  categories: Table<String, bool>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct CategoryAdded has copy, drop { category: String }

public struct CategoryRemoved has copy, drop { category: String }


// ╔════════════════ [ Package mutators (admin-gated wrappers live in `admin`) ] ═ ]

/// Whitelist `category`. Aborts (table dup) if already present. Package-private — only the admin authoring
/// surface calls it, behind the cap + version gate.
public(package) fun add(self: &mut Catalog, category: String) {
  self.categories.add(category, true);
  event::emit(CategoryAdded { category });
}

/// Remove `category` from the whitelist. Aborts (table) if absent. Existing templates keep their category
/// string (it is snapshotted at creation) — removal only blocks FUTURE templates from authoring it.
public(package) fun remove(self: &mut Catalog, category: String) {
  self.categories.remove(category);
  event::emit(CategoryRemoved { category });
}

// ╔════════════════ [ Read (FREE) ] ══════════════════════════════════════════ ]

public fun contains(self: &Catalog, category: String): bool { self.categories.contains(category) }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]
