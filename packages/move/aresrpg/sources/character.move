// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHARACTER — the generic on-chain character base: pure DATA + package-private factory, ZERO gameplay systems
/// and ZERO authority plumbing. A `Character` is a minted NFT carrying only the base fields
/// (name / class / male / customization / experience / created_at_ms / a position anchor). Stats, hp, jobs,
/// spells and every other system are DELIBERATELY absent — they arrive later as first-party DYNAMIC FIELDS
/// attached by the SEPARATE `aresrpg_game` package through the cap-gated, namespace-scoped `aresrpg::
/// extension` gate (that cross-package gate IS required under the adopted topology — a bare `uid_mut` cannot be
/// called from another package; ruling R-C1). Meaning lives in DATA and in the modules that own it.
///
/// PLACEMENT-BY-RESPONSIBILITY: this module owns only what a character IS + its own field validity (colour
/// range, non-empty anchor zone). Name uniqueness, charset/length, the class whitelist, price and pause are the
/// CREATION GATE's concern (`creation`) — they are NOT here. `new` is a `public(package)` factory: only the gate
/// mints; nothing outside the package can. The module boundary IS the security boundary.
///
/// LOCK-PLEDGE CONSTITUTION (type-enforced): `new` returns a `LockPledge` hot potato with NO abilities. The ONLY
/// function that consumes it is `lock_in_kiosk`, which asserts the pledge matches the character AND that the
/// destination kiosk is PERSONAL, then locks it under the `TransferPolicy<Character>`. A minter therefore CANNOT
/// leave a fresh character unlocked or in a non-personal kiosk — the type system forces a same-PTB personal-kiosk
/// lock. There is NO address-delivery path anywhere in this package.
///
/// DELETION: characters must be deletable once everything is unequipped first, even the
/// free starter one. This module still ships NO delete door — it owns only the package-private `destroy` PRIMITIVE
/// (unpack + `object::delete`). The DOOR is `character_extract::delete_character` (it must sit downstream of
/// `equipment` for the unequipped guard; importing equipment from HERE would cycle). The guard set lives there:
/// no equipped items (an orphaned Item is destroyed player value), no unopened fight, no dungeon lock. Plain-DATA
/// dynamic fields (progression / world / checkpoints / spell + stat allocations) are ORPHANED by the delete —
/// they are un-enumerable on-chain and carry no extractable value. NOTE: the name cannot be freed —
/// `derived_object` exposes no `unclaim`, so the `Claimed` marker on the creation gate is PERMANENT; a deleted
/// character's name stays reserved forever (the delete UI says so).
module aresrpg::character;

use aresrpg::{config::GameConfig, version::Version};
use kiosk::personal_kiosk;
use std::string::{utf8, String};
use sui::{
  clock::Clock,
  derived_object,
  display,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  package::{Self, Publisher},
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap},
  tx_context::sender
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EPledgeMismatch: u64 = 101; // lock_in_kiosk: pledge id != character id
const ENotPersonalKiosk: u64 = 102; // lock_in_kiosk: destination kiosk is not PERSONAL (constitution)
const EEmptyZone: u64 = 103; // anchor_position: the zone string is empty
const EInvalidColor: u64 = 104; // new_customization: a colour is out of the 24-bit range
const EAnchorNotIncreasing: u64 = 105; // anchor_position: the new timestamp is not strictly after the last

const MAX_COLOR: u32 = 16_777_215; // 0xFFFFFF — a 24-bit RGB colour

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A minted character instance. Base fields ONLY: `customization` holds the three cosmetic
/// colours; `experience` starts at 0; `created_at_ms` is the Clock stamp at creation; `anchor` is the last
/// explicitly-anchored world position (zeroed at mint — written ONLY by `anchor_position`, a holder-signed
/// entry). No hp / stats / jobs — those z503 later as dynamic fields via the `uid_mut` seam.
///
/// FUTURE-WRITE INVARIANTS (for the xp/stat write paths that arrive via upgrade — enforce, don't re-derive):
/// (1) EXPERIENCE IS MONOTONIC — an xp write MUST assert `new > current`; experience can NEVER decrease.
/// (2) CAS DISCIPLINE — a server-driven mutation takes the caller's expected-current value and aborts on
///     mismatch (no lost updates), mirroring the legacy `validate_unchanged!` guard. The position anchor's
///     equivalent is already enforced here: `anchor_position` requires a STRICTLY-INCREASING timestamp.
public struct Character has key, store {
  id: UID,
  name: String,
  class: String,
  male: bool,
  customization: Customization,
  experience: u64,
  created_at_ms: u64,
  anchor: PositionAnchor,
}

