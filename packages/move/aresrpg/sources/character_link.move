// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHARACTER_LINK — the character-state write + read surface for progression, world, jobs, spells, equipment
/// bridges, and the game-side item mint/burn/scribe/pet doors. Historically the SINGLE seam between the game and
/// items PACKAGES; S-46 dissolved that boundary (one package now), so the four custodied `ExtensionCap`s and the
/// `CharacterLink` shared object they lived in are GONE — the writes are plain `public(package)` doors, and the
/// `namespace` for each DF write is a trusted in-package constant (`extension::ns_*`), not a cap.
///
/// This module OWNS the character DF shapes:
///   • NS_CHARACTER_WORLD  — world field, per-world checkpoints, job xp, learned-spell levels + spent-points.
///   • NS_CHARACTER_PROGRESSION — the live `Progression` block (xp / stored level / hp), born on first fight write.
///   • NS_ITEM (on a pet Item) — accumulated pet power.
/// Progression fight-writes (`grant_fight_xp` / `write_back_hp` / `heal_hp`) are `public(package)` — the fight
/// domain (same package) calls them directly inside its validated claim; a Character is owner-borrowable via its
/// kiosk cap, and `public(package)` is exactly the "only sibling aresrpg modules" authority that keeps them from
/// being a free-XP / free-HEAL hole. READS (`combat_stats` / `level` / `current_hp` / …) are FREE public views.
///
/// EQUIPMENT lives in the sibling `equipment` module (SAME package): it owns the slot map + the tool/pet reads
/// gather/zones consume. The arrow is `equipment → character_link` (it reads `level` for the equip gate), so this
/// module must not depend back on it.
module aresrpg::character_link;

use aresrpg::{
  character::{Self, Character},
  checkpoint::Checkpoint,
  config::{Self, GameConfig},
  dungeon_lock,
  extension,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  progression,
  version::Version
};
use aresrpg_foundation::character_xp;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::{clock::Clock, kiosk::{Kiosk, KioskOwnerCap}, transfer_policy::TransferPolicy};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EUnknownClass: u64 = 103; // combat_stats / xp grant: the character's class slug is not a §3 class (no ClassRow)
const ENonStackableQtyGtOne: u64 = 104; // mint_and_lock_output: a gear (non-stackable) output was authored with qty > 1
const EAlreadyFullHp: u64 = 105; // heal_hp: the character is already at full HP (blocked when pointless — SPEC §10)
const EConsumeTemplateMismatch: u64 = 106; // consume_units: the passed template != the extracted item's template
const EConsumeExceedsStack: u64 = 107; // consume_units: units requested exceeds the stack's amount
const EZeroConsume: u64 = 108; // consume_units: a consume must burn at least 1 unit
const EWrongDungeonWorld: u64 = 109; // enter_dungeon_brand: character is not in the pass's source world
const EWrongDungeonPass: u64 = 110; // exit_dungeon_brand: world field is not the pass-id lock token

// ╔════════════════ [ DF keys ] ══════════════════════════════════════════════ ]
// (all under NS_CHARACTER_WORLD unless a read names another namespace)
public struct WorldFieldKey has copy, drop, store {} // → ID (the character's current world; one world per character)
public struct CheckpointKey has copy, drop, store { world: ID } // → Checkpoint (per-world; rejoin restores it)
public struct JobXpKey has copy, drop, store { job: u8 } // → u64 total job xp
public struct SpellLevelKey has copy, drop, store { spell: ID } // → u8 invested level of one spell (absent = baseline 1)
public struct SpellPointsSpentKey has copy, drop, store {} // → u64 total spell points spent raising spells (absent = 0)
public struct StatAllocKey has copy, drop, store { stat: u8 } // → u64 points allocated to ONE stat (absent = 0)
public struct StatPointsSpentKey has copy, drop, store {} // → u64 total stat points spent allocating (absent = 0)

