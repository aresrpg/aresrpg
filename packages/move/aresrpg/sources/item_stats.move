/// ITEM STATISTICS — the typed stat block attached as a DYNAMIC FIELD to an `ItemTemplate`. The item base owns
/// the storage (it exposes the template UID package-privately); THIS module owns the data shape + the attach/read
/// (placement law — meaning lives in DATA). Ported verbatim from the legacy stat block: 17 `u16` fields, ALL
/// CENTERED at `SHIFT_U16` (32768) so a malus is simply a value below centre and no signed integers are ever
/// needed on-chain. The dead `stamina` / `summons` / `pods` fields are intentionally NOT carried.
///
/// MINT-ROLL RANDOMNESS: the admin authoring path sets [min,max] RANGES on the TEMPLATE (`attach_ranges`, via
/// `admin::create_template`); `shop::buy` ROLLS each field uniformly in [min,max] AT PURCHASE (single-step, off
/// `&Random`) and attaches the FIXED result to the minted ITEM (`attach_rolled`). Reads: template ranges via
/// `stats_min`/`stats_max`, the rolled instance via `rolled_stats`. The centering is a CONVENTION — the caller
/// passes already-centered values; the chain stores them raw and enforces no schema.
module aresrpg::item_stats;

use aresrpg::item::{Self, Item, ItemTemplate};
use sui::{dynamic_field as df, random::RandomGenerator};

/// The zero-point every stat is centered on: stored value = 32768 + signed_stat.
const SHIFT_U16: u16 = 32_768;
const PET_FULL_FEEDS: u64 = 60;
const EInvalidScale: u64 = 101;

/// The typed DF key the ROLLED stat block hangs under on a minted item's UID (attached at buy).
public struct StatsKey has copy, drop, store {}

/// The typed DF keys the [min,max] roll ranges hang under on the TEMPLATE's UID. The template carries the
/// AUTHORED range per stat (mint-roll randomness law); a minted item carries the single ROLLED block (StatsKey).
public struct StatsMinKey has copy, drop, store {}
public struct StatsMaxKey has copy, drop, store {}

/// The 17-field stat block (all values centered at `SHIFT_U16`). `copy + drop + store` — pure data.
public struct ItemStatistics has copy, drop, store {
  vitality: u16,
  wisdom: u16,
  strength: u16,
  intelligence: u16,
  chance: u16,
  agility: u16,
  range: u16,
  movement: u16,
  action: u16,
  critical: u16,
  raw_damage: u16,
  critical_chance: u16,
  critical_outcomes: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
}

// ╔════════════════ [ Constructor (public — a PTB builds the block to pass to create_template) ] ═ ]

public fun new(
  vitality: u16,
  wisdom: u16,
  strength: u16,
  intelligence: u16,
  chance: u16,
  agility: u16,
  range: u16,
  movement: u16,
  action: u16,
  critical: u16,
  raw_damage: u16,
  critical_chance: u16,
  critical_outcomes: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
): ItemStatistics {
  ItemStatistics {
    vitality,
    wisdom,
    strength,
    intelligence,
    chance,
    agility,
    range,
    movement,
    action,
    critical,
    raw_damage,
    critical_chance,
    critical_outcomes,
    earth_resistance,
    fire_resistance,
    water_resistance,
    air_resistance,
  }
}

/// The centering zero-point (reference for off-chain encoders / on-chain combat de-centering).
public fun shift(): u16 { SHIFT_U16 }

// ╔════════════════ [ Raw 17-vector view (catalog id order = field order) ] ══ ]
// 2026-07-12 forge split: these five are PURE TRANSFORMS over plain data (zero authority, no mutation) —
// widened to `public` so the extracted rune-forge sibling package computes with them. The WRITE door below
// (`set_rolled`) stays package-private with a brand-gated twin.

