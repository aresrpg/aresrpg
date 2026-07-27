// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONFIG — GameConfig, THE game object. ONE shared object created at init, carrying EVERY gameplay dial the
/// spec leaves admin-definable (§15's total-definability law): the §17.20 economy clamps, the §17.26 engine
/// dials, and the §17.31 per-class combat rows. Hot paths across every package take it by IMMUTABLE reference
/// (`&GameConfig`) — parallel, contention-free; the rare admin dial edit is the sole serializing write.
///
/// PLACEMENT-BY-RESPONSIBILITY: the dial setters live HERE (not in `admin`), on the module that OWNS the
/// object and its clamp bands — exactly as `aresrpg::shop` owns its own live setters. Each setter is
/// AdminCap-gated (authoring authority) + Version-gated (`assert_latest`, so the admin cap holder tunes while the package
/// is dark) + CLAMPED. Clamping is COERCION, not rejection (SPEC §17.17/.20 "shell-clamped": a compromised cap
/// can rebalance the meta but can NEVER store an out-of-band value — an over-range input is silently pinned to
/// the band edge). The ONE non-clampable input is a class INDEX: an out-of-range class id has no meaningful
/// clamp (it would silently edit the wrong class), so it ABORTS (`EBadClass`).
///
/// TWO FREEZES, TWO SCOPES: `GameConfig.enabled` is the GLOBAL game master switch — read cross-package by every
/// value path (progression xp-add here; fights/dungeons/pools later) so one flip freezes the whole economy. It
/// is DISTINCT from each package's own `version.enabled` dark-ship gate. One home per fact (Version law).
///
/// The immutable experience curves (character + job XP, `character_xp`/`job_xp`) are NOT dials — they are law,
/// hardcoded like the SPEC promises. Everything a number could shape in gameplay that ISN'T one of those curves
/// lives on this object.
module aresrpg::config;

use aresrpg::{admin::AdminCap, version::Version};
use std::string::String;
use std::type_name::{Self, TypeName};
use sui::event;

// The 12 canonical class SLUGS in the §3 roster order (index = class id). LOWERCASE — the exact form the SDK,
// the spell templates ("senshi_charge"…) and character creation use. This is the machine-readable SINGLE HOME
// of the name↔id map the roster comment below only describes in prose; `class_id_of` resolves through it (the
// combat-snapshot seam maps a character's class string to its `ClassRow`). Order MUST match `z56`.
const CLASS_SLUGS: vector<vector<u8>> = vector[
  b"senshi", b"yajin", b"ikari", b"mori", b"tokei", b"shugo",
  b"yogen", b"rojin", b"shusen", b"tomoda", b"asobi", b"iyashi",
];

// ╔════════════════ [ Class roster — SPEC §3 order, index = class id (frozen) ] ═ ]
// 0 SENSHI · 1 YAJIN · 2 IKARI · 3 MORI · 4 TOKEI · 5 SHUGO · 6 YOGEN · 7 ROJIN · 8 SHUSEN · 9 TOMODA ·
// 10 ASOBI · 11 IYASHI. The 12 classes are final (§3 "never invent others"); a class id indexes `classes`.
const CLASS_COUNT: u64 = 12;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ENotEnabled: u64 = 101; // a value path read GameConfig while the game is GLOBALLY frozen (enabled == false)
const EBadClass: u64 = 102; // a class-row setter/getter was given a class id outside 0..11 (non-clampable index)
const EDomainDisabled: u64 = 103; // this gameplay DOMAIN is dark (kill-switch bit off) — the rest of the game runs
const EWrongBrand: u64 = 104; // a brand-gated core door was called without the PINNED sibling witness (or no brand is pinned yet — doors ship closed)

