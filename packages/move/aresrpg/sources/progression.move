/// PROGRESSION — the character-progression face over the FOUNDATION kernels (S-70 size split: every pure
/// formula + frozen constant moved VERBATIM to `aresrpg_foundation::progression_math`; this module stays — the
/// upgrade law forbids removing modules — as thin delegates that keep every published signature and add the
/// core-side gates/reads: the GameConfig freeze gate, the class-row base lookup). The live progression block
/// these feed (total xp / stored level / current hp / lazy-regen last-touch) is the `Progression` DYNAMIC FIELD
/// the sibling `character_link` module owns + writes; this module only computes the deltas that block stores.
module aresrpg::progression;

use aresrpg::config::{Self, GameConfig, ClassRow};
use aresrpg_foundation::{character_xp, progression_math};

/// Character level from total xp — the public progression face over the immutable 200-level curve.
public fun level_from_xp(xp: u64): u64 { character_xp::level_from_xp(xp) }

/// Stat + spell points newly granted by leveling from `from_level` to `to_level` (§3: 5 stat / 1 spell per
/// level gained). Returns `(stat_points, spell_points)`; `(0, 0)` when no level was gained.
public fun points_for_level_range(from_level: u64, to_level: u64): (u64, u64) {
  progression_math::points_for_level_range(from_level, to_level)
}

/// Add `delta` xp to `current_xp` with the §17.20 rules: the global XP multiplier scales the gain and the total
/// clamps to `max_reachable_level`'s threshold (XP earned AT the cap is DISCARDED, never banked). Refuses when
/// the game is globally frozen (`config.assert_enabled` — this is a VALUE path).
public fun xp_add_with_cap_discard(config: &GameConfig, current_xp: u64, delta: u64): u64 {
  config.assert_enabled();
  progression_math::xp_add_capped(current_xp, delta, config.xp_multiplier(), config.max_reachable_level())
}

/// Max HP for a class row at `level` with a given `vitality` — ANNEX §4c frozen formula over the row's tunable
/// per-class BASE (§17.31). Pure derivation (no freeze gate — a read used by fights/display).
public fun max_hp(row: &ClassRow, level: u64, vitality: u64): u64 {
  progression_math::max_hp_from_base(config::base_hp(row), level, vitality)
}

/// Lazy natural HP regen (ANNEX §5.4, the remainder-carry law) — `(new_hp, new_hp_updated_ms)` from the stored
/// block + `now_ms`. READ callers discard the stamp; MATERIALIZING callers (heal) store both. The full law lives
/// on the foundation kernel.
public fun regen_hp(hp: u64, hp_updated_ms: u64, max_hp: u64, level: u64, wisdom: u64, now_ms: u64): (u64, u64) {
  progression_math::regen_hp(hp, hp_updated_ms, max_hp, level, wisdom, now_ms)
}
