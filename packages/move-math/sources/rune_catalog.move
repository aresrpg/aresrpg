// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RUNE CATALOG — the Retro/1.29 rune system as HARDCODED LAW (owner 2026-08-11: "hardcoding
/// runes is correct since they won't change nor their weight"). PURE data + accessors: no
/// objects, no state. The scribe (`forge::apply_rune`) and crush (`forge::crush_lines`) lanes
/// read this table; the game door reads `rune_of` to turn a rune ITEM into its catalog coords.
///
/// ── STAT-ID SPACE ────────────────────────────────────────────────────────────────────────
/// A rune targets one of the 17 `item_stats` fields, indexed 0..16 in DECLARATION ORDER. Every
/// table below is indexed by this id. The game side converts an item's centered `ItemStatistics`
/// ↔ the raw `vector<u64>` these libs consume (`item_stats::to_raw`).
///
/// ── WEIGHT SCALE (×5) ────────────────────────────────────────────────────────────────────
/// Retro's Vitalité weighs 0.2/point — fractional. ALL weights are stored ×5 (`WEIGHT_SCALE`)
/// so every weight is an integer and the puits ledger never goes fractional; the scale cancels
/// exactly everywhere it matters.
///
/// ── RUNE IDENTITY (engine-canonical slugs) ─────────────────────────────────────────────────
/// Each rune is a hardcoded stackable item template whose `item_type` is `rune_<stat>_<tier>`
/// (e.g. `rune_strength_ra`). `rune_of` maps that frozen slug → (stat, tier); the seed authors
/// the templates to match. Single-tier majors carry `_ba` only.
///
/// | id | field            | Ba amt | Pa amt | Ra amt | unit wt ×5 | max apps |
/// |----|------------------|--------|--------|--------|------------|----------|
/// |  0 | vitality         |   3    |  10    |  30    |     1      |    ∞     |
/// |  1 | wisdom           |   1    |   3    |  10    |    15      |    ∞     |
/// |  2 | strength         |   1    |   3    |  10    |     5      |    ∞     |
/// |  3 | intelligence     |   1    |   3    |  10    |     5      |    ∞     |
/// |  4 | chance           |   1    |   3    |  10    |     5      |    ∞     |
/// |  5 | agility          |   1    |   3    |  10    |     5      |    ∞     |
/// |  6 | range            |   1    |   —    |   —    |   255      |    1     |
/// |  7 | movement (+1 PM) |   1    |   —    |   —    |   450      |    1     |
/// |  8 | action   (+1 PA) |   1    |   —    |   —    |   500      |    1     |
/// |  9 | critical (+1 Cri)|   1    |   —    |   —    |    50      |   10     |
/// | 10 | raw_damage (Do)  |   1    |   —    |   —    |   100      |    ∞     |
/// | 11 | earth_resistance |   1    |   3    |  10    |    10      |    ∞     |
/// | 12 | fire_resistance  |   1    |   3    |  10    |    10      |    ∞     |
/// | 13 | water_resistance |   1    |   3    |  10    |    10      |    ∞     |
/// | 14 | air_resistance   |   1    |   3    |  10    |    10      |    ∞     |
/// (crit-rate/damage are weapon settings, not stats — they left the block, owner 2026-08-11)
///
/// Rune WEIGHT is DERIVED `amount × unit_weight` (exact for every row — the puits-conservation
/// law: destroying the points a rune added releases exactly the rune's weight), never stored twice.
module aresrpg_math::rune_catalog;

use std::string::String;

// ╔════════════════ [ Space + scale ] ════════════════════════════════════════ ]

const STAT_COUNT: u64 = 15;
const WEIGHT_SCALE: u64 = 5;

const TIER_BA: u8 = 1;
const TIER_PA: u8 = 2;
const TIER_RA: u8 = 3;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EBadStat: u64 = 1; // stat id outside 0..16
const ENotRuneable: u64 = 2; // (stat, tier) has no rune in the catalog
const EUnknownRune: u64 = 3; // rune_of: the item_type is not a catalog rune slug

// ╔════════════════ [ Tables (index = stat id 0..16) ] ══════════════════════ ]

/// Forgemagie unit weight per point, ×5 — every one of the 15 stats is runeable.
const UNIT_WEIGHTS: vector<u64> = vector[1, 15, 5, 5, 5, 5, 255, 450, 500, 50, 100, 10, 10, 10, 10];

