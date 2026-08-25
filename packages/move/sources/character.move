// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module aresrpg::character;

use aresrpg_math::content_rules;
use kiosk::personal_kiosk;
use std::string::String;
use sui::{
  coin::Coin,
  derived_object,
  display_registry::{Self, DisplayRegistry},
  event,
  kiosk::Kiosk,
  package::Publisher,
  sui::SUI,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENoPoints: u64 = 106; // raise_stat: not enough available points
const EUnknownStat: u64 = 107; // raise_stat: not one of the six characteristics
const ENotPersonalKiosk: u64 = 108; // custody: a character must live in a PERSONAL kiosk
const ENameInvalid: u64 = 102;
const EInvalidClasse: u64 = 103;
const EInvalidColor: u64 = 104;
const EWrongPayment: u64 = 105;

const MAX_COLOR_VALUE: u32 = 16777215; // 0xFFFFFF
const PRICE: u64 = 1_000_000_000; // 1 SUI, fixed — no free path, no sponsoring

/// A character must be locked in a PERSONAL kiosk, so its `KioskOwnerCap` is itself soulbound and
/// can't be sold or lent outside the royalty rule. The personal-kiosk TRANSFER rule gates trades
/// only — never the mint or a fight/dungeon/kolizeum re-lock (audit 2026-08-11) — so every
/// `kiosk.lock` of a Character calls this. `personal_kiosk` is a READ here, not the purged cap.
public(package) fun assert_personal_custody(kiosk: &Kiosk) {
  assert!(personal_kiosk::is_personal(kiosk), ENotPersonalKiosk);
}

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
  // ── allocated characteristics (legacy shape): 5 points per level, spent 1:1 ──
  vitality: u16,
  wisdom: u16,
  strength: u16,
  intelligence: u16,
  chance: u16,
  agility: u16,
  available_points: u16,
  // ── spell points: 1 granted per level from level 2 (Dofus law), spent by raise_spell ──
  available_spell_points: u16,
}

/// Shared namespace for deterministic character IDs. A lowercase name is claimed once and
/// remains reserved after deletion, so every client can derive the same ID without a lookup.
public struct NameRegistry has key {
  id: UID,
}

// one time witness
public struct CHARACTER has drop {}

public struct CharacterCreated has copy, drop { character: ID, owner: address, name: String, classe: String }

// ╔════════════════ [ init ] ═════════════════════════════════════════════════ ]

fun init(_otw: CHARACTER, ctx: &mut TxContext) {
  transfer::share_object(NameRegistry { id: object::new(ctx) });
}

