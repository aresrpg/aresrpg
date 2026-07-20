/// CREATION — the GATE that owns character minting: the name registry, the class whitelist, the free/paid split,
/// price and pause. A single shared `Creation` object is a vending machine for characters. Two mint paths (§2):
/// `create_character_free` mints the account's FIRST character for FREE (one per ADDRESS, derivation-enforced);
/// `create_character_paid` mints any ADDITIONAL character for `price` SUI (default 10). NO WEAPON IS EVER GRANTED
/// (§17.29): characters are born bare-handed (the fight engine's unarmed line covers them) and early
/// weapons arrive as admin-authored EASY LOOT — creation mints characters, the loot economy mints gear. Both
/// paths validate the name (charset + length + global uniqueness) and the class (admin-editable whitelist), mint
/// through the package-private `character::new`, and RETURN the character with a `LockPledge` — the caller's PTB
/// resolves the pledge via `character::lock_in_kiosk`, so the character never touches a raw address (only SUI
/// change does).
///
/// PLACEMENT-BY-RESPONSIBILITY: name uniqueness, the class whitelist, the free/paid rule, price and pause live
/// HERE, on the gate that owns "who may be created and how" — NOT on the character base (a future admin-mint
/// gate has no price at all). The character base stays pure data. Authority is the package's ONE `AdminCap`
/// (shared with the item authoring surface) — no second cap type.
///
/// NAME UNIQUENESS = DERIVED OBJECTS (the proven house pattern, not a registry table): the character's own UID is
/// `derived_object::claim`ed from the normalized name under the GATE's UID, so an object already exists at that
/// derived address iff the name is taken. FREE-CHARACTER UNIQUENESS uses the SAME mechanism keyed on the sender
/// ADDRESS (`FreeCharacterKey`): claiming the per-account slot BEFORE minting makes a second free mint abort
/// on-chain — TOCTOU-proof, never trusting a lagged off-chain count. Both key types coexist under the gate's UID
/// (derived-object keys are typed, so a name-String key and a `FreeCharacterKey(address)` key never collide).
module aresrpg_gifting::creation;

use aresrpg::{admin::AdminCap, character::{Self, Character, Customization}, config::GameConfig, version::Version};
use aresrpg_gifting::gifting;
use std::string::String;
use sui::{clock::Clock, coin::Coin, derived_object, event, sui::SUI, table::{Self, Table}, tx_context::sender, zklogin_verified_issuer};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENameTaken: u64 = 101; // create_character_*: the (normalized) name is already claimed
const ENameInvalid: u64 = 102; // create_character_*: name length out of range or contains whitespace
const EUnknownClass: u64 = 103; // create_character_*: the class is not in the whitelist
const EPaused: u64 = 104; // create_character_*: creation is paused
const EInsufficientPayment: u64 = 105; // create_character_paid: payment below the price
const EFreeCharacterClaimed: u64 = 106; // create_character_free: this address already claimed its free character
// 107/108 retired (ENoStarter/EWrongStarter — the starter grant died with the "no granted
// weapons, easy loot instead" ruling); codes never renumber.
const ENotZkLoginAddress: u64 = 109; // create_character_free: sender is not a Google-derived zkLogin address (free chars are zkLogin-gated)
const ENotAppSponsored: u64 = 110; // create_character_free: a sponsor gate is configured and this tx was not sponsored by the app's gas station
const EFreeDisabled: u64 = 111; // create_character_free: the bootstrap free path is SUNSET (post-launch every character is paid)