/// Centered block → 17 raw magnitudes in `rune_catalog` id order (below-centre fields → 0).
public fun to_raw(s: &ItemStatistics): vector<u64> {
  let c = centered(s);
  let mut out = vector<u64>[];
  let mut i = 0;
  while (i < c.length()) {
    let v = *c.borrow(i);
    out.push_back(if (v > SHIFT_U16) ((v - SHIFT_U16) as u64) else 0);
    i = i + 1;
  };
  out
}

/// Raw vector → centered block, PRESERVING untouched malus fields (a raw 0 whose original was below centre
/// keeps the original — the forge reducer never picks 0-valued fields, so a malus survives every outcome).
public fun from_raw(orig: &ItemStatistics, raw: &vector<u64>): ItemStatistics {
  let ov = centered(orig);
  let mut c = vector<u16>[];
  let mut i = 0;
  while (i < raw.length()) {
    let v = *raw.borrow(i);
    let o = *ov.borrow(i);
    c.push_back(if (v == 0 && o < SHIFT_U16) o else SHIFT_U16 + (v as u16));
    i = i + 1;
  };
  ItemStatistics {
    vitality: *c.borrow(0), wisdom: *c.borrow(1), strength: *c.borrow(2), intelligence: *c.borrow(3),
    chance: *c.borrow(4), agility: *c.borrow(5), range: *c.borrow(6), movement: *c.borrow(7),
    action: *c.borrow(8), critical: *c.borrow(9), raw_damage: *c.borrow(10), critical_chance: *c.borrow(11),
    critical_outcomes: *c.borrow(12), earth_resistance: *c.borrow(13), fire_resistance: *c.borrow(14),
    water_resistance: *c.borrow(15), air_resistance: *c.borrow(16),
  }
}

/// Is `stat` (catalog id) below centre — a malus line?
public fun is_malus(s: &ItemStatistics, stat: u8): bool { *centered(s).borrow(stat as u64) < SHIFT_U16 }

/// Template [min,max] ranges → 17 raw MAX magnitudes (no ranges ⇒ all-zero ⇒ every scribe is EXOTIC-rated).
public fun template_max_raw(template: &ItemTemplate): vector<u64> {
  if (!has_ranges(template)) return zero_raw();
  to_raw(stats_max(template))
}

/// The all-zero raw vector (statless items crush to zero yield; rangeless templates rate EXOTIC).
public fun zero_raw(): vector<u64> {
  let mut v = vector<u64>[];
  let mut i = 0u64;
  while (i < 17) { v.push_back(0); i = i + 1; };
  v
}

/// The centered 17-vector in catalog id order (single home of the field enumeration).
fun centered(s: &ItemStatistics): vector<u16> {
  vector[
    s.vitality, s.wisdom, s.strength, s.intelligence, s.chance, s.agility, s.range, s.movement, s.action,
    s.critical, s.raw_damage, s.critical_chance, s.critical_outcomes, s.earth_resistance, s.fire_resistance,
    s.water_resistance, s.air_resistance,
  ]
}

// ╔════════════════ [ Ranges: attach / read on the TEMPLATE ] ════════════════ ]

/// Attach the [min,max] stat ranges to `template` (package-private — the authoring surface calls it before the
/// template is shared). Each field of a minted item is rolled uniformly in [min_field, max_field] at purchase
/// (`shop::buy`). Aborts if ranges are already attached (set-once at creation). Pass min==max for a fixed stat.
public(package) fun attach_ranges(template: &mut ItemTemplate, min: ItemStatistics, max: ItemStatistics) {
  df::add(item::template_uid_mut(template), StatsMinKey {}, min);
  df::add(item::template_uid_mut(template), StatsMaxKey {}, max);
}

/// Replace (or attach) the authored [min,max] ranges on a live template. Package-private: the only production
/// caller is the AdminCap + Version-gated `admin::set_template_stats` door. Existing minted items are deliberately
/// untouched: they carry their own fixed `StatsKey` roll, while future mints roll from these updated ranges.
public(package) fun set_ranges(template: &mut ItemTemplate, min: ItemStatistics, max: ItemStatistics) {
  if (has_ranges(template)) {
    *df::borrow_mut(item::template_uid_mut(template), StatsMinKey {}) = min;
    *df::borrow_mut(item::template_uid_mut(template), StatsMaxKey {}) = max;
  } else {
    attach_ranges(template, min, max);
  };
}

