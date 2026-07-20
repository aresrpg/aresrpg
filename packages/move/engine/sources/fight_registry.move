// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT_REGISTRY — the fight domain's ONE shared coordination object. Two jobs:
///
///  1. FIRST-COME DERIVATION PARENT (§7 first-come-first-served). A Fight is created at the address DERIVED
///     from `(world, spawn_id)` via `derived_object::claim` over THIS object's UID. A derived address can be
///     claimed exactly once, so the FIRST `fight::create` for a world mob-group succeeds and every racer aborts
///     in `claim` — first-come is a TYPE/STATE invariant, no lock-and-check race window.
///
///  2. THE IN-FIGHT LATCH (S-12f): one character, one live fight. Registry-homed (never a character DF) so a
///     mid-fight character SALE can never brick the buyer — the latch's lifetime is the FIGHT's (created →
///     settled), cleared for every seat at settlement.
///
/// S-46: the two custodied ExtensionCaps (NS_MINT_FIGHT loot-mint, NS_CHARACTER_PROGRESSION xp/hp) are GONE —
/// minting + progression writes are `public(package)` doors now, called directly by `results`/`fight`.
module aresrpg_fight::fight_registry;

use std::type_name::TypeName;
use sui::table::{Self, Table};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ECharacterInFight: u64 = 103; // join/create: this character is already seated in a LIVE fight (S-12f — one fight at a time; settle the old one first)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The derivation parent + in-fight latch. `key` only — shared once at init, never moved.
public struct FightRegistry has key {
  id: UID,
  // S-12f — the IN-FIGHT LATCH ((brand, character id) → live fight id): one character, one live fight PER
  // CONSUMER BRAND (a foreign witness's forged fight can never latch-grief another consumer's characters).
  // Registry-homed (never a character DF) so a mid-fight character SALE can never brick the buyer.
  active_fighters: Table<LatchKey, ID>,
}

/// The derived-object claim key: a fight is unique per (world, spawn_id). A second claim on the same pair
/// aborts in `derived_object::claim` — the first-come gate.
public struct FightKey has copy, drop, store { world: ID, spawn_id: u64 }

/// The brand-scoped latch key (S-46 witness law — see `active_fighters`).
public struct LatchKey has copy, drop, store { brand: TypeName, character: ID }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(FightRegistry {
    id: object::new(ctx),
    active_fighters: table::new(ctx),
  });
}

// ╔════════════════ [ First-come derivation (called by fight::create) ] ══════ ]

/// The derivation parent UID + the key constructor. The `derived_object::claim` itself happens in
/// `fight::create` (the constructing function — the object verifier requires a key struct's UID to originate
/// from `claim` in the SAME function it is wrapped into a struct): a second `create` for the same
/// (world, spawn_id) aborts in `claim` — THE first-come gate.
public(package) fun uid_mut(registry: &mut FightRegistry): &mut UID { &mut registry.id }

public(package) fun new_key(world: ID, spawn_id: u64): FightKey { FightKey { world, spawn_id } }

/// Has a fight over (world, spawn_id) ever been created? (RPC + a client's pre-flight "is this group taken".)
public fun fight_exists(registry: &FightRegistry, world: ID, spawn_id: u64): bool {
  sui::derived_object::exists(&registry.id, FightKey { world, spawn_id })
}

/// The deterministic address a (world, spawn_id) fight lives at — a client resolves the Fight without a scan.
public fun fight_address(registry: &FightRegistry, world: ID, spawn_id: u64): address {
  sui::derived_object::derive_address(registry.id.to_inner(), FightKey { world, spawn_id })
}

// ╔════════════════ [ S-12f — the in-fight character latch ] ══════════════════ ]

/// Latch `character` into `fight` — aborts if it is already seated in a LIVE fight (the multi-fight XP-farm
/// vector: N concurrent fights off one stale HP snapshot). Every seat path (create/join/doors) runs this.
public(package) fun latch_character(registry: &mut FightRegistry, brand: TypeName, character: ID, fight: ID) {
  let k = LatchKey { brand, character };
  assert!(!registry.active_fighters.contains(k), ECharacterInFight);
  registry.active_fighters.add(k, fight);
}

/// Clear a seat's latch (settlement — every seat, in the same tx that deletes the Fight). Idempotent-tolerant:
/// a missing entry is a no-op (defensive: test doors seat without latching).
public(package) fun unlatch_character(registry: &mut FightRegistry, brand: TypeName, character: ID) {
  let k = LatchKey { brand, character };
  if (registry.active_fighters.contains(k)) { registry.active_fighters.remove(k); };
}

/// The live fight `character` is seated in, if any (RPC pre-flight + client teach-don't-reject).
public fun character_fight(registry: &FightRegistry, brand: TypeName, character: ID): Option<ID> {
  let k = LatchKey { brand, character };
  if (registry.active_fighters.contains(k)) option::some(*registry.active_fighters.borrow(k)) else option::none()
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