// ── S-46 kill-switch DOMAIN bits (advisor rider 5): one bit per gameplay domain, asserted at that domain's
// entry doors alongside the global freeze — one incident darks ONE domain, never the whole game. Append-only.
const DOMAIN_FIGHT: u16 = 1; // overworld fight create/join
const DOMAIN_DUNGEON: u16 = 2; // dungeon activate / room fights
const DOMAIN_PVP: u16 = 4; // PvP arena lobbies (money: pledges) — enforced by the sibling arena package
const DOMAIN_MARKET: u16 = 8; // shop sales (money)
const DOMAIN_POOLS: u16 = 16; // stackable AMM pools (money)
const DOMAIN_CRAFTING: u16 = 32; // craft
const DOMAIN_GATHERING: u16 = 64; // gather
const DOMAIN_FORGEMAGIE: u16 = 128; // crush→runes→scribe (this domain grows over time)
const DOMAIN_ALL: u16 = 0xFFFF; // ships all-on; `enabled` stays the master dark-ship switch

// ╔════════════════ [ Clamp bands — the walls a compromised AdminCap can never breach ] ═ ]
// Only the DEFAULTS below are spec-pinned (§17.20/.26/.31); these BANDS are anti-footgun rails around them,
// admin-tunable within. Multipliers are stored in HUNDREDTHS of 1× (100 = 1.00×, 400 = 4.00× — §17.20 1×–4×).
const MULT_MIN: u64 = 100; // 1.00×
// The admin can crank up a x1000 xp and loot boost — for the bot test suite on test networks.
// The unit is HUNDREDTHS of 1× (100 = 1.00×), so x1000 = 100_000 (NOT 10_000, which is only x100). Overflow-safe:
// `progression_math::xp_add_capped` does `delta * mult / 100` then caps to xp_for_level, and any realistic fight
// delta × 100_000 stays far under u64. Body-only constant bump — clamp/AdminCap/events unchanged, upgrade-compatible.
const MULT_MAX: u64 = 100_000; // 1000.00× (test-network boost ceiling)
const LEVEL_MIN: u64 = 1; // a level gate / cap is never 0
const LEVEL_MAX: u64 = 200; // the character curve ceiling (§17.20 max reachable ≤ 200)
const TURN_MS_MIN: u64 = 5_000; // 5s — a turn shorter than this is unplayable
const TURN_MS_MAX: u64 = 300_000; // 5min
const PLACEMENT_MS_MIN: u64 = 5_000;
const PLACEMENT_MS_MAX: u64 = 600_000; // 10min
const CLAIM_EPOCHS_MIN: u64 = 1;
const CLAIM_EPOCHS_MAX: u64 = 365; // ~a year of epochs — well past any sane claim window
const BP_MAX: u64 = 10_000; // 100.00% in basis points (archimob chance + aging rate ceilings)
const AGING_CAP_MAX: u64 = 100_000; // +1000% — a generous ceiling on total mob aging buildup
const RECLAIM_MS_MAX: u64 = 86_400_000; // 24h
const TEAM_MIN: u64 = 1;
const TEAM_MAX: u64 = 6; // the HARD engine placement-cell bound (§17.8) — the dial may tighten, never exceed it
const HP_MIN: u64 = 10;
const HP_MAX: u64 = 300;
const AP_MIN: u64 = 1;
const AP_MAX: u64 = 12; // matches the spell-setter AP ceiling (§17.17)
const MP_MIN: u64 = 1;
const MP_MAX: u64 = 6;