/// The three cosmetic colours (24-bit RGB each), mirroring the testnet character's shape as ONE field. Pure
/// data: `copy + drop + store`, validated at construction by `new_customization`.
public struct Customization has copy, drop, store {
  color_1: u32,
  color_2: u32,
  color_3: u32,
}

/// The last-anchored world position. `zone` empty + everything zero = never anchored. Written ONLY by
/// `anchor_position` (signed by whoever holds the character, via the kiosk cap). Pure data: `copy + drop + store`.
public struct PositionAnchor has copy, drop, store {
  pos_x: u32,
  pos_z: u32,
  zone: String,
  anchored_at_ms: u64,
}

/// The lock-pledge HOT POTATO — NO abilities. Carries the id of the character that MUST be locked. The only
/// consumer is `lock_in_kiosk`; because it cannot be dropped, stored or transferred, the compiler forces every
/// minted character into a personal kiosk in the same PTB.
public struct LockPledge { character_id: ID }

/// One-Time Witness — claims the package `Publisher` at publish for `Display<Character>` + the
/// `TransferPolicy<Character>` seam.
public struct CHARACTER has drop {}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct CharacterMinted has copy, drop { character: ID, class: String }

public struct PositionAnchored has copy, drop { character: ID, pos_x: u32, pos_z: u32, zone: String, anchored_at_ms: u64 }

public struct CharacterPolicyCreated has copy, drop { policy: ID }

// ╔════════════════ [ Display (image is a PATTERN keyed by class + male, never a struct field) ] ═ ]

/// Claims the `Publisher` and registers `Display<Character>`. The art CDN is keyed by the `{class}_{male}` slug
/// (same base URL convention as `Item`'s Display) — the struct carries ZERO url/image fields. Publisher + Display
/// go to the publishing admin, who creates the transfer policy at ceremony time.
fun init(otw: CHARACTER, ctx: &mut TxContext) {
  let publisher = package::claim(otw, ctx);

  let keys = vector[utf8(b"name"), utf8(b"image_url"), utf8(b"description"), utf8(b"project_url")];
  let values = vector[
    utf8(b"{name}"),
    utf8(b"/assets/characters/{class}_{male}.png"), // host-free relative form (jobs.js ASSET_BASE fallback); the walrus_display_step ceremony swaps this to the walrus by-quilt-id URL post-upload
    utf8(b"An on-chain character."),
    utf8(b"https://aresrpg.world"),
  ];
  let mut disp = display::new_with_fields<Character>(&publisher, keys, values, ctx);
  disp.update_version();

  transfer::public_transfer(publisher, sender(ctx));
  transfer::public_transfer(disp, sender(ctx));
}

// ╔════════════════ [ Customization constructor (owns its own validity) ] ════ ]

/// Build a validated `Customization`. Each colour must be a 24-bit value (`<= 0xFFFFFF`) or `EInvalidColor`.
/// Public so a client PTB builds it and passes it to `creation::create_character`.
public fun new_customization(color_1: u32, color_2: u32, color_3: u32): Customization {
  assert!(color_1 <= MAX_COLOR && color_2 <= MAX_COLOR && color_3 <= MAX_COLOR, EInvalidColor);
  Customization { color_1, color_2, color_3 }
}

// ╔════════════════ [ Factory (package-private — only the creation gate mints) ] ═ ]