// ── The §3 STAT SET (single home of "what a stat is" on the character): each level from 2 grants 5 stat points to
// assign FREELY (flat 1 point → +1 stat — SPEC §3 "assign freely", NO escalating cost curve exists in code/SPEC).
// vitality→HP, wisdom→XP-gain (no code consumer yet), strength/intelligence/agility/chance→elemental damage. The
// `stat` byte in StatAllocKey is one of these; the allocation feeds the combat block via `equipment::folded_stats`.
const STAT_VITALITY: u8 = 0;
const STAT_WISDOM: u8 = 1;
const STAT_STRENGTH: u8 = 2;
const STAT_INTELLIGENCE: u8 = 3;
const STAT_AGILITY: u8 = 4;
const STAT_CHANCE: u8 = 5;
const STAT_COUNT: u8 = 6; // valid stat indices are [0, STAT_COUNT)

// ── live progression block (NS_CHARACTER_PROGRESSION) — born on the first fight xp/hp write ──
public struct ProgressionKey has copy, drop, store {} // → Progression

// ── item-side DF key (NS_ITEM, on a pet Item — the "pet power" slot) ──
public struct PetPowerKey has copy, drop, store {} // → u64 accumulated pet power on a pet Item

/// A character's LIVE progression state. `xp` is the live character xp (seeded from the base `experience` genesis
/// on first write). `level` is the §3 STORED level, recomputed on every xp grant. `hp` is current HP (write-back
/// after a fight; §17.23). `hp_updated_ms` is the lazy-regen last-touch stamp (ANNEX §5.4). `copy` for free reads.
public struct Progression has store, copy, drop {
  xp: u64,
  level: u16,
  hp: u64,
  hp_updated_ms: u64,
}

// ╔════════════════ [ World / checkpoint / job / spell writes (package-internal) ] ═ ]

/// The ONE world-namespace DF upsert (S-70 consolidation): set-or-create `key = value`. Every write below rides it.
fun set_field<K: copy + drop + store, V: drop + store>(character: &mut Character, key: K, value: V, version: &Version) {
  let ns = extension::ns_character_world();
  if (extension::character_field_exists(character, ns, key)) {
    let slot: &mut V = extension::borrow_character_field_mut(ns, character, key, version);
    *slot = value;
  } else {
    extension::add_character_field(ns, character, key, value, version);
  };
}

/// Its `+=` twin for u64 counters: add-or-create, returning the new total.
fun add_field<K: copy + drop + store>(character: &mut Character, key: K, delta: u64, version: &Version): u64 {
  let ns = extension::ns_character_world();
  if (extension::character_field_exists(character, ns, key)) {
    let slot: &mut u64 = extension::borrow_character_field_mut(ns, character, key, version);
    *slot = *slot + delta;
    *slot
  } else {
    extension::add_character_field(ns, character, key, delta, version);
    delta
  }
}

/// Set (or overwrite) the character's current world field.
public(package) fun set_world_field(character: &mut Character, world: ID, version: &Version) {
  dungeon_lock::assert_unlocked(character);
  set_field(character, WorldFieldKey {}, world, version);
}

/// OWNER-GATED world-field write — the dungeon lane's enter/restore door. Lets the CHARACTER OWNER (proven by the
/// personal-kiosk cap — `kiosk::borrow_mut` asserts the cap matches the kiosk the character is locked in) flip
/// their OWN world field. Freeze-gated. The READ side (`world_field` / `in_world`) is already public.
public fun flip_world(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  world: ID,
  version: &Version,
) {
  version.assert_enabled();
  let owner_cap = personal_kiosk::borrow(pkcap);
  let character = kiosk.borrow_mut(owner_cap, character_id);
  set_world_field(character, world, version);
}

/// Enter the dungeon represented by `pass`: the pinned sibling witness is the authority, while the personal
/// kiosk cap proves ownership of the mutably borrowed character. The pass id becomes the character's world token
/// and a dynamic lock records the only legal return world. Ordinary world joins/flips abort while it exists.
public fun enter_dungeon_brand<W: drop>(
  _: W,
  config: &GameConfig,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  pass: ID,
  world: ID,
  version: &Version,
) {
  config.assert_dungeon_brand<W>();
  version.assert_enabled();
  let character = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), character_id);
  assert!(in_world(character, world), EWrongDungeonWorld);
  set_world_field(character, pass, version);
  dungeon_lock::lock(character, pass, world);
}