// ╔════════════════ [ Defaults — the ratified values (§17.20/.26/.31) ] ═ ]
const DEFAULT_MULT: u64 = 100; // 1.00× (no boost)
const DEFAULT_MAX_LEVEL: u64 = 200;
const DEFAULT_TURN_MS: u64 = 45_000; // §17.26
const DEFAULT_PLACEMENT_MS: u64 = 60_000; // §17.26
const DEFAULT_CLAIM_EPOCHS: u64 = 7; // §17.13/.26
const DEFAULT_ARCHIMOB_BP: u64 = 50; // 0.50% (§17.26)
const DEFAULT_AGING_BP_PER_HOUR: u64 = 100; // +1.00%/h (§17.26 / §8)
const DEFAULT_AGING_CAP_BP: u64 = 10_000; // +100.00% total → reached at 100h with the default rate (§17.26)
const DEFAULT_RECLAIM_MS: u64 = 60_000; // PLACEHOLDER (§17.26 gives no default; the re-claim mechanic lands in
// aresrpg_fight §17.13) — the clamped dial is reserved now, its default tuned when fight ships.
const DEFAULT_PVP_GATE: u64 = 10; // §17.30
const DEFAULT_LISTING_GATE: u64 = 30; // §17.30 (anti-name-squat)
const DEFAULT_TEAM_SIZE: u64 = 6; // §17.8
const DEFAULT_BASE_AP: u64 = 6; // §17.31 (ANNEX §4 — 6 AP / 3 MP for ALL classes; per-class variation via setters)
const DEFAULT_BASE_MP: u64 = 3;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One class's base combat constants (§17.31). Base HP is per-class (ANNEX §4); base AP/MP default 6/3 for
/// every class but stay per-class TUNABLE via the clamped setters, so future rebalancing needs no upgrade.
public struct ClassRow has copy, drop, store {
  base_hp: u64,
  base_ap: u64,
  base_mp: u64,
}

