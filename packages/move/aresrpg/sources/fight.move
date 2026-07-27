// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT (core doors) — the game-side gateway onto the GENERIC branded combat engine (S-46 final split). THIS
/// module owns every game semantic the engine deliberately does not know: authentic character snapshots
/// (kiosk-borrowed, gear-folded), zone-ticket provenance, the dirty-counter mark, the global freeze + the
/// FIGHT kill-switch bit, and the dial snapshot off GameConfig. TRUST = the private `FightBrand` witness
/// (constructible ONLY here): every engine create/join is branded with it, and `results::open` asserts the
/// settlement outcome echoes it — compile-time self-authentication, zero stored bindings, zero ceremony.
module aresrpg::fight;

use aresrpg::{character_link, config::{Self, GameConfig}, equipment, fight_marker, item_damages, mob_template::{Self, MobTemplate}, world::{Self as game_world, World}, zones, zones_view};
use aresrpg::{character::Character, version::Version};
use aresrpg_fight::{fight::{Self as engine, Dials, Fight, GroupBuild}, fight_registry, participant::{Self, Combatant, WeaponLine}, settlement::{Self, FightOutcome}, version::Version as EngineVersion};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::type_name::{Self, TypeName};
use sui::{clock::Clock, kiosk::Kiosk, vec_map};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EWrongWorld: u64 = 106; // create: the passed &World is not the world the GroupTicket was claimed in
const EWrongTemplate: u64 = 107; // create: the passed &MobTemplate is not the ticket's claimed template
const ECharacterMarked: u64 = 111; // seat paths: the character carries UNFINISHED BUSINESS (an unopened PvM outcome) — open it first
const EWrongBrand: u64 = 112; // release: the outcome was NOT minted under core's own FightBrand — refused
const ENotDefeat: u64 = 113; // release: the seat WON — a player victory is the one outcome that consumes the group
const EWrongGroup: u64 = 114; // release: the outcome does not belong to the named group in this world (wrong world, or a group whose fight address is not the outcome's fight)

// ╔════════════════ [ The witness (the whole trust mechanism) ] ═══════════════ ]

/// The core package's fight BRAND — constructible ONLY in this module (Move struct law). The engine stamps
/// `type_name::with_defining_ids<FightBrand>()` into every fight/outcome created through these doors.
public struct FightBrand has drop {}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The brand's TypeName — `results::open` (sibling module) asserts the outcome echo against THIS.
public(package) fun z34(): TypeName { type_name::with_defining_ids<FightBrand>() }

#[test_only]
/// Test twin of `z34` for SIBLING suites (the dungeon engine-bridge fabricates a branded `FightOutcome`).
/// Test builds only, stripped from every publish.
public fun brand_type_for_testing(): TypeName { z34() }

/// The engine-dial snapshot off the live GameConfig (multipliers included — the engine's permissionless
/// settlement reads the create-time snapshot; §8 anti-parking holds because outcomes never sample live dials).
/// PUBLIC (package-split): a sibling FEATURE package (the PvP arena) composes the same snapshot for its OWN
/// branded engine fights — one home for what "the game's dials" means; `Dials` is inert copy/drop data.
public fun dial_snapshot(config: &GameConfig): Dials {
  engine::new_dials(
    config.turn_duration_ms(), config.placement_ms(), config.team_size_bound(), config.archimob_bp(),
    config.aging_bp_per_hour(), config.aging_cap_bp(), config.xp_multiplier(), config.loot_multiplier(),
  )
}

// ╔════════════════ [ Overworld create / join (§7) ] ═══════════════════════════ ]

