// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CATALOG — the admin-editable ITEM CATEGORY whitelist. A single shared `Catalog` holds the set of valid
/// item categories (`sword`, `ring`, `consumable`, `tool_farmer`, …). `admin::create_template` asserts the
/// authored category is in this set, so the category domain is DATA (admin-editable post-publish), never a
/// hardcoded enum baked into immutable code — job tools and future categories are added without an upgrade.
///
/// PLACEMENT-BY-RESPONSIBILITY: this is a LEAF data module (mirrors `version`) — it imports NO cap type, so it
/// cannot participate in an admin<->catalog cycle. The admin-gated mutators (`add_category`/`remove_category`)
/// live in `admin` and reach in through the `public(package)` setters below; the membership read (`contains`)
/// is public. Seeded EMPTY at publish — the admin cap holder adds the categories while the package is still dark.
module aresrpg::catalog;

use std::string::String;
use sui::{event, table::{Self, Table}};

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

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(Catalog { id: object::new(ctx), categories: table::new(ctx) });
}

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

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