public fun has_ranges(template: &ItemTemplate): bool {
  df::exists(item::template_uid(template), StatsMinKey {})
}

public fun stats_min(template: &ItemTemplate): &ItemStatistics {
  df::borrow(item::template_uid(template), StatsMinKey {})
}

public fun stats_max(template: &ItemTemplate): &ItemStatistics {
  df::borrow(item::template_uid(template), StatsMaxKey {})
}

/// Detach + drop the [min,max] roll ranges from `template` if present. Package-private — the burn path
/// (`admin::burn_item_template`) calls it so deleting the template's UID orphans no dynamic field. No-op when
/// the template carries no ranges (resource/consumable). `ItemStatistics` has `drop`, so removal just discards.
public(package) fun drop_ranges(template: &mut ItemTemplate) {
  if (has_ranges(template)) {
    let _: ItemStatistics = df::remove(item::template_uid_mut(template), StatsMinKey {});
    let _: ItemStatistics = df::remove(item::template_uid_mut(template), StatsMaxKey {});
  }
}

// ╔════════════════ [ Roll (mint-roll randomness — the ONE stat-shape owner rolls all 17 fields) ] ═ ]

/// Roll one field in [lo, hi] INCLUSIVE off the generator (lo if the range is degenerate). Uses the framework's
/// unbiased range draw (`generate_u16_in_range`) — DELTA from the deployed reference's `generate_u64 % (span+1)`:
/// same inclusive semantics, but unbiased and cast-free (the docs-recommended API).
fun roll_field(gen: &mut RandomGenerator, lo: u16, hi: u16): u16 {
  if (hi <= lo) lo else gen.generate_u16_in_range(lo, hi)
}

/// Roll a full `ItemStatistics` with each field independently in [min_field, max_field]. Called ONCE at buy;
/// the result is FIXED on the item forever (combat off the rolled stats stays deterministic). This module owns the
/// 17-field shape, so the field enumeration lives HERE (the buy path just supplies the generator).
///
/// RELIC DREAM-ROLL (§10, gap G5): a relic "rolls each stat from 1 to max" (trash-to-god variance) — this is the
/// SAME uniform draw, it just falls out of the general [min,max] when the template authors `min` at the centered
/// floor (`SHIFT + 1`, i.e. a +1 raw bonus) and `max` at the centered ceiling. No separate roll variant is
/// needed; a relic is the special case of the general roll where the range is authored wide, so nothing here
/// changes — the difference is pure admin authoring data (min pinned low), plus the game package's unique-per-
/// type equip rule (§10, cross-package). Cosmetics carry NO ranges at all (zero stats).
public(package) fun roll(min: &ItemStatistics, max: &ItemStatistics, gen: &mut RandomGenerator): ItemStatistics {
  ItemStatistics {
    vitality: roll_field(gen, min.vitality, max.vitality),
    wisdom: roll_field(gen, min.wisdom, max.wisdom),
    strength: roll_field(gen, min.strength, max.strength),
    intelligence: roll_field(gen, min.intelligence, max.intelligence),
    chance: roll_field(gen, min.chance, max.chance),
    agility: roll_field(gen, min.agility, max.agility),
    range: roll_field(gen, min.range, max.range),
    movement: roll_field(gen, min.movement, max.movement),
    action: roll_field(gen, min.action, max.action),
    critical: roll_field(gen, min.critical, max.critical),
    raw_damage: roll_field(gen, min.raw_damage, max.raw_damage),
    critical_chance: roll_field(gen, min.critical_chance, max.critical_chance),
    critical_outcomes: roll_field(gen, min.critical_outcomes, max.critical_outcomes),
    earth_resistance: roll_field(gen, min.earth_resistance, max.earth_resistance),
    fire_resistance: roll_field(gen, min.fire_resistance, max.fire_resistance),
    water_resistance: roll_field(gen, min.water_resistance, max.water_resistance),
    air_resistance: roll_field(gen, min.air_resistance, max.air_resistance),
  }
}