/// Release a terminal/abandoned run. The same pinned witness and owner cap are required, and both the dynamic
/// lock and current world token must match this pass. `assert_latest` (not enabled) keeps exits available during
/// an emergency freeze; the pre-entry checkpoint itself is intentionally unchanged.
public fun exit_dungeon_brand<W: drop>(
  _: W,
  config: &GameConfig,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  pass: ID,
  world: ID,
  version: &Version,
) {
  config.assert_dungeon_brand<W>();
  version.assert_latest();
  let character = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), character_id);
  assert!(in_world(character, pass), EWrongDungeonPass);
  dungeon_lock::unlock(character, pass, world);
  extension::set_character_field_latest(
    extension::ns_character_world(), character, WorldFieldKey {}, world, version,
  );
}

/// Write (or overwrite) the per-world checkpoint. Rejoin restores by READING this — the write never erases the
/// OTHER worlds' checkpoints (distinct keys).
public(package) fun write_checkpoint(character: &mut Character, world: ID, cp: Checkpoint, version: &Version) {
  set_field(character, CheckpointKey { world }, cp, version);
}

/// Add `delta` job xp to `job`'s running total, returning the new total. First grant creates the slot.
public(package) fun add_job_xp(character: &mut Character, job: u8, delta: u64, version: &Version): u64 {
  add_field(character, JobXpKey { job }, delta, version)
}

/// BRAND TWIN (2026-07-12 forge split): scribe xp lands through the PINNED forge sibling's witness. Zero
/// behavior drift — delegates to `add_job_xp` verbatim.
public fun add_job_xp_brand<W: drop>(_: W, config: &GameConfig, character: &mut Character, job: u8, delta: u64, version: &Version): u64 {
  config.assert_forge_brand<W>();
  add_job_xp(character, job, delta, version)
}

/// Set (or overwrite) the character's INVESTED level for spell `spell`. First raise creates the slot; an absent
/// slot reads as the free baseline level 1. The spend door (`spell_level` module) is the only caller.
public(package) fun set_spell_level(character: &mut Character, spell: ID, level: u8, version: &Version) {
  set_field(character, SpellLevelKey { spell }, level, version);
}

/// Add `delta` to the character's running SPENT-spell-points total (first spend creates the slot). Unspent points
/// are DERIVED (earnable-from-level − spent), never banked.
public(package) fun add_spell_points_spent(character: &mut Character, delta: u64, version: &Version) {
  add_field(character, SpellPointsSpentKey {}, delta, version);
}

/// Add `delta` to the running SPENT-STAT-points total (first spend creates the slot). The stat twin of
/// `add_spell_points_spent`; unspent stat points are DERIVED (earnable-from-level − spent), never banked.
public(package) fun add_stat_points_spent(character: &mut Character, delta: u64, version: &Version) {
  add_field(character, StatPointsSpentKey {}, delta, version);
}

/// Add `delta` points to ONE stat's allocation, returning the stat's NEW allocated total (first raise creates the
/// slot). The stat twin of `set_spell_level` — but ACCUMULATES (stats grow by allocation, they aren't set to a
/// target). The spend door (`stat_allocation`) is the only caller; it charges the same `delta` against the pool.
public(package) fun add_stat_allocated(character: &mut Character, stat: u8, delta: u64, version: &Version): u64 {
  add_field(character, StatAllocKey { stat }, delta, version)
}

// ╔════════════════ [ Cross-cutting item mint / burn / scribe / pet doors ] ═══ ]

/// Mint ONE stackable item of `quantity` units through the MINT door and LOCK it into the gatherer's PERSONAL
/// kiosk in the SAME call. The `LockPledge` hot potato forces the lock (no address delivery). `mint_item_stack`
/// asserts the template's category STACKS.
public(package) fun mint_and_lock_resource(template: &ItemTemplate, quantity: u64, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext) {
  let (item, pledge) = extension::mint_item_stack(template, quantity, version, ctx);
  item::lock_in_kiosk(pledge, item, kiosk, owner_cap, policy);
}

