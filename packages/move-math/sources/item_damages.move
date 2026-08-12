// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// A weapon damage line — PURE DATA (storage and snapshotting live in item.move). A template
/// carries a vector of lines (e.g. a fire line + a water line); every minted item snapshots
/// them. Validated at construction: templates freeze forever, a bad line would be eternal.
module aresrpg_math::item_damages;

use std::string::String;

const EInvalidRange: u64 = 901; // new: from > to
const EInvalidElement: u64 = 902; // new: element outside the 5

public struct ItemDamages has copy, drop, store {
  from: u16,
  to: u16,
  damage_type: String,
  element: String,
}

/// Seeding constructor — element and range validated here, BEFORE any freeze can seal them.
public fun new(from: u16, to: u16, damage_type: String, element: String): ItemDamages {
  assert!(from <= to, EInvalidRange);
  assert!(is_element(&element), EInvalidElement);
  ItemDamages { from, to, damage_type, element }
}

/// The one home of "is this an element" — mobs and lines both validate here.
public fun is_element(element: &String): bool {
  *element == b"earth".to_string() ||
  *element == b"fire".to_string() ||
  *element == b"water".to_string() ||
  *element == b"air".to_string()
}

// ╔════════════════ [ Reads ] ════════════════════════════════════════════════ ]

public fun from(self: &ItemDamages): u16 { self.from }

public fun to(self: &ItemDamages): u16 { self.to }

public fun damage_type(self: &ItemDamages): String { self.damage_type }

public fun element(self: &ItemDamages): String { self.element }
