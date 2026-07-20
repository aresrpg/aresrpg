/// SPELL TEMPLATES — the LIVE-tunable spell-data layer (pkg #4). Each spell is its OWN SHARED object, exactly ONE
/// per (class, unlock_level, name), made unique by DERIVED OBJECT under the registry gate's UID (§17.16 amended:
/// N spells per unlock level, unique by (class, unlock, name) — a class fields MULTIPLE spells at one unlock level
/// (e.g. its three level-1 starters, each a distinct spell `name`/slug). `name` is the spell's STABLE slug identity
/// (e.g. "senshi_ember_strike"), NOT its arbitrary insertion order — so the derived address is order-independent:
/// re-authoring the corpus in any order yields the SAME per-spell addresses. A duplicate (class, unlock_level,
/// name) is unconstructible — `derived_object::claim` aborts on the taken address, TOCTOU-proof, never trusting a
/// lagged off-chain count).
/// This REPLACES the old frozen-forever `spell_registry` (an explicit SPEC contradiction — SPEC §7 mandates
/// live-tunable spells).
///
/// THE STRUCTURAL GATE: admission (`mint_spell`) AND every cap-gated live-tune setter reject effects outside the
/// executable foundation vocabulary (unknown kind/shape/phase/filter/flag/stat/element). Numeric spell data is
/// authored data and is not banded here: AP, range, cast limits, cooldown, crit rate, durations, areas, and effect
/// magnitudes survive admission and tuning unchanged. Resolution reads the shared template at cast time, so a
/// setter's edit applies from the NEXT cast — a live patch, even mid-fight, at zero cost to fights at scale (SPEC §7).
/// The legacy `(damage_base, damage_per_level)` parameters remain in every published signature for upgrade
/// compatibility but no longer constrain authored values.
module aresrpg_spells::spell_template;

use aresrpg_foundation::spell_effect::{SpellLevel, Effect};
use aresrpg_spells::{admin::AdminCap, version::Version};
use std::string::String;
use sui::{derived_object, event};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const MAX_LEVEL: u64 = 6; // exact 1.29: every spell has 6 levels (index 0 = level 1)

const EWrongLevelCount: u64 = 101; // mint_spell: must supply exactly 6 levels
const EIllegalLevel: u64 = 102; // a level contains an effect outside the executable structural vocabulary
const ELevelOutOfRange: u64 = 105; // level_of / setter: level not in 1..=6

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The registry GATE: a single shared object whose UID is the derivation parent for every (class, unlock_level)
/// template. It carries no data — canonicity comes from the derived-object keys claimed under its `id`.
public struct SpellRegistry has key {
  id: UID,
}

/// The derived-object claim key: (class, unlock_level, name). Claiming it under the registry reserves the spell's
/// on-chain address; a second claim of the same triple aborts (§17.16 amended: unique by (class, unlock, name), so
/// a class can field several spells at one unlock level — the spell `name`/slug discriminates them). Deterministic:
/// the same (class, unlock, name) always derives the same address, independent of authoring order.
public struct SpellKey(String, u16, String) has copy, drop, store;

/// A spell template — a SHARED object living at the (class, unlock_level, name)-derived address. `name` is the
/// spell's stable slug identity (the key vector). `levels` is exactly 6 `SpellLevel`s (reused from foundation),
/// each structurally validated at admission and after every tune.
public struct SpellTemplate has key {
  id: UID,
  class: String,
  unlock_level: u16,
  name: String,
  levels: vector<SpellLevel>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct SpellMinted has copy, drop { spell: ID, class: String, unlock_level: u16, name: String }

public struct SpellTuned has copy, drop { spell: ID, level: u8 }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(SpellRegistry { id: object::new(ctx) });
}

// ╔════════════════ [ ADMISSION (cap + version gated) ] ══════════════════════ ]