/// BRAND TWIN (2026-07-12 forge split): the scribe's one-unit rune burn through the PINNED forge sibling's
/// witness. Zero behavior drift — delegates to `consume_units` verbatim.
public fun consume_units_brand<W: drop>(_: W, config: &GameConfig, template: &ItemTemplate, units: u64, item_id: ID, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, xpolicy: &ItemExtractPolicy, market_policy: &TransferPolicy<Item>, version: &Version, ctx: &mut TxContext): ID {
  config.assert_forge_brand<W>();
  consume_units(template, units, item_id, kiosk, pkcap, xpolicy, market_policy, version, ctx)
}

/// CONSUME exactly `units` from a kiosk-LOCKED FUNGIBLE consumable stack (`item_id`), returning the burned
/// template id. The game-side burn door the `consume` lane calls. MECHANISM — burn-all + re-mint-remainder: extract
/// the whole stack, BURN it, and — when it held MORE than `units` — RE-MINT the remainder as a fresh stack + re-lock
/// it (LockPledge constitution). For a FUNGIBLE stack this is net-identical to split. Net supply change = −`units`.
/// The passed `template` is ASSERTED equal to the extracted item's template (`EConsumeTemplateMismatch`).
public(package) fun consume_units(template: &ItemTemplate, units: u64, item_id: ID, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, xpolicy: &ItemExtractPolicy, market_policy: &TransferPolicy<Item>, version: &Version, ctx: &mut TxContext): ID {
  let (item, pledge) = extract::extract_for_burn(kiosk, pkcap, item_id, xpolicy, version, ctx);
  let amount = item::amount(&item);
  assert!(item::template(&item) == item::template_id(template), EConsumeTemplateMismatch);
  assert!(units >= 1, EZeroConsume);
  assert!(units <= amount, EConsumeExceedsStack);
  let (tid, _burned) = extract::burn(pledge, item, version);
  let remainder = amount - units;
  if (remainder >= 1) {
    let (stack, lock_pledge) = extension::mint_item_stack(template, remainder, version, ctx);
    item::lock_in_kiosk(lock_pledge, stack, kiosk, personal_kiosk::borrow(pkcap), market_policy);
  };
  tid
}

/// MINT a craft/crush OUTPUT of `quantity` units through the MINT door and LOCK it into the holder's personal kiosk
/// in the same call, RETURNING the minted item's id (the pool ghost-refill seam reads it; other callers ignore
/// the droppable ID). Branches on the output template's category: a STACKABLE output rides as ONE stack; a
/// non-stackable output (a gear NFT) mints exactly ONE (`ENonStackableQtyGtOne` if a recipe mis-authors qty > 1).
/// `stat_seed` is the gear roll's entropy (#758), forwarded to the mint door — the craft path draws it from the
/// SAME terminal `&Random` generator that rolled the craft's success; a stackable output ignores it.
public(package) fun mint_and_lock_output(template: &ItemTemplate, quantity: u64, stat_seed: Option<u64>, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext): ID {
  let (item, pledge) = if (item::is_stackable_category(item::template_category(template))) {
    extension::mint_item_stack(template, quantity, version, ctx)
  } else {
    assert!(quantity == 1, ENonStackableQtyGtOne);
    extension::mint_item(template, stat_seed, version, ctx)
  };
  let item_id = object::id(&item);
  item::lock_in_kiosk(pledge, item, kiosk, owner_cap, policy);
  item_id
}

