// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The spell ALGEBRA — pure data, the exact 1.29 model: a spell level is a LIST of effects,
/// each `{ kind, element, value, area, target filter, chance, duration }`, the kind a u8
/// discriminant over the ~40 mechanics. Element and stat are PARAMETERS, never separate
/// opcodes. Validated at construction — the corpus freezes forever, nothing invalid may pass.
/// The fight resolver dispatches over these kinds; this module never computes anything.
module aresrpg_math::spell_effect;

use aresrpg_math::item_damages;
use std::string::String;

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EBadKind: u64 = 1401;
const EBadShape: u64 = 1402;
const EBadFilter: u64 = 1403;
const EBadElement: u64 = 1404;
const EBadValues: u64 = 1405; // value > value_max
const EBadChance: u64 = 1406; // chance above 100%
const EBadLevel: u64 = 1407; // new_spell_level: range out of order, or crit quotation of 1
const EBadStat: u64 = 1408; // stat id addresses the wrong channel for the effect kind

/// The effect kinds — the sealed list (owner 2026-08-09; collapsed 2026-08-12 "optimize for
/// deletion": every number-changing kind is one of THREE channelled kinds — add / remove /
/// steal — with `stat` picking the CHANNEL and `turns` deciding instant vs lasting. heal, dot,
/// life steal, the point kinds, and every alter/weaken/steal-stat variant folded in. The four
/// damage FORMULA kinds stay separate: different formulas, not different directions.)
/// Cut with reasons: states (replaced by the reaction kind), reveal (invisibility is a
/// targeting RULE, not information hiding — chain data is public), summons, timed/stack/stance
/// machinery, pool shields (2.0), erosion, critical_failure, reset_positions, geometric_push,
/// damage_to_heal, forced_death, carry/throw (redesigned as pull/push).
const KIND_COUNT: u8 = 20;
// 0 damage · 1 percent_life_damage · 2 caster_damage · 3 punishment_damage ·
// 4 add · 5 remove · 6 steal (remove on the target + the same as add on the caster) ·
// 7 reaction (a stance row: while it lives, each real hp hit the holder TAKES pushes an add
//   row of this channel/value whose life mirrors the stance's remaining turns — the Sacrier) ·
// 8 push · 9 pull · 10 teleport · 11 swap_positions · 12 place_trap · 13 place_glyph ·
// 14 reduce_damage · 15 reflect_damage · 16 dispel (removes ALL effect rows, whatever they
// are) · 17 invisibility · 18 return_spell (bounces only casts of level ≤ its own cast level;
// a level-6 cast is never returnable) · 19 damage_redirect

/// The channels the three number kinds (and reaction) address through `stat`:
/// 0 strength · 1 intelligence · 2 chance · 3 agility · 4 wisdom · 5 range · 6 AP · 7 MP ·
/// 8 power (a flat addition to ALL four primaries — the house form of the legacy "%damage") ·
/// 9 raw_damage · 10 critical (the Cri) · 11 resistance (the element field picks which;
/// empty = all four) · 12 hp (add = heal, lasting remove = the dot, steal = life steal —
/// INSTANT hp removal stays the damage kinds, so remove(hp) requires turns ≥ 1)
const CHANNEL_COUNT: u8 = 13;

/// Area shapes: 0 point · 1 circle · 2 cross · 3 line · 4 tbar · 5 ring · 6 allmap ·
/// 7 cone · 8 podium · 9 blob
const SHAPE_COUNT: u8 = 10;

/// Target filters: 0 none · 1 not_team · 2 not_self · 3 not_enemy · 4 only_caster
const FILTER_COUNT: u8 = 5;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One effect line of a spell level.
public struct Effect has copy, drop, store {
  kind: u8,
  element: String, // one of the 4 for elemental kinds; empty for the rest
  value: u32,
  value_max: u32, // == value when fixed
  area_shape: u8,
  area_size: u8,
  target_filter: u8,
  chance_bp: u16, // 10000 = always
  turns: u8, // duration for timed kinds; 0 = instant
  stat: u8, // the stat id for alter/steal kinds; 0 otherwise
}

/// One castable level of a spell (a spell has 1..6 of these).
public struct SpellLevel has copy, drop, store {
  ap_cost: u8,
  range_min: u8,
  range_max: u8,
  modifiable_range: bool,
  line_of_sight: bool,
  line_launch: bool,
  free_cell: bool, // may target an empty cell (traps, teleports)
  casts_per_turn: u8, // 0 = unlimited (weapon strikes repeat while AP lasts)
  casts_per_target: u8, // 0 = unlimited
  cooldown_turns: u8,
  crit_1_in: u16, // the QUOTATION (owner law: never percent): crit lands 1 time in X; 0 = never
  effects: vector<Effect>,
  crit_effects: vector<Effect>,
}

// ╔════════════════ [ Seeding constructors — validation before the freeze ] ══ ]