/// CLAIM the name-derived UID under `parent` (the creation gate's own UID, via `derived_object::claim` keyed on
/// `name_key`) and assemble a `Character` around it, returning it with a `LockPledge` forcing a same-PTB
/// personal-kiosk lock. Claiming HERE is mandatory: the object verifier requires a `key` struct's UID to come
/// directly from `object::new`/`derived_object::claim` in the constructing function. The GATE still owns the
/// naming policy — it normalizes, pre-checks existence and passes its own UID + the `name_key`; this factory only
/// performs the deterministic claim (a duplicate name aborts in `claim`). Package-private, NO other gate: class
/// whitelist / price / pause are the creation gate's concern. `experience` starts 0; `anchor` starts zeroed.
public(package) fun new(
  parent: &mut UID,
  name_key: String,
  name: String,
  class: String,
  male: bool,
  customization: Customization,
  created_at_ms: u64,
): (Character, LockPledge) {
  let id = derived_object::claim(parent, name_key);
  let cid = id.to_inner();
  let character = Character {
    id,
    name,
    class,
    male,
    customization,
    experience: 0,
    created_at_ms,
    anchor: PositionAnchor { pos_x: 0, pos_z: 0, zone: utf8(b""), anchored_at_ms: 0 },
  };
  event::emit(CharacterMinted { character: cid, class: character.class });
  (character, LockPledge { character_id: cid })
}

/// BRAND TWIN (2026-07-13 gifting split): the character-mint door for the PINNED gifting sibling — the extracted
/// `creation` gate mints through this after its own name/class/free-vs-paid validation. Zero behavior drift:
/// asserts the pin then delegates to `new` verbatim. The returned `LockPledge` still type-forces the same-PTB
/// personal-kiosk lock (no address delivery). `parent` is the caller gate's own UID (the name-derivation root).
public fun new_brand<W: drop>(
  _: W,
  config: &GameConfig,
  parent: &mut UID,
  name_key: String,
  name: String,
  class: String,
  male: bool,
  customization: Customization,
  created_at_ms: u64,
): (Character, LockPledge) {
  config.assert_gifting_brand<W>();
  new(parent, name_key, name, class, male, customization, created_at_ms)
}

/// The ONLY consumer of a `LockPledge`. Asserts the pledge matches `character` AND the destination `kiosk` is
/// PERSONAL (constitution — soulbound cap, no royalty-evasion), then locks it under `policy`. Composes freely: a
/// kiosk-less creator can `kiosk::new` → `personal_kiosk::new` earlier in the same PTB and lock here.
public fun lock_in_kiosk(
  pledge: LockPledge,
  character: Character,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
) {
  let LockPledge { character_id } = pledge;
  assert!(character_id == object::id(&character), EPledgeMismatch);
  assert!(personal_kiosk::is_personal(kiosk), ENotPersonalKiosk);
  kiosk.lock(cap, policy, character);
}

// ╔════════════════ [ Destroy (package-private PRIMITIVE — the door + guards live in character_extract) ] ═ ]

/// Unpack + delete. NO guards HERE by design (module-cycle law: the unequipped guard needs `equipment`, which
/// already imports this module) — the ONLY caller is `character_extract::delete_character`, which extracts the
/// kiosk-locked character through the sealed zero-price policy, asserts the guard set, emits `CharacterDeleted`,
/// and discharges the value into this destroy in the SAME call. Attached plain-data dynamic fields are orphaned
/// (see the header's DELETION note); a derived (name-claimed) UID deletes cleanly — the framework keeps the
/// `Claimed` marker on the parent, so the name stays reserved forever.
public(package) fun destroy(character: Character) {
  let Character { id, name: _, class: _, male: _, customization: _, experience: _, created_at_ms: _, anchor: _ } = character;
  id.delete();
}

// ╔════════════════ [ Anchor (signed by whoever holds the character via the kiosk cap) ] ══ ]