/// BRAND TWIN (2026-07-13 gifting split): claim-mint + kiosk-lock for the PINNED gifting sibling — the ONE mint
/// door airdrop/loot_box/pool/creation-adjacent flows ride (returns the minted id for pool's ghost-refill merge).
/// Delegates to `mint_and_lock_output` after asserting the pin. `config` carries the pin; the
/// `LockPledge` inside the delegate still type-forces the personal-kiosk lock (kiosk-lock constitution).
///
/// NO STAT SEED (#758): this signature is FROZEN by upgrade compatibility, so the sibling has no channel to hand
/// its own `&Random` entropy through — a gear item minted here still lands with a blank block, and inventing a
/// `ctx`-derived seed instead would hand the caller free dry-run re-rolls. The gifting sibling gets a seeded door
/// of its own at its next publish (#777); its live flows mint stackables, which never roll.
public fun mint_and_lock_output_brand<W: drop>(_: W, config: &GameConfig, template: &ItemTemplate, quantity: u64, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext): ID {
  config.assert_gifting_brand<W>();
  mint_and_lock_output(template, quantity, option::none(), version, kiosk, owner_cap, policy, ctx)
}


/// GROW a pet item's power by `delta` — a `u64` NS_ITEM dynamic field on the pet `Item`. First feed creates the
/// slot. Checked add (aborts on the astronomically-unlikely overflow, never wraps).
public(package) fun grow_pet_power(pet: &mut Item, delta: u64, version: &Version) {
  let ns = extension::ns_item();
  let key = PetPowerKey {};
  if (extension::item_field_exists(pet, ns, key)) {
    let slot: &mut u64 = extension::borrow_item_field_mut(ns, pet, key, version);
    *slot = *slot + delta;
  } else {
    extension::add_item_field(ns, pet, key, delta, version);
  };
}

// ╔════════════════ [ Progression fight-writes (public(package) — the fight domain calls directly) ] ═ ]

/// Grant fight/quest xp to the character's LIVE progression. Reads the current xp (seeded from the base
/// `experience` genesis on first grant), adds through the pure `progression::xp_add_with_cap_discard` (global XP
/// multiplier + max-level cap-discard + global-freeze gate), then RECOMPUTES + STORES the level (§3). The block is
/// born (full HP) on the first grant.
public(package) fun grant_fight_xp(config: &GameConfig, character: &mut Character, xp: u64, version: &Version) {
  let ns = extension::ns_character_progression();
  let key = ProgressionKey {};
  if (extension::character_field_exists(character, ns, key)) {
    let slot: &mut Progression = extension::borrow_character_field_mut(ns, character, key, version);
    let new_xp = progression::xp_add_with_cap_discard(config, slot.xp, xp);
    slot.xp = new_xp;
    slot.level = (character_xp::level_from_xp(new_xp) as u16);
  } else {
    let new_xp = progression::xp_add_with_cap_discard(config, character.experience(), xp);
    let level = (character_xp::level_from_xp(new_xp) as u16);
    let hp = progression::max_hp(config::class_row(config, resolve_class_id(character)), (level as u64), stat_allocated(character, STAT_VITALITY));
    extension::add_character_field(ns, character, key, Progression { xp: new_xp, level, hp, hp_updated_ms: 0 }, version);
  };
}

/// Write the post-fight HP back to the character's progression block (§17.23 — a 0-HP character cannot enter the
/// next fight). `hp` is already bounded to [0, max_hp] by the fight engine; `now_ms` stamps the lazy-regen
/// last-touch (ANNEX §5.4). Creates the block (seeded from the base experience genesis) if none yet.
#[test_only]
/// Test twin of the package-private `write_back_hp` for SIBLING suites (gifting consume): wound a character to a
/// chosen hp so a heal has room. Test builds only, stripped from every publish.
public fun write_back_hp_for_testing(character: &mut Character, hp: u64, now_ms: u64, version: &Version) {
  write_back_hp(character, hp, now_ms, version)
}

public(package) fun write_back_hp(character: &mut Character, hp: u64, now_ms: u64, version: &Version) {
  let ns = extension::ns_character_progression();
  let key = ProgressionKey {};
  if (extension::character_field_exists(character, ns, key)) {
    let slot: &mut Progression = extension::borrow_character_field_mut(ns, character, key, version);
    slot.hp = hp;
    slot.hp_updated_ms = now_ms;
  } else {
    let genesis = character.experience();
    let level = (character_xp::level_from_xp(genesis) as u16);
    extension::add_character_field(ns, character, key, Progression { xp: genesis, level, hp, hp_updated_ms: now_ms }, version);
  };
}