// ╔════════════════ [ Rolled block: attach / read on the ITEM ] ══════════════ ]

/// Attach the rolled block to a freshly-minted `item` (package-private — only `shop::buy` calls it, once at
/// purchase). Pet templates carry their full-fed endpoint, so a new pet starts at the curve's neutral count-zero
/// block instead of inheriting the generic purchase roll. The item is new, so it cannot already carry StatsKey.
public(package) fun attach_rolled(item: &mut Item, stats: ItemStatistics) {
  let initial = if (item::category(item) == b"pet".to_string()) {
    scale_from_center(&stats, 0, PET_FULL_FEEDS)
  } else stats;
  df::add(item::uid_mut(item), StatsKey {}, initial);
}

public fun has_rolled_stats(item: &Item): bool {
  df::exists(item::uid(item), StatsKey {})
}

public fun rolled_stats(item: &Item): &ItemStatistics {
  df::borrow(item::uid(item), StatsKey {})
}

/// Overwrite (or attach) the rolled block on `item`. Package-private: the clamped `scribe` gate rewrites forged
/// gear, while pet power writes its deterministic template-max fraction. The AdminCap has no owned-item stat door.
public(package) fun set_rolled(item: &mut Item, stats: ItemStatistics) {
  if (has_rolled_stats(item)) *df::borrow_mut(item::uid_mut(item), StatsKey {}) = stats
  else df::add(item::uid_mut(item), StatsKey {}, stats);
}

// ╔════════════════ [ Centered proportional scale ] ══════════════════════════ ]

/// Scale every signed distance from neutral by `numerator / denominator`, flooring each magnitude. This is the
/// single on-chain curve used by pet power: 0 maps exactly to neutral and denominator maps exactly to the template
/// maximum, including authored malus lines below the center.
public fun scale_from_center(value: &ItemStatistics, numerator: u64, denominator: u64): ItemStatistics {
  assert!(denominator > 0 && numerator <= denominator, EInvalidScale);
  ItemStatistics {
    vitality: scale_field(value.vitality, numerator, denominator),
    wisdom: scale_field(value.wisdom, numerator, denominator),
    strength: scale_field(value.strength, numerator, denominator),
    intelligence: scale_field(value.intelligence, numerator, denominator),
    chance: scale_field(value.chance, numerator, denominator),
    agility: scale_field(value.agility, numerator, denominator),
    range: scale_field(value.range, numerator, denominator),
    movement: scale_field(value.movement, numerator, denominator),
    action: scale_field(value.action, numerator, denominator),
    critical: scale_field(value.critical, numerator, denominator),
    raw_damage: scale_field(value.raw_damage, numerator, denominator),
    critical_chance: scale_field(value.critical_chance, numerator, denominator),
    critical_outcomes: scale_field(value.critical_outcomes, numerator, denominator),
    earth_resistance: scale_field(value.earth_resistance, numerator, denominator),
    fire_resistance: scale_field(value.fire_resistance, numerator, denominator),
    water_resistance: scale_field(value.water_resistance, numerator, denominator),
    air_resistance: scale_field(value.air_resistance, numerator, denominator),
  }
}

/// The single source of the pet-power curve length, shared by feed validation, item derivation, and equip-time
/// normalization. Kept with the stat transform so `equipment` need not import `pet` and create a module cycle.
public fun pet_full_feed_count(): u64 { PET_FULL_FEEDS }

/// Derive a pet item's authoritative current block from its authenticated template maximum and stored feed count.
/// `scale_from_center` validates `feed_count <= PET_FULL_FEEDS`; a rangeless template aborts at `stats_max`.
public(package) fun pet_stats_at_count(template: &ItemTemplate, feed_count: u64): ItemStatistics {
  scale_from_center(stats_max(template), feed_count, PET_FULL_FEEDS)
}