/// The default price of an ADDITIONAL (paid) character — the existing owner dial, admin-settable via `set_price`.
const DEFAULT_PRICE_MIST: u64 = 10_000_000_000; // 10 SUI

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared creation gate. `paused` = the admin stop control; `price` = per-ADDITIONAL-character MIST (the free
/// first character ignores it); `classes` = the admin-editable class whitelist (key present = allowed, seeded
/// EMPTY). Character names AND per-account free slots are reserved as DERIVED OBJECTS under this gate's `id`
/// (see module doc), so there is no name/claim field here. Proceeds route to the fixed `@treasury` (a Move.toml
/// named address).
public struct Creation has key {
  id: UID,
  paused: bool,
  price: u64,
  classes: Table<String, bool>,
  // ── THE BOOTSTRAP BLOCK (the free path + gas station live only for the launch months; after the
  // sunset EVERY character is paid and nothing is sponsored). Everything below exists to die: sunset = ONE admin
  // flip (`set_free_enabled(false)`). Enumerated leftovers at sunset: this field pair and the `FreeCharacterKey`
  // claim records (inert history). Nothing else — no weapon is ever granted (early weapons are
  // admin-authored easy loot; fresh characters fight bare-handed).
  free_enabled: bool,
  // S-09e app-exclusivity: when set, the FREE path additionally requires the tx to be SPONSORED by this address
  // (the app's gas station — it verifies the app's OAuth `aud` off-chain, which the chain cannot). `none` = gate
  // off (testnet QA / pre-station bootstrap): the zkLogin issuer check alone applies. Paid path never checks it.
  sponsor: Option<address>,
}

/// Derived-object key for the per-account FREE-character slot, keyed on the claiming ADDRESS. Claimed once per
/// account in `create_character_free`: the claim writes a PERMANENT record on the gate, so an account can mint at
/// most one free character EVER, on-chain, regardless of any lagged off-chain count.
public struct FreeCharacterKey(address) has copy, drop, store;

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct CharacterCreated has copy, drop { character: ID, name: String, class: String, price: u64 }

public struct PriceChanged has copy, drop { price: u64 }

public struct PausedSet has copy, drop { paused: bool }

public struct ClassAdded has copy, drop { class: String }

public struct ClassRemoved has copy, drop { class: String }


public struct SponsorSet has copy, drop { sponsor: Option<address> }

public struct FreeEnabledSet has copy, drop { enabled: bool }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(Creation {
    id: object::new(ctx),
    paused: false,
    price: DEFAULT_PRICE_MIST,
    classes: table::new(ctx),
    free_enabled: true,
    sponsor: option::none(),
  });
}

// ╔════════════════ [ CREATE — free (first) / paid (additional) ] ═════════════ ]

/// Create the account's FIRST character for FREE (§2). NO weapon is granted — design ruling 2026-07-08: early weapons
/// are admin-authored EASY LOOT, and a fresh character fights bare-handed (the fight engine's unarmed line).
/// zkLogin-GATED (`address_seed` from the caller's zkLogin session): free chars are for Google-derived zkLogin
/// addresses ONLY — one Google account ⇒ one derived address ⇒ one free character, which IS the sybil economics
/// (a raw wallet, free and infinite, cannot pass and must use the paid path). Then claims the per-account free
/// slot BEFORE minting (`FreeCharacterKey(sender)` — a second free mint aborts, TOCTOU-proof), validates class +
/// name, mints the character, and RETURNS it with its `LockPledge` (no `&Random` — a composable public fn,
/// ruling R-G2). The caller's PTB locks it into a personal kiosk; a failed lock reverts the whole tx, freeing
/// the name AND the free slot.
public fun create_character_free(
  gate: &mut Creation,
  config: &GameConfig,
  raw_name: String,
  class: String,
  male: bool,
  customization: Customization,
  address_seed: u256,
  clock: &Clock,
  version: &Version,
  ctx: &mut TxContext,
): (Character, character::LockPledge) {
  version.assert_enabled();

  // BOOTSTRAP SUNSET SWITCH — the free path exists only for the launch months (see the Creation doc block);
  // after `set_free_enabled(false)` every character goes through the paid path.
  assert!(gate.free_enabled, EFreeDisabled);

  // SPONSOR GATE (S-09e app-exclusivity) — when the admin configured a sponsor, a free mint must arrive as a tx
  // SPONSORED by the app's gas station: the station verifies the app's OAuth `aud` off-chain (the one fact the
  // chain cannot check), the chain enforces "free ⇒ came through the station". Cheapest check first.
  if (gate.sponsor.is_some()) assert!(ctx.sponsor() == gate.sponsor, ENotAppSponsored);

  // zkLogin GATE — free chars are for Google zkLogin addresses ONLY: prove the sender's address was DERIVED via
  // zkLogin from Google (`check_zklogin_issuer` framework native). HONEST LIMIT (money hat 07-08): this binds
  // the ISSUER, never aud/salt — one Google account can derive MANY eligible addresses (vary salt/aud), so this
  // alone excludes only raw wallets. The REAL per-person sybil fence is the SPONSOR gate above (the station
  // verifies the app session off-chain and rate-limits per account) — CEREMONY LAW: `set_sponsor(some(station))`
  // MUST be executed before/with `enabled=true` while `free_enabled` (DECISIONS 07-08).
  let owner = sender(ctx);
  let google_issuer = b"https://accounts.google.com".to_string();
  assert!(zklogin_verified_issuer::check_zklogin_issuer(owner, address_seed, &google_issuer), ENotZkLoginAddress);

  // Claim the one-free-per-account slot BEFORE minting — the permanent on-chain record kills the
  // free→(race the indexer)→free spam hole. Concurrent free mints serialize on the shared gate; one wins.
  // (A later abort in this same tx — bad class/name — reverts the claim, so it costs nothing.)
  assert!(!derived_object::exists(&gate.id, FreeCharacterKey(owner)), EFreeCharacterClaimed);
  let free_marker = derived_object::claim(&mut gate.id, FreeCharacterKey(owner));
  object::delete(free_marker); // the record lives on the parent; the receipt UID is discarded

  mint_character(gate, config, raw_name, class, male, customization, clock.timestamp_ms(), 0)
}

