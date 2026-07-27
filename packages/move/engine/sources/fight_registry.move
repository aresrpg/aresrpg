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
///
/// SHARDED (S-01/S-02). Both jobs are taken `&mut` on every create, join and settle, and a mutable shared access
/// is the kind that consumes an object's per-commit execution budget — so ONE registry made fight ENTRY and EXIT
/// a global chokepoint while the in-fight action path (per-fight shared objects) was already fully parallel.
/// The docs' first-choice remedy is to stop using a single shared object, so `init` shares SHARD_COUNT
/// registries and every door takes the one its SCOPE maps to. Nothing else moves: same type, same signatures
/// plus the scope the callers already hold, and `FightShards` is the directory that resolves scope → shard.
///
/// TWO INDEPENDENT SHARD KEYS, because the two jobs answer questions about different things:
///   • DERIVATION is keyed by the SCOPE — "does this mob group already have a fight" is a fact about the scope.
///   • THE LATCH is keyed by the CHARACTER — "is this character already fighting" is a fact about the character,
///     and an authority chosen by the asking fight's scope is no authority at all (see `assert_latch_authority`).
/// A create therefore touches two shards, both spread; a join touches only the joiner's latch shard. Intra-key
/// entry still serialises — the win is that scopes and characters no longer serialise against each other.
module aresrpg_fight::fight_registry;

use std::type_name::TypeName;
use sui::table::{Self, Table};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ECharacterInFight: u64 = 103; // join/create: this character is already seated in a LIVE fight (S-12f — one fight at a time; settle the old one first)
const EWrongShard: u64 = 104; // every door: this registry is not the shard this scope maps to (see `shard_index`)

// ╔════════════════ [ Sharding ] ═════════════════════════════════════════════ ]

/// How many registries `init` shares. 16 is the smallest power of two that keeps every live scope class — worlds,
/// dungeon runs, kolizeum matches — spread wide enough that no two busy ones are likely to collide, while staying
/// a list a human can read in the deployment pins.
const SHARD_COUNT: u64 = 16;

/// Which shard a scope belongs to. The LAST BYTE of the id, so a client picks its shard from the hex string with
/// no derivation math and no hash to keep twinned.
public fun shard_index(scope: ID): u64 {
  let bytes = object::id_to_bytes(&scope);
  (bytes[bytes.length() - 1] as u64) % SHARD_COUNT
}

public fun shard_count(): u64 { SHARD_COUNT }

/// THE door every mutable and derived-address path runs first: a caller that hands the wrong shard would claim
/// the fight address under a different parent, and one mob group could then host two live fights. Uniqueness is
/// a state invariant only while scope → shard is a function, so this assert is correctness, not tidiness.
public fun assert_scope(registry: &FightRegistry, scope: ID) {
  assert!(registry.index == shard_index(scope), EWrongShard);
}

/// THE LATCH'S OWN DOOR. The latch answers a question about a CHARACTER — "is it in a live fight anywhere" — so
/// the shard that answers it is derived from the character and from nothing else. Keying it by the asking fight's
/// scope instead let one character latch twice: two scopes on different shards each saw an empty table, and a
/// character rostered into both (two kolizeum lobbies is the shipped path — kolizeum takes an immutable character
/// id and runs no dirty counter) was seated in two live fights at once.
public fun assert_latch_authority(registry: &FightRegistry, character: ID) {
  assert!(registry.index == shard_index(character), EWrongShard);
}

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The derivation parent + in-fight latch. `key` only — shared once at init, never moved. One instance per shard.
public struct FightRegistry has key {
  id: UID,
  /// This shard's ordinal — the whole authority behind `assert_scope`.
  index: u64,
  // S-12f — the IN-FIGHT LATCH ((brand, character id) → live fight id): one character, one live fight PER
  // CONSUMER BRAND (a foreign witness's forged fight can never latch-grief another consumer's characters).
  // Registry-homed (never a character DF) so a mid-fight character SALE can never brick the buyer.
  active_fighters: Table<LatchKey, ID>,
}

/// The shard DIRECTORY: one shared object, read-only for the whole life of the package, resolving scope → shard
/// for clients, tests and the indexer alike. One home for the fact "these are the registries".
public struct FightShards has key {
  id: UID,
  shards: vector<ID>,
}

/// The registry a scope's fights and latches live in.
public fun shard_for(book: &FightShards, scope: ID): ID { book.shards[shard_index(scope)] }

/// Every shard, in index order.
public fun shards(book: &FightShards): vector<ID> { book.shards }

public fun index(registry: &FightRegistry): u64 { registry.index }

/// The derived-object claim key: a fight is unique per (world, spawn_id). A second claim on the same pair
/// aborts in `derived_object::claim` — the first-come gate.
public struct FightKey has copy, drop, store { world: ID, spawn_id: u64 }