public fun new_effect(
  kind: u8,
  element: String,
  value: u32,
  value_max: u32,
  area_shape: u8,
  area_size: u8,
  target_filter: u8,
  chance_bp: u16,
  turns: u8,
  stat: u8,
): Effect {
  assert!(kind < KIND_COUNT, EBadKind);
  assert!(area_shape < SHAPE_COUNT, EBadShape);
  assert!(target_filter < FILTER_COUNT, EBadFilter);
  assert!(element.is_empty() || item_damages::is_element(&element), EBadElement);
  assert!(value <= value_max, EBadValues);
  assert!(chance_bp <= 10_000, EBadChance);
  // The CHANNEL rules (collapse 2026-08-12) — authoring the wrong channel would silently
  // no-op, so everything aborts here, before the freeze seals it:
  //   add/remove/steal (4/5/6) take any channel 0..12;
  //   remove(hp) needs turns ≥ 1 (instant hp removal is the damage kinds' job);
  //   remove/steal on hp carry the element (the resist/amplify math needs one); add(hp) — a
  //   heal — carries none (heals amplify off intelligence, 1.29);
  //   reaction (7) grants STATS on being hit: channels 0..5 or 8..10, lasting (turns ≥ 1),
  //   element empty (the Toll's element lives in its damage rider, not the stance).
  if (kind == 4 || kind == 5 || kind == 6) {
    assert!(stat < CHANNEL_COUNT, EBadStat);
    if (stat == 12) {
      if (kind == 5) assert!(turns >= 1, EBadStat);
      if (kind == 5 || kind == 6) assert!(!element.is_empty(), EBadElement)
      else assert!(element.is_empty(), EBadElement);
    };
  };
  if (kind == 7) {
    assert!(stat <= 5 || (stat >= 8 && stat <= 10), EBadStat);
    assert!(turns >= 1, EBadStat);
    assert!(element.is_empty(), EBadElement);
  };
  Effect { kind, element, value, value_max, area_shape, area_size, target_filter, chance_bp, turns, stat }
}

public fun new_spell_level(
  ap_cost: u8,
  range_min: u8,
  range_max: u8,
  modifiable_range: bool,
  line_of_sight: bool,
  line_launch: bool,
  free_cell: bool,
  casts_per_turn: u8,
  casts_per_target: u8,
  cooldown_turns: u8,
  crit_1_in: u16,
  effects: vector<Effect>,
  crit_effects: vector<Effect>,
): SpellLevel {
  assert!(range_min <= range_max, EBadLevel);
  assert!(crit_1_in != 1, EBadLevel); // 1-in-1 is not a crit; 0 = never, else 1 in X ≥ 2
  SpellLevel {
    ap_cost,
    range_min,
    range_max,
    modifiable_range,
    line_of_sight,
    line_launch,
    free_cell,
    casts_per_turn,
    casts_per_target,
    cooldown_turns,
    crit_1_in,
    effects,
    crit_effects,
  }
}

// ╔════════════════ [ The shape discriminants (one home — geometry imports these) ] ]

public fun shape_point(): u8 { 0 }

public fun shape_circle(): u8 { 1 }

public fun shape_cross(): u8 { 2 }

public fun shape_line(): u8 { 3 }

public fun shape_tbar(): u8 { 4 }

public fun shape_ring(): u8 { 5 }

public fun shape_allmap(): u8 { 6 }

public fun shape_cone(): u8 { 7 }

public fun shape_podium(): u8 { 8 }

public fun shape_blob(): u8 { 9 }

// ╔════════════════ [ Reads (the resolver's surface) ] ═══════════════════════ ]

public fun kind(e: &Effect): u8 { e.kind }

/// Does any base row heal — add(hp)? (The mob brain aims heal spells at allies.)
public fun has_heal(l: &SpellLevel): bool {
  let mut i = 0;
  while (i < l.effects.length()) {
    if (l.effects[i].kind == 4 && l.effects[i].stat == 12) return true;
    i = i + 1;
  };
  false
}

public fun element(e: &Effect): String { e.element }

public fun value(e: &Effect): u32 { e.value }

public fun value_max(e: &Effect): u32 { e.value_max }

public fun area_shape(e: &Effect): u8 { e.area_shape }

public fun area_size(e: &Effect): u8 { e.area_size }

public fun target_filter(e: &Effect): u8 { e.target_filter }

public fun chance_bp(e: &Effect): u16 { e.chance_bp }

public fun turns(e: &Effect): u8 { e.turns }

public fun stat(e: &Effect): u8 { e.stat }

public fun ap_cost(l: &SpellLevel): u8 { l.ap_cost }

public fun range_min(l: &SpellLevel): u8 { l.range_min }

public fun range_max(l: &SpellLevel): u8 { l.range_max }

public fun modifiable_range(l: &SpellLevel): bool { l.modifiable_range }

public fun line_of_sight(l: &SpellLevel): bool { l.line_of_sight }

public fun line_launch(l: &SpellLevel): bool { l.line_launch }

public fun free_cell(l: &SpellLevel): bool { l.free_cell }

public fun casts_per_turn(l: &SpellLevel): u8 { l.casts_per_turn }

public fun casts_per_target(l: &SpellLevel): u8 { l.casts_per_target }

public fun cooldown_turns(l: &SpellLevel): u8 { l.cooldown_turns }

public fun crit_1_in(l: &SpellLevel): u16 { l.crit_1_in }

public fun effects(l: &SpellLevel): vector<Effect> { l.effects }

public fun crit_effects(l: &SpellLevel): vector<Effect> { l.crit_effects }