fun scale_field(value: u16, numerator: u64, denominator: u64): u16 {
  let magnitude = if (value >= SHIFT_U16) value - SHIFT_U16 else SHIFT_U16 - value;
  let scaled = (((magnitude as u128) * (numerator as u128) / (denominator as u128)) as u16);
  if (value >= SHIFT_U16) SHIFT_U16 + scaled else SHIFT_U16 - scaled
}

// ╔════════════════ [ Clamp helpers (the 17-field enumeration stays single-homed here) ] ═ ]

/// Per-field MIN of `value` against `max` — the scribe clamp reuses this so the field enumeration lives ONLY
/// here. Returns a block where each field is `min(value_field, max_field)`.
public fun clamp_to(value: &ItemStatistics, max: &ItemStatistics): ItemStatistics {
  ItemStatistics {
    vitality: min_u16(value.vitality, max.vitality),
    wisdom: min_u16(value.wisdom, max.wisdom),
    strength: min_u16(value.strength, max.strength),
    intelligence: min_u16(value.intelligence, max.intelligence),
    chance: min_u16(value.chance, max.chance),
    agility: min_u16(value.agility, max.agility),
    range: min_u16(value.range, max.range),
    movement: min_u16(value.movement, max.movement),
    action: min_u16(value.action, max.action),
    critical: min_u16(value.critical, max.critical),
    raw_damage: min_u16(value.raw_damage, max.raw_damage),
    critical_chance: min_u16(value.critical_chance, max.critical_chance),
    critical_outcomes: min_u16(value.critical_outcomes, max.critical_outcomes),
    earth_resistance: min_u16(value.earth_resistance, max.earth_resistance),
    fire_resistance: min_u16(value.fire_resistance, max.fire_resistance),
    water_resistance: min_u16(value.water_resistance, max.water_resistance),
    air_resistance: min_u16(value.air_resistance, max.air_resistance),
  }
}

/// A block with every field set to `v` — the scribe builds its hardcoded conservative ceiling from this.
public fun uniform(v: u16): ItemStatistics {
  ItemStatistics {
    vitality: v, wisdom: v, strength: v, intelligence: v, chance: v, agility: v, range: v, movement: v,
    action: v, critical: v, raw_damage: v, critical_chance: v, critical_outcomes: v, earth_resistance: v,
    fire_resistance: v, water_resistance: v, air_resistance: v,
  }
}

fun min_u16(a: u16, b: u16): u16 { if (a < b) a else b }

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun vitality(self: &ItemStatistics): u16 { self.vitality }
public fun wisdom(self: &ItemStatistics): u16 { self.wisdom }
public fun strength(self: &ItemStatistics): u16 { self.strength }
public fun intelligence(self: &ItemStatistics): u16 { self.intelligence }
public fun chance(self: &ItemStatistics): u16 { self.chance }
public fun agility(self: &ItemStatistics): u16 { self.agility }
public fun range(self: &ItemStatistics): u16 { self.range }
public fun movement(self: &ItemStatistics): u16 { self.movement }
public fun action(self: &ItemStatistics): u16 { self.action }
public fun critical(self: &ItemStatistics): u16 { self.critical }
public fun raw_damage(self: &ItemStatistics): u16 { self.raw_damage }
public fun critical_chance(self: &ItemStatistics): u16 { self.critical_chance }
public fun critical_outcomes(self: &ItemStatistics): u16 { self.critical_outcomes }
public fun earth_resistance(self: &ItemStatistics): u16 { self.earth_resistance }
public fun fire_resistance(self: &ItemStatistics): u16 { self.fire_resistance }
public fun water_resistance(self: &ItemStatistics): u16 { self.water_resistance }
public fun air_resistance(self: &ItemStatistics): u16 { self.air_resistance }