/// Mint + SHARE a spell template at the (class, unlock_level, name)-derived address, returning its id. `name` is the
/// spell's stable slug identity (e.g. "senshi_ember_strike"). Cap-gated (`verify`) + version-gated (`assert_latest`
/// — authoring runs while dark AND live). Every level's base and crit effects must belong to the executable
/// structural vocabulary. A duplicate (class, unlock_level, name) aborts in `derived_object::claim`
/// (§17.16 amended: same (class, unlock) but a distinct spell `name` is legal — that is how a class fields its three
/// level-1 starters). `(damage_base, damage_per_level)` are retained ABI parameters and do not alter validation.
public fun mint_spell(
  cap: &AdminCap,
  registry: &mut SpellRegistry,
  class: String,
  unlock_level: u16,
  name: String,
  levels: vector<SpellLevel>,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  cap.verify(ctx);
  version.assert_latest();
  validate_levels(&levels, unlock_level, damage_base, damage_per_level);

  let id = derived_object::claim(&mut registry.id, SpellKey(class, unlock_level, name));
  let template = SpellTemplate { id, class, unlock_level, name, levels };
  let sid = object::id(&template);
  event::emit(SpellMinted { spell: sid, class, unlock_level, name });
  transfer::share_object(template);
  sid
}

/// Assert the 6-level array is structurally admissible: exactly 6 levels and every base/crit effect belongs to the
/// executable effect vocabulary. Called BEFORE the claim so a validation failure never wastes the derived address.
/// The numeric parameters stay in this private signature to keep all existing call bodies upgrade-compatible.
fun validate_levels(levels: &vector<SpellLevel>, unlock_level: u16, damage_base: u64, damage_per_level: u64) {
  let _ = unlock_level;
  let _ = damage_base;
  let _ = damage_per_level;
  assert!(levels.length() == MAX_LEVEL, EWrongLevelCount);
  let mut i = 0;
  while (i < MAX_LEVEL) {
    assert!(level_is_structurally_legal(levels.borrow(i)), EIllegalLevel);
    i = i + 1;
  };
}

/// Structural validation deliberately contains no value bands: `Effect::is_legal` checks discriminants and
/// reference domains only. Both lists are checked because crit rows replace base rows at resolution time.
fun level_is_structurally_legal(level: &SpellLevel): bool {
  effect_list_is_structurally_legal(level.sl_effects())
    && effect_list_is_structurally_legal(level.sl_crit_effects())
}

fun effect_list_is_structurally_legal(effects: &vector<Effect>): bool {
  let mut i = 0;
  while (i < effects.length()) {
    if (!effects.borrow(i).is_legal()) return false;
    i = i + 1;
  };
  true
}

// ╔════════════════ [ LIVE-TUNE setters (cap + version gated — SPEC §7 balancing lever) ] ═ ]
// Each mutates ONE aspect of ONE level in place, then RE-RUNS the structural gate on that level (`revalidate`).
// The AdminCap is the ONLY way to obtain the `&mut SpellLevel` these touch (a template's `levels` are private to
// this module). `level` is 1..=6.

/// Retune a level's AP cost.
public fun set_level_ap_cost(
  cap: &AdminCap,
  template: &mut SpellTemplate,
  level: u8,
  ap_cost: u64,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  borrow_level_mut(template, level).set_ap_cost(ap_cost);
  revalidate(template, level, damage_base, damage_per_level);
}

/// Retune a level's range window (min/max/modifiable).
public fun set_level_range(
  cap: &AdminCap,
  template: &mut SpellTemplate,
  level: u8,
  range_min: u64,
  range_max: u64,
  modifiable_range: bool,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  borrow_level_mut(template, level).set_range(range_min, range_max, modifiable_range);
  revalidate(template, level, damage_base, damage_per_level);
}