/// THE game object. Shared once at init; ships DARK (`enabled == false`). Fields group by spec section.
public struct GameConfig has key {
  id: UID,
  enabled: bool, // GLOBAL game freeze (distinct from per-package version.enabled)
  // §17.20 — economy clamps
  xp_multiplier: u64, // hundredths of 1× (100..100_000 → 1×..1000×)
  loot_multiplier: u64, // hundredths of 1× (100..100_000 → 1×..1000×)
  max_reachable_level: u64, // 1..200 — xp earned AT the cap is DISCARDED by progression, never banked
  // §17.26 — engine dials
  turn_duration_ms: u64,
  placement_ms: u64,
  claim_window_epochs: u64,
  archimob_bp: u64, // basis points (50 = 0.5%)
  aging_bp_per_hour: u64, // basis points/hour (100 = +1%/h)
  aging_cap_bp: u64, // basis points — total aging ceiling (10_000 = +100%)
  reclaim_cooldown_ms: u64,
  pvp_level_gate: u64, // §17.30 (default 10) — the PvP-arena entry gate (read by the sibling arena package)
  listing_level_gate: u64, // §17.30 (default 30)
  team_size_bound: u64, // §17.8 engine bound on group/party/fight-side size (≤ 6)
  // S-46 kill-switch BITMASK (advisor rider 5): one bit per gameplay DOMAIN, asserted at that domain's doors
  // alongside `enabled` — one incident darks ONE domain, never the whole game. Ships ALL-ON (the global
  // `enabled` stays the master dark-ship switch); bits are defined as DOMAIN_* constants below.
  domain_enabled: u16,
  // 2026-07-12 forge split: the PINNED witness type of the extracted rune-forge sibling package. The brand-gated
  // core value doors (`*_brand` twins) refuse every witness but this one; `none` (the init default) = the doors
  // are CLOSED until the admin pins the sibling's witness post-publish. TypeName carries the DEFINING id, so the
  // pin survives sibling upgrades.
  forge_brand: Option<TypeName>,
  // 2026-07-13 gifting/dungeon split: the PINNED witness types of the two size-extracted satellite packages,
  // identical envelope to `forge_brand` (one independent single-pin per sibling — NOT an allowlist; each brand
  // door hardcodes exactly one of these). `gifting_brand` authorizes `aresrpg_gifting`'s mint/heal/character-mint
  // doors (gift/airdrop/loot_box/consume/pool/creation); `dungeon_brand` authorizes `aresrpg_dungeon`'s two fight
  // bridge doors (z35/z37). Both ship `none` (doors CLOSED until the ceremony pins).
  gifting_brand: Option<TypeName>,
  dungeon_brand: Option<TypeName>,
  // §17.31 — per-class combat rows (index = class id, exactly CLASS_COUNT rows)
  classes: vector<ClassRow>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct ConfigEnabledSet has copy, drop { enabled: bool }

/// A domain kill-switch bit flipped — carries the bit, the new state, and the full mask after the edit.
public struct DomainSet has copy, drop { bit: u16, on: bool, mask: u16 }

/// One scalar dial changed — a single event type keeps the RPC indexer watching ONE shape for every dial.
public struct DialChanged has copy, drop { dial: String, value: u64 }

/// A class row changed — carries the FULL row after the edit (class id + all three constants).
public struct ClassRowSet has copy, drop { class_id: u64, base_hp: u64, base_ap: u64, base_mp: u64 }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(GameConfig {
    id: object::new(ctx),
    enabled: false, // ships dark — the admin flips the global switch at launch
    xp_multiplier: DEFAULT_MULT,
    loot_multiplier: DEFAULT_MULT,
    max_reachable_level: DEFAULT_MAX_LEVEL,
    turn_duration_ms: DEFAULT_TURN_MS,
    placement_ms: DEFAULT_PLACEMENT_MS,
    claim_window_epochs: DEFAULT_CLAIM_EPOCHS,
    archimob_bp: DEFAULT_ARCHIMOB_BP,
    aging_bp_per_hour: DEFAULT_AGING_BP_PER_HOUR,
    aging_cap_bp: DEFAULT_AGING_CAP_BP,
    reclaim_cooldown_ms: DEFAULT_RECLAIM_MS,
    pvp_level_gate: DEFAULT_PVP_GATE,
    listing_level_gate: DEFAULT_LISTING_GATE,
    team_size_bound: DEFAULT_TEAM_SIZE,
    domain_enabled: DOMAIN_ALL,
    forge_brand: option::none(), // brand doors ship CLOSED — the ceremony pins the sibling witness
    gifting_brand: option::none(), // idem — the gifting satellite's witness is pinned at its ceremony step
    dungeon_brand: option::none(), // idem — the dungeon satellite's witness is pinned at its ceremony step
    classes: z56(),
  });
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The 12 default class rows (§17.31 / ANNEX §4). Base HP is per-class; base AP/MP = 6/3 universally.
/// Order MUST match the frozen class-id table above.
fun z56(): vector<ClassRow> {
  vector[
    row(70), // 0 SENSHI
    row(45), // 1 YAJIN
    row(120), // 2 IKARI
    row(55), // 3 MORI
    row(45), // 4 TOKEI
    row(50), // 5 SHUGO
    row(30), // 6 YOGEN
    row(50), // 7 ROJIN
    row(65), // 8 SHUSEN
    row(30), // 9 TOMODA
    row(55), // 10 ASOBI
    row(50), // 11 IYASHI
  ]
}

fun row(base_hp: u64): ClassRow { ClassRow { base_hp, base_ap: DEFAULT_BASE_AP, base_mp: DEFAULT_BASE_MP } }

// ╔════════════════ [ Global freeze ] ════════════════════════════════════════ ]

/// Abort unless the game is globally enabled — every VALUE path that takes `&GameConfig` calls this (the
/// global kill-switch). Pure reads/derivations do NOT gate on it.
public fun assert_enabled(self: &GameConfig) {
  assert!(self.enabled, ENotEnabled);
}

/// Flip the GLOBAL game switch (launch = `true`, emergency freeze = `false`). Cap-gated but NOT version-gated,
/// so an emergency global freeze always works even on a stale package version.
public fun set_enabled(cap: &AdminCap, config: &mut GameConfig, enabled: bool, ctx: &TxContext) {
  cap.verify(ctx);
  config.enabled = enabled;
  event::emit(ConfigEnabledSet { enabled });
}

// ╔════════════════ [ Per-domain kill switches (S-46 advisor rider 5) ] ═══════ ]

/// Abort unless domain `bit` is live. Every domain's ENTRY doors call this alongside the global
/// `assert_enabled` — one incident darks one domain while the rest of the game keeps running.
public fun assert_domain(self: &GameConfig, bit: u16) {
  assert!(self.domain_enabled & bit == bit, EDomainDisabled);
}

/// Flip ONE domain bit (emergency: `on = false` darks that domain). Cap-gated but NOT version-gated — an
/// emergency domain freeze must always work, exactly like the global switch.
public fun set_domain_enabled(cap: &AdminCap, config: &mut GameConfig, bit: u16, on: bool, ctx: &TxContext) {
  cap.verify(ctx);
  config.domain_enabled = if (on) config.domain_enabled | bit else config.domain_enabled & (bit ^ 0xFFFF);
  event::emit(DomainSet { bit, on, mask: config.domain_enabled });
}

/// The live domain bitmask (RPC / pre-flight read).
public fun domains(self: &GameConfig): u16 { self.domain_enabled }

public fun domain_fight(): u16 { DOMAIN_FIGHT }
public fun domain_dungeon(): u16 { DOMAIN_DUNGEON }
public fun domain_pvp(): u16 { DOMAIN_PVP }
public fun domain_market(): u16 { DOMAIN_MARKET }
public fun domain_pools(): u16 { DOMAIN_POOLS }
public fun domain_crafting(): u16 { DOMAIN_CRAFTING }
public fun domain_gathering(): u16 { DOMAIN_GATHERING }
public fun domain_forgemagie(): u16 { DOMAIN_FORGEMAGIE }

// ╔════════════════ [ Forge brand pin (2026-07-12 split — the sibling-witness gate) ] ═ ]

/// Abort unless `W` is the PINNED forge witness. First line of every brand-gated core value door (`*_brand`
/// twin): the extracted rune-forge sibling constructs its witness (private constructor, its own module only),
/// so a pinned brand makes those doors sibling-exclusive; an unpinned config (`none`) keeps them CLOSED.
public fun assert_forge_brand<W: drop>(self: &GameConfig) {
  assert!(self.forge_brand.contains(&type_name::with_defining_ids<W>()), EWrongBrand);
}

/// Pin (or re-pin) the forge sibling's witness type — the ceremony's post-publish wiring step. Cap + version
/// gated like every dial; admin is already god, so a re-pin is an accepted admin power (no once-latch).
public fun set_forge_brand<W: drop>(cap: &AdminCap, config: &mut GameConfig, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.forge_brand = option::some(type_name::with_defining_ids<W>());
  event::emit(DialChanged { dial: b"forge_brand".to_string(), value: 1 }); // the pinned TypeName is readable on this shared object
}

/// The pinned forge witness (RPC / pre-flight read; `none` = brand doors closed).
public fun forge_brand(self: &GameConfig): &Option<TypeName> { &self.forge_brand }

// ╔════════════════ [ Gifting brand pin (2026-07-13 split — the aresrpg_gifting witness gate) ] ═ ]

/// Abort unless `W` is the PINNED gifting witness — first line of every gifting-branded core value door
/// (`mint_and_lock_output_brand` / `heal_hp_brand` / `character::new_brand`). Same envelope as `assert_forge_brand`.
public fun assert_gifting_brand<W: drop>(self: &GameConfig) {
  assert!(self.gifting_brand.contains(&type_name::with_defining_ids<W>()), EWrongBrand);
}

/// Pin (or re-pin) the gifting sibling's witness type — the ceremony's post-publish wiring step. Cap + version gated.
public fun set_gifting_brand<W: drop>(cap: &AdminCap, config: &mut GameConfig, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.gifting_brand = option::some(type_name::with_defining_ids<W>());
  event::emit(DialChanged { dial: b"gifting_brand".to_string(), value: 1 });
}

/// The pinned gifting witness (RPC / pre-flight read; `none` = the gifting doors are closed).
public fun gifting_brand(self: &GameConfig): &Option<TypeName> { &self.gifting_brand }

// ╔════════════════ [ Dungeon brand pin (2026-07-13 split — the aresrpg_dungeon witness gate) ] ═ ]

/// Abort unless `W` is the PINNED dungeon witness — first line of the two dungeon-branded core fight doors
/// (`create_dungeon_fight_brand` / `join_vouched_brand`). Same envelope as `assert_forge_brand`.
public fun assert_dungeon_brand<W: drop>(self: &GameConfig) {
  assert!(self.dungeon_brand.contains(&type_name::with_defining_ids<W>()), EWrongBrand);
}

/// Pin (or re-pin) the dungeon sibling's witness type — the ceremony's post-publish wiring step. Cap + version gated.
public fun set_dungeon_brand<W: drop>(cap: &AdminCap, config: &mut GameConfig, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.dungeon_brand = option::some(type_name::with_defining_ids<W>());
  event::emit(DialChanged { dial: b"dungeon_brand".to_string(), value: 1 });
}

/// The pinned dungeon witness (RPC / pre-flight read; `none` = the dungeon doors are closed).
public fun dungeon_brand(self: &GameConfig): &Option<TypeName> { &self.dungeon_brand }

// ╔════════════════ [ §17.20 economy setters (cap + version gated, clamped) ] ═ ]

public fun set_xp_multiplier(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.xp_multiplier = clamp(value, MULT_MIN, MULT_MAX);
  event::emit(DialChanged { dial: b"xp_multiplier".to_string(), value: config.xp_multiplier });
}

public fun set_loot_multiplier(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.loot_multiplier = clamp(value, MULT_MIN, MULT_MAX);
  event::emit(DialChanged { dial: b"loot_multiplier".to_string(), value: config.loot_multiplier });
}

public fun set_max_reachable_level(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.max_reachable_level = clamp(value, LEVEL_MIN, LEVEL_MAX);
  event::emit(DialChanged { dial: b"max_reachable_level".to_string(), value: config.max_reachable_level });
}

// ╔════════════════ [ §17.26 engine-dial setters (cap + version gated, clamped) ] ═ ]

public fun set_turn_duration_ms(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.turn_duration_ms = clamp(value, TURN_MS_MIN, TURN_MS_MAX);
  event::emit(DialChanged { dial: b"turn_duration_ms".to_string(), value: config.turn_duration_ms });
}

public fun set_placement_ms(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.placement_ms = clamp(value, PLACEMENT_MS_MIN, PLACEMENT_MS_MAX);
  event::emit(DialChanged { dial: b"placement_ms".to_string(), value: config.placement_ms });
}

public fun set_claim_window_epochs(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.claim_window_epochs = clamp(value, CLAIM_EPOCHS_MIN, CLAIM_EPOCHS_MAX);
  event::emit(DialChanged { dial: b"claim_window_epochs".to_string(), value: config.claim_window_epochs });
}

public fun set_archimob_bp(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.archimob_bp = clamp(value, 0, BP_MAX);
  event::emit(DialChanged { dial: b"archimob_bp".to_string(), value: config.archimob_bp });
}

public fun set_aging_bp_per_hour(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.aging_bp_per_hour = clamp(value, 0, BP_MAX);
  event::emit(DialChanged { dial: b"aging_bp_per_hour".to_string(), value: config.aging_bp_per_hour });
}

public fun set_aging_cap_bp(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.aging_cap_bp = clamp(value, 0, AGING_CAP_MAX);
  event::emit(DialChanged { dial: b"aging_cap_bp".to_string(), value: config.aging_cap_bp });
}

public fun set_reclaim_cooldown_ms(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.reclaim_cooldown_ms = clamp(value, 0, RECLAIM_MS_MAX);
  event::emit(DialChanged { dial: b"reclaim_cooldown_ms".to_string(), value: config.reclaim_cooldown_ms });
}

public fun set_pvp_level_gate(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.pvp_level_gate = clamp(value, LEVEL_MIN, LEVEL_MAX);
  event::emit(DialChanged { dial: b"pvp_level_gate".to_string(), value: config.pvp_level_gate });
}

public fun set_listing_level_gate(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.listing_level_gate = clamp(value, LEVEL_MIN, LEVEL_MAX);
  event::emit(DialChanged { dial: b"listing_level_gate".to_string(), value: config.listing_level_gate });
}

public fun set_team_size_bound(cap: &AdminCap, config: &mut GameConfig, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  config.team_size_bound = clamp(value, TEAM_MIN, TEAM_MAX);
  event::emit(DialChanged { dial: b"team_size_bound".to_string(), value: config.team_size_bound });
}

// ╔════════════════ [ §17.31 per-class setters (cap + version gated; index aborts, value clamps) ] ═ ]

public fun set_class_base_hp(cap: &AdminCap, config: &mut GameConfig, class_id: u64, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let row = z901(config, class_id);
  row.base_hp = clamp(value, HP_MIN, HP_MAX);
  z505(config, class_id);
}

public fun set_class_base_ap(cap: &AdminCap, config: &mut GameConfig, class_id: u64, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let row = z901(config, class_id);
  row.base_ap = clamp(value, AP_MIN, AP_MAX);
  z505(config, class_id);
}

public fun set_class_base_mp(cap: &AdminCap, config: &mut GameConfig, class_id: u64, value: u64, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let row = z901(config, class_id);
  row.base_mp = clamp(value, MP_MIN, MP_MAX);
  z505(config, class_id);
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

fun clamp(v: u64, lo: u64, hi: u64): u64 {
  if (v < lo) lo else if (v > hi) hi else v
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Mutable borrow of a class row; aborts `EBadClass` on an out-of-range index (a class id can never be clamped).
fun z901(config: &mut GameConfig, class_id: u64): &mut ClassRow {
  assert!(class_id < CLASS_COUNT, EBadClass);
  &mut config.classes[class_id]
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z505(config: &GameConfig, class_id: u64) {
  let r = &config.classes[class_id];
  event::emit(ClassRowSet { class_id, base_hp: r.base_hp, base_ap: r.base_ap, base_mp: r.base_mp });
}

// ╔════════════════ [ Getters — hot paths read these off `&GameConfig` ] ═════ ]

public fun is_enabled(self: &GameConfig): bool { self.enabled }
public fun xp_multiplier(self: &GameConfig): u64 { self.xp_multiplier }
public fun loot_multiplier(self: &GameConfig): u64 { self.loot_multiplier }
public fun max_reachable_level(self: &GameConfig): u64 { self.max_reachable_level }
public fun turn_duration_ms(self: &GameConfig): u64 { self.turn_duration_ms }
public fun placement_ms(self: &GameConfig): u64 { self.placement_ms }
public fun claim_window_epochs(self: &GameConfig): u64 { self.claim_window_epochs }
public fun archimob_bp(self: &GameConfig): u64 { self.archimob_bp }
public fun aging_bp_per_hour(self: &GameConfig): u64 { self.aging_bp_per_hour }
public fun aging_cap_bp(self: &GameConfig): u64 { self.aging_cap_bp }
public fun reclaim_cooldown_ms(self: &GameConfig): u64 { self.reclaim_cooldown_ms }
public fun pvp_level_gate(self: &GameConfig): u64 { self.pvp_level_gate }
public fun listing_level_gate(self: &GameConfig): u64 { self.listing_level_gate }
public fun team_size_bound(self: &GameConfig): u64 { self.team_size_bound }
public fun class_count(): u64 { CLASS_COUNT }

/// Immutable borrow of a class row by id (aborts `EBadClass` out of range). `progression::max_hp` reads it.
public fun class_row(self: &GameConfig, class_id: u64): &ClassRow {
  assert!(class_id < CLASS_COUNT, EBadClass);
  &self.classes[class_id]
}

public fun base_hp(row: &ClassRow): u64 { row.base_hp }
public fun base_ap(row: &ClassRow): u64 { row.base_ap }
public fun base_mp(row: &ClassRow): u64 { row.base_mp }

/// Resolve a class SLUG to its class id (0..11), or `none` when it is not one of the 12 §3 classes. Pure TOTAL
/// function (never aborts) — the single home of the slug↔id map. Callers that require a class (the combat
/// snapshot) assert on the result; matching is exact against the lowercase canonical slugs (`CLASS_SLUGS`).
public fun class_id_of(class: String): Option<u64> {
  let slugs = CLASS_SLUGS; // bind once (explicit copy) — avoids the implicit-const-copy path per index
  let n = slugs.length();
  let mut i = 0;
  while (i < n) {
    if (slugs[i].to_string() == class) return option::some(i);
    i = i + 1;
  };
  option::none()
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