/// HEAL the character's live progression HP by `amount` — the CONSUMABLE-USE seam. SETTLES lazy natural regen at
/// `now_ms` FIRST (ANNEX §5.4 remainder-carry via `progression::regen_hp`), then adds the heal capped at max_hp.
/// ABORTS `EAlreadyFullHp` when already full AFTER that regen settle (a heal at full HP is pointless, SPEC §10 —
/// the caller's tx reverts so the consumable is NOT wasted). A block-less character is at FULL HP by definition, so
/// it has nothing to heal → `EAlreadyFullHp`. `amount` is the per-unit magnitude × used quantity (caller-batched).
public(package) fun heal_hp(config: &GameConfig, character: &mut Character, amount: u64, now_ms: u64, version: &Version) {
  assert!(has_progression(character), EAlreadyFullHp); // block-less ⇒ full HP ⇒ nothing to heal (no block is created)
  let ns = extension::ns_character_progression();
  let level = level(character);
  let max_hp = progression::max_hp(config::class_row(config, resolve_class_id(character)), level, stat_allocated(character, STAT_VITALITY));
  let slot: &mut Progression = extension::borrow_character_field_mut(ns, character, ProgressionKey {}, version);
  let (regenerated, stamp) = progression::regen_hp(slot.hp, slot.hp_updated_ms, max_hp, level, 0, now_ms);
  assert!(regenerated < max_hp, EAlreadyFullHp); // regen already topped them off — the heal is pointless
  if (regenerated + amount >= max_hp) { slot.hp = max_hp; slot.hp_updated_ms = now_ms; } // reached full — no remainder to bank
  else { slot.hp = regenerated + amount; slot.hp_updated_ms = stamp; }; // carry the regen remainder stamp (§5.4)
}

/// BRAND TWIN (2026-07-13 gifting split): the consumable HEAL through the PINNED gifting sibling's witness (the
/// extracted `consume` module drives it). Zero behavior drift — delegates to `heal_hp` verbatim after the pin.
public fun heal_hp_brand<W: drop>(_: W, config: &GameConfig, character: &mut Character, amount: u64, now_ms: u64, version: &Version) {
  config.assert_gifting_brand<W>();
  heal_hp(config, character, amount, now_ms, version)
}

// ╔════════════════ [ Combat snapshot read (the fight seam — dependency-inverted, FREE) ] ═ ]

/// The character combat scalars `(class, level, hp, max_hp, base_ap, base_mp)`, dependency-INVERTED (fight →
/// game). RAW read: hp is the STORED block value, natural regen UN-settled — the fight seam uses
/// `combat_stats_settled` below (S-69: seating off THIS read bricked defeated characters at hp=0 forever).
/// DEFAULTS path (never aborts on a fresh character): level = the curve over base experience, hp = FULL; once the
/// progression DF exists, level + hp read the stored block. `EUnknownClass` if the slug is not a §3 class.
public fun combat_stats(character: &Character, config: &GameConfig): (String, u64, u64, u64, u64, u64) {
  combat_scalars(character, config, option::none())
}

/// `combat_stats` with hp SETTLED for lazy natural regen at `now_ms` (ANNEX §5.4) — THE fight-entry snapshot
/// (S-69 defeat-brick fix: the RAW read fed a stored post-defeat hp=0 into every fight door FOREVER, bricking the
/// character on the engine's §17.23 EZeroHp gate). The settle is VIRTUAL (read-only — no re-stamp): every fight
/// exit rewrites hp via `write_back_hp`, so storage never diverges. `combat_stats` stays raw for block readers.
public fun combat_stats_settled(character: &Character, config: &GameConfig, now_ms: u64): (String, u64, u64, u64, u64, u64) {
  combat_scalars(character, config, option::some(now_ms))
}