/// Create an ADDITIONAL (paid) character — beyond the first free one. No free-slot claim, no starter weapon;
/// instead the player funds `payment`, of which exactly `price` MIST splits to `@treasury` (change refunded to
/// the sender). Pairing this contract-side payment with the free path's one-free-per-account claim makes the
/// free-vs-paid rule un-bypassable. Returns `(Character, LockPledge)` for the caller's PTB to lock.
///
/// `self_transfer` is deliberate: the only thing sent to the sender's address is the SUI CHANGE refund — never
/// the character (forced into the personal kiosk by the lock constitution).
#[allow(lint(self_transfer))]
public fun create_character_paid(
  gate: &mut Creation,
  config: &GameConfig,
  raw_name: String,
  class: String,
  male: bool,
  customization: Customization,
  mut payment: Coin<SUI>,
  clock: &Clock,
  version: &Version,
  ctx: &mut TxContext,
): (Character, character::LockPledge) {
  version.assert_enabled();

  let price = gate.price;
  assert!(payment.value() >= price, EInsufficientPayment);
  let due = payment.split(price, ctx);
  transfer::public_transfer(due, @treasury);
  // ONLY the SUI change (a fungible coin) is ever sent to an address — never the character.
  if (payment.value() == 0) payment.destroy_zero()
  else transfer::public_transfer(payment, sender(ctx));

  mint_character(gate, config, raw_name, class, male, customization, clock.timestamp_ms(), price)
}

/// The shared mint body both paths funnel through: not-paused → class whitelisted → normalized name unclaimed,
/// valid length, whitespace-free → mint around the name-derived UID (reserving the name on-chain). `charged` is
/// the price this mint actually took (0 for free), stamped into the event. Callers apply the free-slot / payment
/// gate BEFORE this.
fun mint_character(
  gate: &mut Creation,
  config: &GameConfig,
  raw_name: String,
  class: String,
  male: bool,
  customization: Customization,
  created_at_ms: u64,
  charged: u64,
): (Character, character::LockPledge) {
  assert!(!gate.paused, EPaused);
  assert!(gate.classes.contains(class), EUnknownClass);

  // Non-ASCII rejects with OUR code (teach-don't-reject): `to_ascii` would abort with a foreign stdlib code on
  // any é/emoji/CJK byte — a guaranteed dead-end in a 6-language product. ASCII-only names are the §2 rule.
  assert!(is_all_ascii(&raw_name), ENameInvalid);
  // Normalize (lowercase ASCII) then validate — case folds so uniqueness is case-insensitive.
  let name = raw_name.to_ascii().to_lowercase().to_string();
  let key = name_key(name);
  assert!(!derived_object::exists(&gate.id, key), ENameTaken);
  assert!(name.length() > 3 && name.length() < 20, ENameInvalid);
  assert!(!contains_whitespace(&name), ENameInvalid);

  // Mint around the name-derived UID claimed under the gate — the character's id IS that derived address, so the
  // name is reserved on-chain (a duplicate would abort in `derived_object::claim`; the pre-check gives a clean error).
  let (chr, pledge) = character::new_brand(gifting::brand(), config, &mut gate.id, key, name, class, male, customization, created_at_ms);
  event::emit(CharacterCreated { character: character::id(&chr), name, class, price: charged });
  (chr, pledge)
}