/// Stamp the character's world-position anchor. Owner-gated by the kiosk cap: `kiosk::borrow_mut` asserts the
/// `cap` matches the `kiosk` the character is locked in, so a non-owner cannot reach it. Validates a non-empty
/// `zone`, requires the Clock ms to be STRICTLY AFTER the last anchor (an anchor can never move into the past —
/// load-bearing for proof-of-time), then overwrites the anchor. Version-gated (enabled) like every value path.
public entry fun anchor_position(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  pos_x: u32,
  pos_z: u32,
  zone: String,
  clock: &Clock,
  version: &Version,
) {
  version.assert_enabled();
  assert!(!zone.is_empty(), EEmptyZone);
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  let now = clock.timestamp_ms();
  assert!(now > character.anchor.anchored_at_ms, EAnchorNotIncreasing);
  character.anchor = PositionAnchor { pos_x, pos_z, zone, anchored_at_ms: now };
  event::emit(PositionAnchored { character: character_id, pos_x, pos_z, zone: character.anchor.zone, anchored_at_ms: now });
}

// ╔════════════════ [ Kiosk / royalty seam — Publisher gated ] ═════════════════ ]

/// Create the `TransferPolicy<Character>` for the marketplace (version-gated; authority IS the `Publisher`).
/// Kept GENERIC: returns the policy + its cap so the ceremony composes the binding (kiosk-lock + royalty rules
/// added later by their external rules packages). This package binds NO rule itself.
public fun create_character_policy(
  publisher: &Publisher,
  version: &Version,
  ctx: &mut TxContext,
): (TransferPolicy<Character>, TransferPolicyCap<Character>) {
  version.assert_latest();
  let (policy, cap) = transfer_policy::new<Character>(publisher, ctx);
  event::emit(CharacterPolicyCreated { policy: object::id(&policy) });
  (policy, cap)
}

// ╔════════════════ [ UID access — the extension seam (&mut UID never leaves the package) ] ═ ]
// `uid_mut` is PACKAGE-PRIVATE and never widens: the in-package `aresrpg::extension` module reaches it to
// serve the cap-gated, namespace-scoped cross-package writes the SEPARATE `aresrpg_game` package needs (hp /
// stats / jobs / spells / equipment / checkpoints). The adopted topology splits progression into that different
// package, so a bare `uid_mut` is provably not enough (it cannot be called across the package boundary) — the
// `extension` cap gate is the required seam (ruling R-C1; the old "no capability-gated module needed" note here
// was void once character/progression split packages). `uid` is PUBLIC: `&UID` is read-only, so any package or
// off-chain reader inspects attached fields for free — only the `&mut UID` write path is gated.

public(package) fun uid_mut(self: &mut Character): &mut UID { &mut self.id }

public fun uid(self: &Character): &UID { &self.id }

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun id(self: &Character): ID { self.id.to_inner() }

public fun name(self: &Character): String { self.name }

public fun class(self: &Character): String { self.class }

public fun male(self: &Character): bool { self.male }

public fun customization(self: &Character): Customization { self.customization }

public fun experience(self: &Character): u64 { self.experience }

public fun created_at_ms(self: &Character): u64 { self.created_at_ms }

public fun anchor(self: &Character): PositionAnchor { self.anchor }

public fun color_1(c: &Customization): u32 { c.color_1 }
public fun color_2(c: &Customization): u32 { c.color_2 }
public fun color_3(c: &Customization): u32 { c.color_3 }

public fun anchor_pos_x(a: &PositionAnchor): u32 { a.pos_x }
public fun anchor_pos_z(a: &PositionAnchor): u32 { a.pos_z }
public fun anchor_zone(a: &PositionAnchor): String { a.zone }
public fun anchor_at_ms(a: &PositionAnchor): u64 { a.anchored_at_ms }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(CHARACTER {}, ctx) }

#[test_only]
/// Mint a `Character` from a fresh `object::new` UID (no gate / no name claim) for unit tests that exercise the
/// lock / anchor paths in isolation — the name-uniqueness path is covered by the creation-gate tests.
public fun new_for_testing(
  name: String,
  class: String,
  male: bool,
  customization: Customization,
  created_at_ms: u64,
  ctx: &mut TxContext,
): (Character, LockPledge) {
  let id = object::new(ctx);
  let cid = id.to_inner();
  let character = Character {
    id,
    name,
    class,
    male,
    customization,
    experience: 0,
    created_at_ms,
    anchor: PositionAnchor { pos_x: 0, pos_z: 0, zone: utf8(b""), anchored_at_ms: 0 },
  };
  (character, LockPledge { character_id: cid })
}