/// The ONE scalar-snapshot core behind the raw/settled pair: `settle_at_ms = some(now)` regen-settles the stored
/// hp VIRTUALLY; `none` reports storage. Block-less = full HP (defaults path — never aborts on a fresh character).
fun combat_scalars(character: &Character, config: &GameConfig, settle_at_ms: Option<u64>): (String, u64, u64, u64, u64, u64) {
  let row = config::class_row(config, resolve_class_id(character));
  let level = level(character);
  let max_hp = progression::max_hp(row, level, stat_allocated(character, STAT_VITALITY)); // allocated vitality (S-stat rider); the geared read (equipment::fold_gear) re-adds gear vitality on top
  let hp = if (has_progression(character)) {
    let block = progression_block(character);
    if (settle_at_ms.is_some()) {
      let (settled, _stamp) = progression::regen_hp(block.hp, block.hp_updated_ms, max_hp, level, 0, settle_at_ms.destroy_some());
      settled
    } else block.hp
  } else max_hp; // fresh = full HP
  (character::class(character), level, hp, max_hp, config::base_ap(row), config::base_mp(row))
}

// ╔════════════════ [ Reads (FREE — on-chain state is public) ] ═══════════════ ]

public fun world_field(character: &Character): Option<ID> {
  let ns = extension::ns_character_world();
  let key = WorldFieldKey {};
  if (extension::character_field_exists(character, ns, key)) {
    option::some(*extension::borrow_character_field<WorldFieldKey, ID>(character, ns, key))
  } else {
    option::none()
  }
}

public fun in_world(character: &Character, world: ID): bool {
  let f = world_field(character);
  f.is_some() && *f.borrow() == world
}

public fun has_checkpoint(character: &Character, world: ID): bool {
  extension::character_field_exists(character, extension::ns_character_world(), CheckpointKey { world })
}

/// The per-world checkpoint (by value — aborts if the character never joined `world`; guard with `has_checkpoint`).
public fun checkpoint(character: &Character, world: ID): Checkpoint {
  *extension::borrow_character_field<CheckpointKey, Checkpoint>(character, extension::ns_character_world(), CheckpointKey { world })
}

/// The character's CHARACTER level — the STORED progression level once a fight has granted xp (§3), else the base
/// `experience` through the immutable curve (a fresh character has no block → level 1).
public fun level(character: &Character): u64 {
  if (has_progression(character)) (progression_block(character).level as u64)
  else character_xp::level_from_xp(character.experience())
}

/// Does the character have a live progression block yet? (Born on the first fight xp/hp write.)
public fun has_progression(character: &Character): bool {
  extension::character_field_exists(character, extension::ns_character_progression(), ProgressionKey {})
}

/// Current HP from the live progression block. Aborts if none — guard with `has_progression` (or read via
/// `combat_stats`, which defaults a block-less character to full HP).
public fun progression_hp(character: &Character): u64 { progression_block(character).hp }

/// EFFECTIVE current HP right now — the stored post-fight HP PLUS lazy natural regen accrued since the last touch
/// (ANNEX §5.4). The display read; a block-less character reads FULL. Free read (a pure read never re-stamps).
/// Thin over `combat_stats_settled` — ONE home for the virtual settle (S-69).
public fun current_hp(character: &Character, config: &GameConfig, clock: &Clock): u64 {
  let (_class, _level, hp, _max_hp, _ap, _mp) = combat_stats_settled(character, config, clock.timestamp_ms());
  hp
}

/// A pet item's accumulated POWER (0 before its first feed). Free read.
public fun pet_power(pet: &Item): u64 {
  let ns = extension::ns_item();
  let key = PetPowerKey {};
  if (extension::item_field_exists(pet, ns, key)) *extension::borrow_item_field<PetPowerKey, u64>(pet, ns, key)
  else 0
}

/// Running job xp for `job` (0 when the character has never worked it).
public fun job_xp(character: &Character, job: u8): u64 {
  let ns = extension::ns_character_world();
  let key = JobXpKey { job };
  if (extension::character_field_exists(character, ns, key)) {
    *extension::borrow_character_field<JobXpKey, u64>(character, ns, key)
  } else {
    0
  }
}