/// Create a Fight over a claimed world mob-group. PROVENANCE IS THE TICKET (F-02): the only spawn facts accepted
/// arrive inside `zones::GroupTicket` — the hot potato `claim_mob_group` returned after occupancy + travel-verify
/// + checkpoint-write + group removal in the SAME PTB. The creator's snapshot is assembled HERE from the
/// kiosk-borrowed character; the dirty-counter marks BEFORE the engine create; first-come stays the engine's
/// derived-address claim on `(world, spawn_id)`.
public fun create(
  registry: &mut fight_registry::FightRegistry,
  ticket: zones::GroupTicket,
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  mob_tmpl: &MobTemplate,
  is_public: bool,
  party_id: Option<ID>,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_enabled();
  config.assert_domain(config::domain_fight()); // S-46 kill-switch bit
  version.assert_enabled();
  let (t_world, t_character, spawn_id, t_template, anchor_x, anchor_z, group_size, spawned_at_ms, group_seed) =
    zones::z47(ticket);
  assert!(object::id(world) == t_world, EWrongWorld);
  assert!(mob_template::template_id(mob_tmpl) == t_template, EWrongTemplate);
  let (creator, creator_lines) = z72(kiosk, pkcap, t_character, raised_spell_ids, config, clock.timestamp_ms());
  z71(kiosk, pkcap, t_character, version);
  // The ENGAGEMENT ROUND stays 0 for all of leg 2 — #609's release path rides round 2, so every fight is a
  // first engagement, byte-identical to every fight ever created.
  engine::create_round(
    FightBrand {}, registry, t_world, spawn_id, 0, game_world::seed(world), anchor_x, anchor_z, spawned_at_ms,
    is_public, party_id, false, &mob_template::to_spec(mob_tmpl), group_size, group_seed,
    t_template, creator, creator_lines, dial_snapshot(config), engine_version, clock, ctx,
  );
}

// ╔════════════════ [ MIXED-PACK create — the member door (#1110/#1111) ] ════ ]

/// OPEN a fight over a claimed MEMBER-LIST group. Everything `create` does — ticket provenance, the authentic
/// creator snapshot, the dirty-counter mark, the #609 engagement round — happens right here, once; what follows
/// in the PTB is `add_member` per species and then `engine::create_members`.
///
/// The PTB shape exists because a pack of N species needs N `&MobTemplate` shared objects in one create, and
/// Move has no signature that takes a variable roster of them. It costs nothing in trust: the roster the ticket
/// carries is the one the zone COMMITTED, and every `add_member` is checked against it in order.
public fun open_group(
  ticket: zones::MemberGroupTicket,
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  is_public: bool,
  party_id: Option<ID>,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
): GroupBuild {
  config.assert_enabled();
  config.assert_domain(config::domain_fight()); // S-46 kill-switch bit
  version.assert_enabled();
  let (t_world, t_character, spawn_id, _t_template, members, progress, anchor_x, anchor_z, _group_size, spawned_at_ms, group_seed) =
    zones::z48(ticket);
  assert!(object::id(world) == t_world, EWrongWorld);
  let (creator, creator_lines) = z72(kiosk, pkcap, t_character, raised_spell_ids, config, clock.timestamp_ms());
  z71(kiosk, pkcap, t_character, version);
  // ENGAGEMENT ROUND 0 for all of leg 2 — #609's release path rides round 2.
  engine::open_group(
    FightBrand {}, t_world, spawn_id, 0, game_world::seed(world), anchor_x, anchor_z, spawned_at_ms,
    is_public, party_id, false, group_seed, progress, members, creator, creator_lines,
    dial_snapshot(config), engine_version,
  )
}

/// ADD the next committed member's template. `to_spec` is the same mirror `create` uses, so a member of a mixed
/// pack is combat-identical to the same species fought alone. The engine holds the only check that matters (the
/// template's id against the committed roster) — this door adds no second opinion.
public fun add_member(build: &mut GroupBuild, mob_tmpl: &MobTemplate) {
  engine::add_member(build, mob_template::template_id(mob_tmpl), &mob_template::to_spec(mob_tmpl));
}

/// Join an existing overworld fight during placement (§7 explicit join tx): carries the Clock so the seat
/// snapshot settles lazy natural regen (ANNEX §5.4) before the engine's §17.23 0-HP gate. Same anti-forgery
/// gauntlet: the snapshot is built here, the dirty-counter marks, the engine enforces seat integrity + the
/// public/party gate.
public fun join(
  fight: &mut Fight,
  registry: &mut fight_registry::FightRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  joiner_party: Option<ID>,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_enabled();
  config.assert_domain(config::domain_fight()); // S-46 kill-switch bit
  version.assert_enabled();
  let (joiner, joiner_lines) = z72(kiosk, pkcap, character_id, raised_spell_ids, config, clock.timestamp_ms());
  z71(kiosk, pkcap, character_id, version); // PvM — unfinished business
  engine::join(FightBrand {}, fight, registry, joiner, joiner_lines, option::none(), joiner_party, 0, false, engine_version, ctx);
}

