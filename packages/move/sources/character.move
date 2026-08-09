// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module aresrpg::character;

use std::string::String;
use sui::{
  coin::Coin,
  display_registry::{Self, DisplayRegistry},
  dynamic_field as dfield,
  event,
  package::{Self, Publisher},
  sui::SUI,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENameTaken: u64 = 101;
const ENameInvalid: u64 = 102;
const EInvalidClasse: u64 = 103;
const EInvalidColor: u64 = 104;
const EWrongPayment: u64 = 105;

const MAX_COLOR_VALUE: u32 = 16777215; // 0xFFFFFF
const PRICE: u64 = 1_000_000_000; // 1 SUI, fixed — no free path, no sponsoring

// ╔════════════════ [ Macros ] ═══════════════════════════════════════════════ ]

macro fun validate_range($value: _, $min: _, $max: _, $error: _) {
  assert!($value >= $min && $value <= $max, $error)
}

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct Character has key, store {
  id: UID,
  name: String,
  classe: String,
  sex: String, // stored as text ("male"/"female") — Display renders it in the art URL
  experience: u64,
  level: u16, // denormalized for Display; synced by add_experience off the xp curve
  color_1: u32,
  color_2: u32,
  color_3: u32,
}

/// Shared root holding one `name → character ID` record per living character. Records are
/// dynamic fields — REMOVABLE, so deleting a character frees its name (a derived-object claim
/// would lock the name forever: the framework has no unclaim).
public struct NameRegistry has key {
  id: UID,
}

// one time witness
public struct CHARACTER has drop {}

public struct CharacterCreated has copy, drop { character: ID, name: String, classe: String }

// ╔════════════════ [ init ] ═════════════════════════════════════════════════ ]

fun init(otw: CHARACTER, ctx: &mut TxContext) {
  transfer::share_object(NameRegistry { id: object::new(ctx) });
  transfer::public_transfer(package::claim(otw, ctx), ctx.sender());
}

/// Display V2 needs the shared `DisplayRegistry` (0xd), which init cannot take — runs once
/// post-publish. Returns the cap; the ceremony transaction decides where it lives.
public fun create_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Character> {
  let (mut d, cap) = display_registry::new_with_publisher<Character>(registry, publisher, ctx);
  display_registry::set(&mut d, &cap, b"name".to_string(), b"{name}".to_string());
  display_registry::set(&mut d, &cap, b"link".to_string(), b"https://app.aresrpg.world".to_string());
  display_registry::set(
    &mut d,
    &cap,
    b"image_url".to_string(),
    b"https://assets.aresrpg.world/classe/{classe}_{sex}.jpg".to_string(),
  );
  display_registry::set(
    &mut d,
    &cap,
    b"description".to_string(),
    b"Level {level} {classe} of the AresRPG universe.".to_string(),
  );
  display_registry::set(&mut d, &cap, b"project_url".to_string(), b"https://aresrpg.world".to_string());
  display_registry::set(&mut d, &cap, b"creator".to_string(), b"AresRPG".to_string());
  display_registry::share(d);
  cap
}

// ╔════════════════ [ Creation ] ═════════════════════════════════════════════ ]

/// Mint for exactly 1 SUI. The name lands as a registry record (globally unique, freed again
/// when the character is deleted). Returns the character — the caller's transaction decides
/// where it goes.
public fun create_character(
  registry: &mut NameRegistry,
  payment: Coin<SUI>,
  raw_name: String,
  classe: String,
  male: bool,
  color_1: u32,
  color_2: u32,
  color_3: u32,
  ctx: &mut TxContext,
): Character {
  assert!(payment.value() == PRICE, EWrongPayment);
  transfer::public_transfer(payment, @treasury);

  verify_classe(classe);
  validate_range!(color_1, 0, MAX_COLOR_VALUE, EInvalidColor);
  validate_range!(color_2, 0, MAX_COLOR_VALUE, EInvalidColor);
  validate_range!(color_3, 0, MAX_COLOR_VALUE, EInvalidColor);

  let name = raw_name.to_ascii().to_lowercase().to_string();
  assert!(name.length() > 3 && name.length() < 20, ENameInvalid);
  assert!(!contains_whitespace(&name), ENameInvalid);

  assert!(!dfield::exists(&registry.id, name), ENameTaken);

  let character = Character {
    id: object::new(ctx),
    name,
    classe,
    sex: if (male) b"male".to_string() else b"female".to_string(),
    experience: 0,
    level: 1,
    color_1,
    color_2,
    color_3,
  };
  dfield::add(&mut registry.id, name, character.id.to_inner());
  event::emit(CharacterCreated {
    character: character.id.to_inner(),
    name: character.name,
    classe: character.classe,
  });
  character
}

// ╔════════════════ [ Package ] ══════════════════════════════════════════════ ]

public(package) fun id(self: &Character): ID { self.id.to_inner() }

public(package) fun uid_mut(self: &mut Character): &mut UID { &mut self.id }

public(package) fun level(self: &Character): u16 { self.level }

/// Add-only — experience can never decrease. The level syncs silently off the curve.
public(package) fun add_experience(self: &mut Character, experience: u64) {
  self.experience = self.experience + experience;
  self.level = aresrpg::experience::level_from_xp(self.experience);
}

/// Unpack primitive — the guarded delete door (no equipped items, legacy's EInventoryNotEmpty
/// guard) lives downstream. Removes the name record: deletion FREES the name.
public(package) fun destroy(registry: &mut NameRegistry, self: Character) {
  let Character { id, name, .. } = self;
  let _character_id: ID = dfield::remove(&mut registry.id, name);
  id.delete();
}

// ╔════════════════ [ Private ] ══════════════════════════════════════════════ ]

fun verify_classe(classe: String) {
  assert!(
    classe == b"shugo".to_string() ||
    classe == b"tomoda".to_string() ||
    classe == b"rojin".to_string() ||
    classe == b"yajin".to_string() ||
    classe == b"tokei".to_string() ||
    classe == b"asobi".to_string() ||
    classe == b"tsuba".to_string() ||
    classe == b"senshi".to_string() ||
    classe == b"yogan".to_string() ||
    classe == b"mori".to_string() ||
    classe == b"ikari".to_string() ||
    classe == b"shusen".to_string(),
    EInvalidClasse,
  );
}

fun contains_whitespace(name: &String): bool {
  let bytes = name.as_bytes();
  let n = bytes.length();
  let mut i = 0;
  while (i < n) {
    if (bytes[i] <= 32u8 || bytes[i] == 127u8) return true;
    i = i + 1;
  };
  false
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(CHARACTER {}, ctx) }