/// Retune a level's cast limits (casts per turn / per target), cooldown, and crit rate.
public fun set_level_limits(
  cap: &AdminCap,
  template: &mut SpellTemplate,
  level: u8,
  casts_per_turn: u8,
  casts_per_target: u8,
  cooldown_turns: u8,
  crit_rate: u64,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  borrow_level_mut(template, level).set_limits(casts_per_turn, casts_per_target, cooldown_turns, crit_rate);
  revalidate(template, level, damage_base, damage_per_level);
}

/// Retune a level's character-level gate and line-of-sight requirement (2026-07-15 train: the kit-fidelity
/// resync moved per-level unlock gates on 14 spells and LOS on two — additive facet, same guard shape).
public fun set_level_targeting(
  cap: &AdminCap,
  template: &mut SpellTemplate,
  level: u8,
  min_char_level: u16,
  line_of_sight: bool,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  borrow_level_mut(template, level).set_targeting(min_char_level, line_of_sight);
  revalidate(template, level, damage_base, damage_per_level);
}

/// Replace a level's base + crit effect lists (the "invisibility grants 2 MP at level 5" live patch — SPEC §7).
public fun set_level_effects(
  cap: &AdminCap,
  template: &mut SpellTemplate,
  level: u8,
  effects: vector<Effect>,
  crit_effects: vector<Effect>,
  damage_base: u64,
  damage_per_level: u64,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  borrow_level_mut(template, level).set_effects(effects, crit_effects);
  revalidate(template, level, damage_base, damage_per_level);
}

/// Borrow a level (1..=6) for mutation. Aborts on an out-of-range level.
fun borrow_level_mut(template: &mut SpellTemplate, level: u8): &mut SpellLevel {
  assert!(level >= 1 && (level as u64) <= MAX_LEVEL, ELevelOutOfRange);
  template.levels.borrow_mut((level as u64) - 1)
}

/// Re-run the effect-vocabulary gate on a just-mutated level. Numeric compatibility parameters are intentionally
/// ignored but retained in the existing signature. Emits `SpellTuned` after successful structural validation.
fun revalidate(template: &SpellTemplate, level: u8, damage_base: u64, damage_per_level: u64) {
  let _ = damage_base;
  let _ = damage_per_level;
  assert!(level_is_structurally_legal(template.levels.borrow((level as u64) - 1)), EIllegalLevel);
  event::emit(SpellTuned { spell: object::id(template), level });
}

// ╔════════════════ [ FREE reads (no cap — spell data is public: resolution + RPC + SDK) ] ═ ]

public fun class(t: &SpellTemplate): String { t.class }

public fun unlock_level(t: &SpellTemplate): u16 { t.unlock_level }

public fun name(t: &SpellTemplate): String { t.name }

public fun levels(t: &SpellTemplate): &vector<SpellLevel> { &t.levels }

/// The `SpellLevel` config for a given level (1..=6). Aborts on an out-of-range level. Resolution composes this
/// with a character's current spell level (the allocation lives on the Character, per foundation's `spell_book`).
public fun level_of(t: &SpellTemplate, level: u8): &SpellLevel {
  assert!(level >= 1 && (level as u64) <= MAX_LEVEL, ELevelOutOfRange);
  t.levels.borrow((level as u64) - 1)
}

public fun spell_id(t: &SpellTemplate): ID { object::id(t) }

/// The on-chain ADDRESS a (class, unlock_level, name) spell lives at under `registry` — the SDK derives it without
/// an index lookup, and resolution/RPC fetch the shared object by it. Deterministic from the registry id + the key.
public fun spell_id_for(registry: &SpellRegistry, class: String, unlock_level: u16, name: String): address {
  derived_object::derive_address(object::id(registry), SpellKey(class, unlock_level, name))
}

/// Has a (class, unlock_level, name) spell already been minted under `registry`?
public fun spell_exists(registry: &SpellRegistry, class: String, unlock_level: u16, name: String): bool {
  derived_object::exists(&registry.id, SpellKey(class, unlock_level, name))
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