// ╔════════════════ [ Dungeon / protector doors (package-internal — dungeon.move / gathering.move) ] ═ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The dungeon ROSTER-fight door (room fights): gated joins, no aging (spawned_at = now), derivation key =
/// `(scope = pass id, nonce = room)`. The dungeon module verified the RunPass upstream; this door marks the
/// dirty-counter + builds the snapshot + calls the engine branded.
public(package) fun z35(
  registry: &mut fight_registry::FightRegistry,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  mob_tmpl: &MobTemplate,
  group_size: u16,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  let (creator, creator_lines) = z72(kiosk, pkcap, character_id, raised_spell_ids, config, clock.timestamp_ms());
  z71(kiosk, pkcap, character_id, version); // dungeon fights are PvM — the mark applies
  // Dungeon composition seed: derived from (scope, nonce) — deterministic AND public (rooms are authored
  // content; re-rolling means re-running, which costs KEYS — the gate is the key burn).
  let group_seed = z906(scope) ^ nonce;
  engine::create(
    FightBrand {}, registry, scope, nonce, world_seed, anchor_x, anchor_z, clock.timestamp_ms(),
    false, option::none(), true, &mob_template::to_spec(mob_tmpl), group_size, group_seed,
    mob_template::template_id(mob_tmpl), creator, creator_lines, option::none(), dial_snapshot(config), engine_version, clock, ctx,
  );
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The PROTECTOR-AMBUSH door (§17.22): a gather's protector roll spawns a SOLO PvM fight vs the resource's
/// defender. NO ticket (unlike the overworld `create`) — the provenance is the gather's own terminal-`&Random`
/// roll, atomic in the one gather call (the roll and this spawn cannot be split across PTB commands, so the fight
/// is undodgeable). `spawn_id` + `group_seed` are drawn from the gather rng (the ambush's identity + composition);
/// `is_public = false` (your ambush — no drop-ins); spawned_at = now (an ambush ages from now, aged_bp 0). Marks the
/// gatherer (unfinished business) — the gathering caller PRE-CHECKS unmarked and SKIPS the spawn for a marked
/// gatherer, so a player already in a fight never reverts their harvest here.
public(package) fun z36(
  registry: &mut fight_registry::FightRegistry,
  world_id: ID,
  spawn_id: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  group_seed: u64,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  protector_tmpl: &MobTemplate,
  group_size: u16,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  let (creator, creator_lines) = z72(kiosk, pkcap, character_id, vector[], config, clock.timestamp_ms());
  z71(kiosk, pkcap, character_id, version); // PvM ambush — the unfinished-business mark applies
  engine::create(
    FightBrand {}, registry, world_id, spawn_id, world_seed, anchor_x, anchor_z, clock.timestamp_ms(),
    false, option::none(), false, &mob_template::to_spec(protector_tmpl), group_size, group_seed,
    mob_template::template_id(protector_tmpl), creator, creator_lines, option::none(), dial_snapshot(config), engine_version, clock, ctx,
  );
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The VOUCHED join door (dungeon rooms): the calling module verified ITS OWN entry proof (the RunPass chain);
/// the engine skips the public/party gate but keeps seat integrity. Dungeon fights are PvM — the seat marks
/// (unfinished business) and lands on team 0. (The PvP arena package brands its own engine fights and vouches
/// its own seats — this door serves the in-package dungeon only.)
public(package) fun z37(
  fight: &mut Fight,
  registry: &mut fight_registry::FightRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_enabled();
  version.assert_enabled();
  z71(kiosk, pkcap, character_id, version); // dungeon fights are PvM — the unfinished-business mark applies
  let (joiner, joiner_lines) = z72(kiosk, pkcap, character_id, raised_spell_ids, config, clock.timestamp_ms());
  engine::join(FightBrand {}, fight, registry, joiner, joiner_lines, option::none(), option::none(), 0, true, engine_version, ctx);
}

// ╔════════════════ [ Dungeon brand doors (2026-07-13 split — the aresrpg_dungeon witness gate) ] ═ ]

/// BRAND TWIN (2026-07-13 dungeon split): the room-fight create door for the PINNED dungeon sibling. The dungeon
/// module verified its RunPass upstream (the key burn is the gate); this asserts the pin then delegates to
/// `z35` verbatim. `config` carries the pin. FightBrand stays core-private inside the delegate.
public fun create_dungeon_fight_brand<W: drop>(
  _: W,
  registry: &mut fight_registry::FightRegistry,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  mob_tmpl: &MobTemplate,
  group_size: u16,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_dungeon_brand<W>();
  z35(registry, scope, nonce, world_seed, anchor_x, anchor_z, kiosk, pkcap, character_id, raised_spell_ids, mob_tmpl, group_size, config, version, engine_version, clock, ctx);
}

/// BRAND TWIN (2026-07-13 dungeon split): the ROSTER room-fight door for the PINNED dungeon sibling (#1110 ⑤).
/// The dungeon passes the room's AUTHORED member list as the commitment, so the builder's per-slot check IS the
/// room's allowlist — a room can be a boss plus its adds, and it can only be fought as exactly that.
/// `group_seed` is derived the same way `z35` derives it (deterministic + public: rooms are
/// authored content and re-rolling means re-running, which costs KEYS).
public fun open_room_group_brand<W: drop>(
  _: W,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  roster: vector<ID>,
  progress: u64,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
): GroupBuild {
  config.assert_dungeon_brand<W>();
  config.assert_enabled();
  version.assert_enabled();
  let (creator, creator_lines) = z72(kiosk, pkcap, character_id, raised_spell_ids, config, clock.timestamp_ms());
  z71(kiosk, pkcap, character_id, version); // dungeon fights are PvM — the mark applies
  engine::open_group(
    FightBrand {}, scope, nonce, 0, world_seed, anchor_x, anchor_z, clock.timestamp_ms(),
    false, option::none(), true, z906(scope) ^ nonce, progress, roster, creator, creator_lines,
    dial_snapshot(config), engine_version,
  )
}

/// BRAND TWIN (2026-07-13 dungeon split): the vouched-join door for the PINNED dungeon sibling (a party member
/// joins a room fight). Asserts the pin then delegates to `z37` verbatim.
public fun join_vouched_brand<W: drop>(
  _: W,
  fight: &mut Fight,
  registry: &mut fight_registry::FightRegistry,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  engine_version: &EngineVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_dungeon_brand<W>();
  z37(fight, registry, kiosk, pkcap, character_id, raised_spell_ids, config, version, engine_version, clock, ctx);
}

// ╔════════════════ [ Snapshot assembly + dirty mark (the game-authentic inputs) ] ═ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// PvM seat-time MARK (the unfinished-business law): pre-check unmarked (teach-don't-reject — the
/// counter's own underflow assert is the backstop), then increment the dirty counter. PvP paths never call this.
fun z71(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, version: &Version) {
  let character: &mut Character = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), character_id);
  assert!(fight_marker::is_unmarked(character), ECharacterMarked);
  fight_marker::mark(character, version);
}