/// The RE-ENGAGEMENT claim key (#609 — a group the MOBS won is released back into the world at its spot, so it
/// must be fightable again). A derived address is claimed once and stays `Reserved` even after the object is
/// deleted, so engagement N needs its own address: `round` is the group's engagement ordinal. Round 0 keeps the
/// historical `FightKey` address — every fight ever created lives there, and nothing about it moves.
public struct FightRoundKey has copy, drop, store { world: ID, spawn_id: u64, round: u64 }

/// The brand-scoped latch key (S-46 witness law — see `active_fighters`).
public struct LatchKey has copy, drop, store { brand: TypeName, character: ID }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  let mut shards = vector[];
  let mut i = 0;
  while (i < SHARD_COUNT) {
    let shard = FightRegistry { id: object::new(ctx), index: i, active_fighters: table::new(ctx) };
    shards.push_back(object::id(&shard));
    transfer::share_object(shard);
    i = i + 1;
  };
  transfer::share_object(FightShards { id: object::new(ctx), shards });
}

// ╔════════════════ [ First-come derivation (called by fight::create) ] ══════ ]

/// The derivation parent UID + the key constructor. The `derived_object::claim` itself happens in
/// `fight::create` (the constructing function — the object verifier requires a key struct's UID to originate
/// from `claim` in the SAME function it is wrapped into a struct): a second `create` for the same
/// (world, spawn_id) aborts in `claim` — THE first-come gate.
/// Takes the SCOPE so the shard check cannot be forgotten: this is the only way to reach the derivation parent.
public(package) fun uid_mut(registry: &mut FightRegistry, scope: ID): &mut UID {
  assert_scope(registry, scope);
  &mut registry.id
}

public(package) fun new_key(world: ID, spawn_id: u64): FightKey { FightKey { world, spawn_id } }

public(package) fun new_round_key(world: ID, spawn_id: u64, round: u64): FightRoundKey { FightRoundKey { world, spawn_id, round } }

/// Has a fight over (world, spawn_id) ever been created AT ROUND 0? (RPC + a client's pre-flight "is this group
/// taken".) Since #609 a released group is fought again at round ≥ 1, so pair this with the group's live bit —
/// this alone answers "was it ever fought", never "is it fightable now".
public fun fight_exists(registry: &FightRegistry, world: ID, spawn_id: u64): bool {
  assert_scope(registry, world);
  sui::derived_object::exists(&registry.id, FightKey { world, spawn_id })
}

/// The deterministic address a (world, spawn_id) fight lives at — a client resolves the Fight without a scan.
public fun fight_address(registry: &FightRegistry, world: ID, spawn_id: u64): address {
  assert_scope(registry, world);
  sui::derived_object::derive_address(registry.id.to_inner(), FightKey { world, spawn_id })
}

/// The deterministic address of the (world, spawn_id) fight at engagement `round` — ONE home for the formula
/// `fight::create_round` claims and the consumer's defeat-release door authenticates an outcome against
/// (#609: the outcome carries the fight id, so matching it against this address PROVES which group was lost).
public fun group_fight_address(registry: &FightRegistry, world: ID, spawn_id: u64, round: u64): address {
  assert_scope(registry, world);
  if (round == 0) fight_address(registry, world, spawn_id)
  else sui::derived_object::derive_address(registry.id.to_inner(), FightRoundKey { world, spawn_id, round })
}

// ╔════════════════ [ S-12f — the in-fight character latch ] ══════════════════ ]

/// Latch `character` into `fight` — aborts if it is already seated in a LIVE fight (the multi-fight XP-farm
/// vector: N concurrent fights off one stale HP snapshot). Every seat path (create/join/doors) runs this.
public(package) fun latch_character(registry: &mut FightRegistry, brand: TypeName, character: ID, fight: ID) {
  assert_latch_authority(registry, character);
  let k = LatchKey { brand, character };
  assert!(!registry.active_fighters.contains(k), ECharacterInFight);
  registry.active_fighters.add(k, fight);
}

/// Clear a seat's latch (settlement — every seat, in the same tx that deletes the Fight). Idempotent-tolerant:
/// a missing entry is a no-op (defensive: test doors seat without latching).
public(package) fun unlatch_character(registry: &mut FightRegistry, brand: TypeName, character: ID) {
  assert_latch_authority(registry, character);
  let k = LatchKey { brand, character };
  if (registry.active_fighters.contains(k)) { registry.active_fighters.remove(k); };
}

/// The live fight `character` is seated in, if any (RPC pre-flight + client teach-don't-reject). Ask the shard
/// the CHARACTER maps to — the same one that holds its latch.
public fun character_fight(registry: &FightRegistry, brand: TypeName, character: ID): Option<ID> {
  assert_latch_authority(registry, character);
  let k = LatchKey { brand, character };
  if (registry.active_fighters.contains(k)) option::some(*registry.active_fighters.borrow(k)) else option::none()
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
