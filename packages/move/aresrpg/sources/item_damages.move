// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ITEM DAMAGES — the typed damage lines attached as a DYNAMIC FIELD (a `vector<ItemDamages>`) to an
/// `ItemTemplate`. Same shape as the legacy pattern and the same placement as `item_stats`: the item base owns
/// the storage, this module owns the data shape + attach/read. A weapon template can carry several lines (e.g.
/// a fire line + a water line). Set at TEMPLATE CREATION; read by a later combat upgrade.
module aresrpg::item_damages;

use aresrpg::item::{Self, Item, ItemTemplate};
use aresrpg_foundation::spell;
use std::string::String;
use sui::dynamic_field as df;

/// The typed DF key the damage vector hangs under on the template's UID.
public struct DamagesKey has copy, drop, store {}

/// The typed DF key the SNAPSHOT of the authored lines hangs under on a minted ITEM's UID (§17.27 wave-2a). The
/// template owns the authored truth; `equipment::equip` copies it onto the equipped instance (mirroring how
/// `item_stats` rolls onto the instance) so a fight seat can read the lines from the character WITHOUT the
/// template object — the same chain-verified trust path as gear stats. Orphans harmlessly on burn (item::destroy).
public struct ItemLinesKey has copy, drop, store {}

/// One damage line: `[from, to]` roll range, plus the free-form `damage_type` + `element` slugs. Pure data.
public struct ItemDamages has copy, drop, store {
  from: u16,
  to: u16,
  damage_type: String,
  element: String,
}

// ╔════════════════ [ Constructor (public — a PTB builds the lines to pass to create_template) ] ═ ]

public fun new(from: u16, to: u16, damage_type: String, element: String): ItemDamages {
  ItemDamages { from, to, damage_type, element }
}

// ╔════════════════ [ Attach / read on the TEMPLATE ] ════════════════════════ ]

/// Attach the damage vector to `template` (package-private — the authoring surface calls it before sharing).
public(package) fun attach(template: &mut ItemTemplate, lines: vector<ItemDamages>) {
  df::add(item::y57(template), DamagesKey {}, lines);
}

public fun has_damages(template: &ItemTemplate): bool {
  df::exists(item::y58(template), DamagesKey {})
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// REPLACE `template`'s damage lines wholesale (package-private — `admin::set_template_damages` calls it). Mirrors
/// `item_stats::y63`: overwrite in place when the DF exists, attach when it does not — so a weapon authored
/// WITHOUT lines heals through the same door. An EMPTY `lines` NORMALIZES to detached, leaving exactly the state
/// `create_template` produces for an empty `damages` argument — one home for "this template carries no lines", so
/// `has_damages` can never answer `true` for a template with nothing in it.
public(package) fun y59(template: &mut ItemTemplate, lines: vector<ItemDamages>) {
  if (lines.is_empty()) {
    lines.destroy_empty();
    y60(template);
  } else if (has_damages(template)) {
    *df::borrow_mut(item::y57(template), DamagesKey {}) = lines;
  } else {
    attach(template, lines);
  };
}

public fun damages(template: &ItemTemplate): &vector<ItemDamages> {
  df::borrow(item::y58(template), DamagesKey {})
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Detach + drop the damage lines from `template` if present. Package-private — the burn path calls it so
/// deleting the template's UID orphans no dynamic field. No-op when the template carries no damages. The
/// `vector<ItemDamages>` has `drop`, so removal just discards.
public(package) fun y60(template: &mut ItemTemplate) {
  if (has_damages(template)) {
    let _: vector<ItemDamages> = df::remove(item::y57(template), DamagesKey {});
  }
}

// ╔════════════════ [ Instance snapshot (§17.27 wave-2a — the equip-time copy combat reads) ] ═ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Snapshot the authored lines onto a minted ITEM (package-private — `equipment::equip` calls it for a weapon,
/// off the chain-verified template). Idempotent-guarded by the caller (weapon slot, template↔item match). Same
/// instance-attach shape as `item_stats::y66`.
public(package) fun y61(item: &mut Item, lines: vector<ItemDamages>) {
  df::add(item::uid_mut(item), ItemLinesKey {}, lines);
}

public fun has_item_lines(item: &Item): bool {
  df::exists(item::uid(item), ItemLinesKey {})
}

public fun item_lines(item: &Item): &vector<ItemDamages> {
  df::borrow(item::uid(item), ItemLinesKey {})
}

// ╔════════════════ [ Combat conversion (§17.27 wave-2a — one home for line → engine values) ] ═ ]

/// The line's flat combat magnitude = the range MIDPOINT `(from+to)/2` — the doctrine's per-hit AVG basis
/// (`WEAPON_DAMAGE.md`: `avg=(from+to)/2`), and the flat-value analogue of a spell's single authored base (spells
/// carry one flat value, not a range). Wave-2b replaces this with a seeded roll in `[from,to]` (the seed-roll item).
public fun midpoint(self: &ItemDamages): u64 { (((self.from as u64) + (self.to as u64)) / 2) }

/// The line's element as a `spell::el_*` id (the engine speaks u8 ids, the corpus authors strings). `neutral` — or
/// any unrecognized slug — maps to `el_none()` (255), which `spell_formula::final_damage` resists via
/// `neutral_resistance` (#55). One home for the item-element string → combat-id mapping.
public fun element_id(self: &ItemDamages): u8 {
  let e = self.element;
  if (e == b"fire".to_string()) spell::el_fire()
  else if (e == b"water".to_string()) spell::el_water()
  else if (e == b"earth".to_string()) spell::el_earth()
  else if (e == b"air".to_string()) spell::el_air()
  else spell::el_none()
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun from(self: &ItemDamages): u16 { self.from }
public fun to(self: &ItemDamages): u16 { self.to }
public fun damage_type(self: &ItemDamages): String { self.damage_type }
public fun element(self: &ItemDamages): String { self.element }