/// Display V2 needs the shared `DisplayRegistry` (0xd), which init cannot take — runs once
/// post-publish through `admin::create_character_display`. Returns the cap.
public(package) fun nd(
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
    b"https://aresrpg.world/classe/{classe}_{sex}.jpg".to_string(),
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

/// Mint for exactly 1 SUI. The lowercase name claims the character's deterministic ID and is
/// permanently reserved. Package-private: the ONE public mint door is
/// `api::create_character`, which also joins the first world — a character is never world-less.
public(package) fun create_character(
  registry: &mut NameRegistry,
  payment: Coin<SUI>,
  raw_name: String,
  classe: String,
  male: bool,
  color_1: u32,
  color_2: u32,
  color_3: u32,
  ctx: &TxContext,
): Character {
  assert!(payment.value() == PRICE, EWrongPayment);
  transfer::public_transfer(payment, @treasury);

  vc(classe);
  validate_range!(color_1, 0, MAX_COLOR_VALUE, EInvalidColor);
  validate_range!(color_2, 0, MAX_COLOR_VALUE, EInvalidColor);
  validate_range!(color_3, 0, MAX_COLOR_VALUE, EInvalidColor);

  let name = raw_name.to_ascii().to_lowercase().to_string();
  assert!(name.length() > 3 && name.length() < 20, ENameInvalid);
  assert!(content_rules::is_printable_ascii(&name), ENameInvalid);

  let character = Character {
    id: derived_object::claim(&mut registry.id, name),
    name,
    classe,
    sex: if (male) b"male".to_string() else b"female".to_string(),
    experience: 0,
    level: 1,
    color_1,
    color_2,
    color_3,
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    available_points: 0,
    available_spell_points: 0,
  };
  event::emit(CharacterCreated {
    character: character.id.to_inner(),
    owner: ctx.sender(),
    name: character.name,
    classe: character.classe,
  });
  character
}

// ╔════════════════ [ Package ] ══════════════════════════════════════════════ ]

public(package) fun id(self: &Character): ID { self.id.to_inner() }

public(package) fun uid(self: &Character): &UID { &self.id }

public fun name(self: &Character): String { self.name }

public fun classe(self: &Character): String { self.classe }

public fun vitality(self: &Character): u16 { self.vitality }

public fun wisdom(self: &Character): u16 { self.wisdom }

public fun strength(self: &Character): u16 { self.strength }

public fun intelligence(self: &Character): u16 { self.intelligence }

public fun chance(self: &Character): u16 { self.chance }

public fun agility(self: &Character): u16 { self.agility }

public fun available_points(self: &Character): u16 { self.available_points }

public fun available_spell_points(self: &Character): u16 { self.available_spell_points }

/// The spell-raise spend door — progression asserts affordability first.
public(package) fun ssp(self: &mut Character, amount: u16) {
  self.available_spell_points = self.available_spell_points - amount;
}

/// RESET SPELL POINTS: every point ever granted returns — the pool becomes level − 1.
public(package) fun rsp(self: &mut Character) {
  self.available_spell_points = self.level - 1;
}

public(package) fun uid_mut(self: &mut Character): &mut UID { &mut self.id }

public(package) fun level(self: &Character): u16 { self.level }

/// Add-only — experience can never decrease. The level syncs silently off the curve; each
/// level gained grants 5 stat points and 1 spell point (legacy law).
public(package) fun add_experience(self: &mut Character, experience: u64) {
  self.experience = self.experience + experience;
  let new_level = aresrpg_math::experience::level_from_xp(self.experience);
  if (new_level > self.level) {
    self.available_points = self.available_points + (new_level - self.level) * 5;
    self.available_spell_points = self.available_spell_points + (new_level - self.level);
    self.level = new_level;
  };
}

/// RESET STAT POINTS (the consumable): refund every allocated characteristic back into the
/// pool and zero the six. Gear-folded stats are untouched — only the ALLOCATED points return.
public(package) fun reset_stats(self: &mut Character) {
  let refund = self.vitality + self.wisdom + self.strength + self.intelligence + self.chance + self.agility;
  self.available_points = self.available_points + refund;
  self.vitality = 0;
  self.wisdom = 0;
  self.strength = 0;
  self.intelligence = 0;
  self.chance = 0;
  self.agility = 0;
}

/// Spend available points 1:1 into one of the six characteristics.
public(package) fun raise_stat(self: &mut Character, stat: String, amount: u16) {
  assert!(self.available_points >= amount, ENoPoints);
  self.available_points = self.available_points - amount;
  if (stat == b"vitality".to_string()) { self.vitality = self.vitality + amount }
  else if (stat == b"wisdom".to_string()) { self.wisdom = self.wisdom + amount }
  else if (stat == b"strength".to_string()) { self.strength = self.strength + amount }
  else if (stat == b"intelligence".to_string()) { self.intelligence = self.intelligence + amount }
  else if (stat == b"chance".to_string()) { self.chance = self.chance + amount }
  else if (stat == b"agility".to_string()) { self.agility = self.agility + amount }
  else abort EUnknownStat
}

/// Unpack primitive — the guarded delete door lives downstream. The derived-name claim remains,
/// so a deleted identity can never be impersonated by a later character.
public(package) fun destroy(self: Character) {
  let Character { id, .. } = self;
  id.delete();
}

// ╔════════════════ [ Private ] ══════════════════════════════════════════════ ]

// verify_classe
fun vc(classe: String) {
  assert!(content_rules::is_classe(&classe), EInvalidClasse);
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(CHARACTER {}, ctx) }

#[test_only]
public fun test_registry(ctx: &mut TxContext): NameRegistry { NameRegistry { id: object::new(ctx) } }

#[test_only]
public fun test_derived_address(registry: &NameRegistry, name: String): address {
  derived_object::derive_address(registry.id.to_inner(), name)
}

#[test_only]
public fun test_claim_name(registry: &mut NameRegistry, name: String): UID {
  derived_object::claim(&mut registry.id, name)
}

#[test_only]
public fun test_name_exists(registry: &NameRegistry, name: String): bool {
  derived_object::exists(&registry.id, name)
}