/// 1 = a rune can target this field. All 15 are runeable now (the crit-rate settings that were
/// the only non-runeable fields have left the stat block — owner 2026-08-11).
const RUNEABLE: vector<u8> = vector[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/// Hard per-item application cap (0 = uncapped): range/movement/action 1, Cri 10.
const MAX_APPS: vector<u64> = vector[0, 0, 0, 0, 0, 0, 1, 1, 1, 10, 0, 0, 0, 0, 0];

/// Stat points added per rune, per tier (0 = that tier has no rune). Single-tier majors: Ba only.
const BA_AMOUNT: vector<u64> = vector[3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const PA_AMOUNT: vector<u64> = vector[10, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 3, 3, 3, 3];
const RA_AMOUNT: vector<u64> = vector[30, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 10, 10, 10, 10];

// ╔════════════════ [ Space + tier accessors ] ══════════════════════════════ ]

public fun stat_count(): u64 { STAT_COUNT }

public fun weight_scale(): u64 { WEIGHT_SCALE }

public fun tier_ba(): u8 { TIER_BA }

public fun tier_pa(): u8 { TIER_PA }

public fun tier_ra(): u8 { TIER_RA }

// ╔════════════════ [ Per-stat accessors ] ═══════════════════════════════════ ]

/// Forgemagie unit weight (per point, ×5) of `stat` — the gain-cap divisor, the
/// `select_stat_to_reduce` price, and the crush base. Defined for ALL 17 fields.
public fun stat_unit_weight(stat: u8): u64 {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = UNIT_WEIGHTS;
  t[stat as u64]
}

/// True iff a rune can be SCRIBED onto `stat` — every one of the 15 stats is runeable.
public fun is_runeable(stat: u8): bool {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = RUNEABLE;
  t[stat as u64] == 1
}

/// Hard cap on how many of this rune may sit on one item (0 = uncapped).
public fun rune_max_apps(stat: u8): u64 {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = MAX_APPS;
  t[stat as u64]
}

/// The highest tier that exists for `stat`: 3 for multi-tier stats, 1 for single-tier majors,
/// 0 for a non-runeable stat.
public fun max_tier(stat: u8): u8 {
  if (!is_runeable(stat)) return 0;
  let t = RA_AMOUNT;
  if (t[stat as u64] > 0) TIER_RA else TIER_BA
}

/// True iff `(stat, tier)` names a real rune (runeable stat, populated tier).
public fun has_rune(stat: u8, tier: u8): bool {
  if (!is_runeable(stat)) return false;
  if (tier < TIER_BA || tier > TIER_RA) return false;
  tier_amount_vec(tier)[stat as u64] != 0
}

/// Stat points a `(stat, tier)` rune adds on application (the scribe `rune.value`).
public fun rune_amount(stat: u8, tier: u8): u64 {
  assert!(has_rune(stat, tier), ENotRuneable);
  tier_amount_vec(tier)[stat as u64]
}

/// Forgemagie WEIGHT (×5) of a `(stat, tier)` rune — DERIVED `amount × unit_weight` (the
/// puits-conservation law). The puits cost on scribe + the crush base denominator.
public fun rune_weight(stat: u8, tier: u8): u64 {
  rune_amount(stat, tier) * stat_unit_weight(stat)
}

// ╔════════════════ [ rune_of — the frozen slug → (stat, tier) map ] ═════════ ]

/// Map a rune item's `item_type` slug (`rune_<stat>_<tier>`) to its catalog coords. Aborts if
/// the slug is not a catalog rune — the scribe door asserts a real rune this way, no registry.
public fun rune_of(item_type: String): (u8, u8) {
  let mut s = 0;
  while (s < STAT_COUNT) {
    let stat = s as u8;
    if (is_runeable(stat)) {
      let mut tier = TIER_BA;
      while (tier <= max_tier(stat)) {
        if (has_rune(stat, tier) && slug(stat, tier) == item_type) return (stat, tier);
        tier = tier + 1;
      };
    };
    s = s + 1;
  };
  abort EUnknownRune
}

/// The canonical `item_type` of the `(stat, tier)` rune — `rune_<stat>_<tier>`. The single home
/// of the rune-naming law; the seed authors templates at these exact slugs.
public fun slug(stat: u8, tier: u8): String {
  let mut out = b"rune_".to_string();
  out.append(stat_slug(stat));
  out.append(b"_".to_string());
  out.append(tier_slug(tier));
  out
}

// ╔════════════════ [ Internal selectors ] ══════════════════════════════════ ]

fun tier_amount_vec(tier: u8): vector<u64> {
  if (tier == TIER_BA) BA_AMOUNT
  else if (tier == TIER_PA) PA_AMOUNT
  else RA_AMOUNT
}

fun tier_slug(tier: u8): String {
  if (tier == TIER_BA) b"ba".to_string()
  else if (tier == TIER_PA) b"pa".to_string()
  else b"ra".to_string()
}

fun stat_slug(stat: u8): String {
  let names = vector[
    b"vitality", b"wisdom", b"strength", b"intelligence", b"chance", b"agility", b"range",
    b"movement", b"action", b"critical", b"raw_damage",
    b"earth_resistance", b"fire_resistance", b"water_resistance", b"air_resistance",
  ];
  names[stat as u64].to_string()
}