/// The derived-object key for a normalized name: `"<name>::character"` (mirrors the house convention so the same
/// normalized name always maps to the same derived address).
fun name_key(name: String): String {
  let mut key = name;
  key.append(b"::character".to_string());
  key
}

/// True if the (already-ASCII) name contains whitespace OR any control byte (0x00-0x20, 0x7F) — tabs/newlines
/// must never reach Display any more than spaces (the legacy guard checked the space byte only).
fun contains_whitespace(name: &String): bool {
  let bytes = name.as_bytes();
  let n = bytes.length();
  let mut i = 0;
  while (i < n) {
    let b = *bytes.borrow(i);
    if (b <= 32u8 || b == 127u8) return true;
    i = i + 1;
  };
  false
}

/// Every byte < 128 — the pre-`to_ascii` guard that keeps the abort code OURS.
fun is_all_ascii(name: &String): bool {
  let bytes = name.as_bytes();
  let n = bytes.length();
  let mut i = 0;
  while (i < n) {
    if (*bytes.borrow(i) >= 128u8) return false;
    i = i + 1;
  };
  true
}

// ╔════════════════ [ Admin (AdminCap + version gated — authoring runs while dark) ] ═ ]

/// Set the per-ADDITIONAL-character price (MIST). The first free character ignores it.
public fun set_price(cap: &AdminCap, gate: &mut Creation, price: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.price = price;
  event::emit(PriceChanged { price });
}

/// Pause / unpause creation (admin stop control). While paused, both create paths abort with `EPaused`.
public fun set_paused(cap: &AdminCap, gate: &mut Creation, paused: bool, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.paused = paused;
  event::emit(PausedSet { paused });
}

/// Configure the FREE path's sponsor gate (S-09e): `some(addr)` = free mints must be sponsored by `addr` (the
/// app's gas station), `none` = gate off (testnet QA / bootstrap). Rotatable when the station re-keys.
public fun set_sponsor(cap: &AdminCap, gate: &mut Creation, sponsor: Option<address>, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.sponsor = sponsor;
  event::emit(SponsorSet { sponsor });
}

/// The BOOTSTRAP SUNSET switch: `false` permanently retires the free path (every character then
/// goes through `create_character_paid`). Reversible by admin until the eventual upgrade body-kills the fn.
public fun set_free_enabled(cap: &AdminCap, gate: &mut Creation, enabled: bool, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.free_enabled = enabled;
  event::emit(FreeEnabledSet { enabled });
}

/// Add a class to the whitelist. Aborts (table dup) if already present.
public fun add_class(cap: &AdminCap, gate: &mut Creation, class: String, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.classes.add(class, true);
  event::emit(ClassAdded { class });
}

/// Remove a class from the whitelist. Aborts (table) if absent.
public fun remove_class(cap: &AdminCap, gate: &mut Creation, class: String, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  gate.classes.remove(class);
  event::emit(ClassRemoved { class });
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun price(gate: &Creation): u64 { gate.price }

public fun is_paused(gate: &Creation): bool { gate.paused }

public fun is_class(gate: &Creation, class: String): bool { gate.classes.contains(class) }

/// Has `addr` already claimed its one free character? (Reads the derived-object slot.)
public fun is_free_claimed(gate: &Creation, addr: address): bool {
  derived_object::exists(&gate.id, FreeCharacterKey(addr))
}


/// Is `raw_name` already claimed? Normalizes exactly as the create paths do, then checks the derived object.
public fun is_name_taken(gate: &Creation, raw_name: String): bool {
  if (!is_all_ascii(&raw_name)) return false; // a non-ASCII name can never be minted, so it is never taken
  let name = raw_name.to_ascii().to_lowercase().to_string();
  derived_object::exists(&gate.id, name_key(name))
}

/// Pre-flight reads for the two free-path gates (teach-don't-reject: a client offers free-mint only when open).
public fun is_free_enabled(gate: &Creation): bool { gate.free_enabled }
public fun sponsor(gate: &Creation): Option<address> { gate.sponsor }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