/// A character's INVESTED level for spell `spell` — the FREE fight-snapshot seam the resolver reads. Absent ⇒
/// baseline level 1 (§3/§7: a class spell is usable at level 1 for free; spell points raise it).
public fun spell_level(character: &Character, spell: ID): u8 {
  let ns = extension::ns_character_world();
  let key = SpellLevelKey { spell };
  if (extension::character_field_exists(character, ns, key)) {
    *extension::borrow_character_field<SpellLevelKey, u8>(character, ns, key)
  } else {
    1
  }
}

/// Total spell points the character has SPENT raising spells (0 before the first spend).
public fun spell_points_spent(character: &Character): u64 {
  let ns = extension::ns_character_world();
  let key = SpellPointsSpentKey {};
  if (extension::character_field_exists(character, ns, key)) {
    *extension::borrow_character_field<SpellPointsSpentKey, u64>(character, ns, key)
  } else {
    0
  }
}

/// UNSPENT spell points = points EARNED by leveling (§3: 1 per level from 2 ⇒ (level−1) total) MINUS points
/// already spent. Derived, never banked. Saturating — floors at 0.
public fun unspent_spell_points(character: &Character): u64 {
  let (_stat, earnable) = progression::points_for_level_range(1, level(character));
  let spent = spell_points_spent(character);
  if (earnable > spent) earnable - spent else 0
}

/// Points allocated to ONE stat (0 before the first allocation) — the FREE read `equipment::folded_stats` folds
/// into the combat block and the HP formula reads for `STAT_VITALITY`. `stat` is a §3 stat index [0, STAT_COUNT).
public fun stat_allocated(character: &Character, stat: u8): u64 {
  let ns = extension::ns_character_world();
  let key = StatAllocKey { stat };
  if (extension::character_field_exists(character, ns, key)) {
    *extension::borrow_character_field<StatAllocKey, u64>(character, ns, key)
  } else {
    0
  }
}

/// Total stat points the character has SPENT allocating (0 before the first spend). The stat twin of
/// `spell_points_spent`.
public fun stat_points_spent(character: &Character): u64 {
  let ns = extension::ns_character_world();
  let key = StatPointsSpentKey {};
  if (extension::character_field_exists(character, ns, key)) {
    *extension::borrow_character_field<StatPointsSpentKey, u64>(character, ns, key)
  } else {
    0
  }
}

/// UNSPENT stat points = the STAT half of §3's per-level grant (5 per level from 2 ⇒ (level−1)×5 total, the
/// currently-discarded `.0` of `points_for_level_range`) MINUS points already spent. Derived, never banked.
/// Saturating — floors at 0. The stat twin of `unspent_spell_points`.
public fun unspent_stat_points(character: &Character): u64 {
  let (earnable, _spell) = progression::points_for_level_range(1, level(character));
  let spent = stat_points_spent(character);
  if (earnable > spent) earnable - spent else 0
}

// ── §3 stat-set accessors (single home of the stat indices; the door validates against `stat_count`) ──
public fun stat_vitality(): u8 { STAT_VITALITY }
public fun stat_wisdom(): u8 { STAT_WISDOM }
public fun stat_strength(): u8 { STAT_STRENGTH }
public fun stat_intelligence(): u8 { STAT_INTELLIGENCE }
public fun stat_agility(): u8 { STAT_AGILITY }
public fun stat_chance(): u8 { STAT_CHANCE }
public fun stat_count(): u8 { STAT_COUNT }

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

fun progression_block(character: &Character): Progression {
  *extension::borrow_character_field<ProgressionKey, Progression>(character, extension::ns_character_progression(), ProgressionKey {})
}

/// Resolve the character's class SLUG to its GameConfig class id, aborting `EUnknownClass` if it is not a §3 class.
fun resolve_class_id(character: &Character): u64 {
  let cid = config::class_id_of(character::class(character));
  assert!(cid.is_some(), EUnknownClass);
  cid.destroy_some()
}