/// The PUBLIC authentic-snapshot factory (package-split law): a sibling FEATURE package (the PvP arena) builds
/// its seats from the SAME assembly core doors use — one home for "what a character brings to a fight". Safe
/// public: the borrow runs through the caller's OWN `PersonalKioskCap` (ownership proof — it can only snapshot
/// characters the caller owns), the returned `Combatant` is TRUE data, and a snapshot alone seats nobody — every
/// engine create/join still demands a fight-brand witness the caller must legitimately construct. `&Clock` (not a
/// raw `now_ms`) so the regen settle timestamp is un-fakeable.
public fun combat_snapshot(
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  clock: &Clock,
): Combatant {
  // The PvP/kolizeum snapshot factory needs only the Combatant; weapon lines ride the PvM `create`/`join` doors
  // (PvP weapon strikes keep the family fallback until the arena package adopts the weapon-line seat path).
  let (c, _lines) = z72(kiosk, pkcap, character_id, raised_spell_ids, config, clock.timestamp_ms());
  c
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Assemble the AUTHENTIC combat snapshot for a kiosk-locked character: borrow through the personal-kiosk cap
/// (ownership proof), read the geared combat view (§3 scalars + folded gear stats + vit-aware max HP) with hp
/// regen-SETTLED at `now_ms` (S-69 — the raw read bricked defeated characters at the §17.23 0-HP gate forever),
/// key the §17.27 attack line off the equipped weapon family, snapshot the LEARNED spell levels (F-07). The ONE
/// Combatant factory on the live paths — a seat can never carry fabricated numbers.
fun z72(kiosk: &Kiosk, pkcap: &PersonalKioskCap, character_id: ID, raised_spell_ids: vector<ID>, config: &GameConfig, now_ms: u64): (Combatant, vector<WeaponLine>) {
  let character: &Character = kiosk.borrow(personal_kiosk::borrow(pkcap), character_id);
  let (class, level, hp, max_hp, base_ap, base_mp, stats) = equipment::geared_combat_stats_settled(character, config, now_ms);
  // §17.27 weapon line + the DECISIONS 07-12 own-class affinity: any class wields any weapon, and the equipped
  // family gets +10% when it IS the wielder's designed family. Derived HERE — the one site holding both the wielder
  // class and the equipped family — off the single home `equipped_weapon_family` (none ⇒ no affinity: bare/tool).
  let weapon_family = equipment::equipped_weapon_family(character);
  let affinity = weapon_family.is_some() && weapon_family == equipment::z14(class);
  // The `Weapon` still carries the FAMILY MECHANICS (ap_cost / reach / crit_rate — never item-authored) + the
  // single-line FALLBACK the engine uses when a seat has no authored lines (bare hands, pre-upgrade weapons).
  let weapon = participant::weapon_line_of(weapon_family, affinity);
  // §17.27 wave-2a — the equipped weapon's AUTHORED damage lines become the real strike damage: deterministic
  // midpoint base (spells' flat-base analogue; wave-2b seed-rolls in [from,to]), the same +10% own-class affinity
  // the family line takes, and crit = base × 3/2 (the WL_DAMAGE→WL_CRIT_DAMAGE ≈1.5× ratio). Empty ⇒ the engine
  // falls back to `weapon`'s single family/unarmed line — killing the WL_DAMAGE-as-combat-truth shim.
  let raw_lines = equipment::z15(character);
  let mut weapon_lines = vector[];
  let (m, mut j) = (raw_lines.length(), 0);
  while (j < m) {
    let d = raw_lines.borrow(j);
    let base = { let mid = item_damages::midpoint(d); if (affinity) mid * 110 / 100 else mid };
    weapon_lines.push_back(participant::new_weapon_line(item_damages::element_id(d), base, base * 3 / 2));
    j = j + 1;
  };
  let mut levels = vec_map::empty<ID, u8>();
  let n = raised_spell_ids.length();
  let mut i = 0;
  while (i < n) {
    let sid = *raised_spell_ids.borrow(i);
    if (!levels.contains(&sid)) {
      let lvl = character_link::spell_level(character, sid);
      if (lvl > 1) levels.insert(sid, lvl);
    };
    i = i + 1;
  };
  (participant::new_combatant(character_id, class, level, stats, hp, max_hp, base_ap, base_mp, weapon, levels), weapon_lines)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Fold an ID's 32 bytes into a u64 (the dungeon composition-seed derivation).
fun z906(id: ID): u64 {
  let bytes = object::id_to_bytes(&id);
  let mut acc = 0u64;
  let mut i = 0;
  while (i < bytes.length()) { acc = (acc << 8) ^ (acc >> 56) ^ (*bytes.borrow(i) as u64); i = i + 1; };
  acc
}
