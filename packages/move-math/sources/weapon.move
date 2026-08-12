// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The weapon PHYSICS LAW — a weapon IS a spell (ruling 2026-08-09): a strike is a
/// `SpellLevel` assembled at swing time from TWO sources with one home each:
///   PHYSICS (this table): AP, reach, range floor/extension, line rule, strike zone, and the
///   crit QUOTATION (1 in X — the owner law: never percent).
///   CONTENT (the item's authored damage lines): element and [from, to] per line — a weapon
///   carries SEVERAL lines; each becomes one damage Effect resolving against its own
///   resistance, exactly like a multi-element spell.
/// Crit swaps to the same lines ×1.5 — that IS the crit damage (owner 2026-08-11: no flat crit
/// stat). The quotation X is static per family here; the Cri stat (`critical`) lowers it. Own-class
/// affinity = +10% on the line values. Bare hands (no weapon, a tool, or a lineless item)
/// fight the fixed unarmed line.
module aresrpg_math::weapon;

use aresrpg_math::{item_damages::ItemDamages, spell_effect::{Self, Effect, SpellLevel}};
use std::string::String;

/// Assemble the strike-spell: family physics + the item's authored lines.
public fun strike_of(category: &String, lines: &vector<ItemDamages>, affinity: bool): SpellLevel {
  let (crit_1_in, ap, reach, rmin, rext, line_only, zshape, zsize) = physics_of(category);
  if (lines.is_empty()) return unarmed();

  let mut effects = vector[];
  let mut crit_effects = vector[];
  let mut i = 0;
  while (i < lines.length()) {
    let l = &lines[i];
    let (from, to) = (scale(l.from() as u64, affinity), scale(l.to() as u64, affinity));
    effects.push_back(hit(l.element(), from, to, zshape, zsize));
    crit_effects.push_back(hit(l.element(), from * 150 / 100, to * 150 / 100, zshape, zsize));
    i = i + 1;
  };
  spell_effect::new_spell_level(
    ap,
    rmin,
    reach,
    rext, // modifiable_range: the bow's range-stat extension
    true, // line_of_sight: every weapon sees its target
    line_only, // the spellbook aims down a straight line
    false, // a strike aims at fighters
    0, // casts_per_turn: unlimited — while AP lasts
    0,
    0,
    crit_1_in,
    effects,
    crit_effects,
  )
}

/// Family → (crit_1_in, ap, reach, range_min, range_extends, line_only, zone_shape, zone_size).
/// Owner-corrected 2026-08-10; unknown categories get the unarmed physics.
fun physics_of(category: &String): (u16, u8, u8, u8, bool, bool, u8, u8) {
  if (*category == b"longsword".to_string()) (100, 6, 1, 1, false, false, 3, 1)
  else if (*category == b"daggers".to_string()) (30, 3, 1, 1, false, false, 0, 0)
  else if (*category == b"battleaxe".to_string()) (100, 6, 1, 1, false, false, 8, 1)
  else if (*category == b"spear".to_string()) (70, 4, 1, 1, false, false, 4, 1)
  else if (*category == b"staff".to_string()) (70, 4, 1, 1, false, false, 4, 1)
  else if (*category == b"spellbook".to_string()) (80, 3, 5, 1, false, true, 0, 0)
  else if (*category == b"bow".to_string()) (60, 4, 6, 2, true, false, 0, 0)
  else if (*category == b"axe".to_string()) (55, 5, 1, 1, false, false, 0, 0)
  else if (*category == b"mace".to_string()) (70, 4, 1, 1, false, false, 8, 1)
  else if (*category == b"club".to_string()) (60, 4, 1, 1, false, false, 3, 1)
  else if (*category == b"sword".to_string()) (50, 5, 1, 1, false, false, 0, 0)
  else (100, 4, 1, 1, false, false, 0, 0) // bare hands
}

/// The own-class affinity table (legacy law: any class wields any weapon; wielding your
/// DESIGNED family grants the +10%). Two staff classes — tokei and iyashi.
public fun affinity_of(classe: &String, category: &String): bool {
  let c = *classe;
  let f = *category;
  (c == b"senshi".to_string() && f == b"longsword".to_string()) ||
  (c == b"yajin".to_string() && f == b"daggers".to_string()) ||
  (c == b"ikari".to_string() && f == b"battleaxe".to_string()) ||
  (c == b"mori".to_string() && f == b"spear".to_string()) ||
  (c == b"tokei".to_string() && f == b"staff".to_string()) ||
  (c == b"shugo".to_string() && f == b"spellbook".to_string()) ||
  (c == b"yogan".to_string() && f == b"bow".to_string()) ||
  (c == b"rojin".to_string() && f == b"axe".to_string()) ||
  (c == b"shusen".to_string() && f == b"mace".to_string()) ||
  (c == b"tomoda".to_string() && f == b"club".to_string()) ||
  (c == b"asobi".to_string() && f == b"sword".to_string()) ||
  (c == b"iyashi".to_string() && f == b"staff".to_string())
}

/// Bare hands: one fixed earth line over the fallback physics row (its one home), never
/// affinity-scaled.
public fun unarmed(): SpellLevel {
  let (crit_1_in, ap, reach, rmin, rext, line_only, zshape, zsize) = physics_of(&b"".to_string());
  spell_effect::new_spell_level(
    ap, rmin, reach, rext, true, line_only, false, 0, 0, 0, crit_1_in,
    vector[hit(b"earth".to_string(), 4, 4, zshape, zsize)],
    vector[hit(b"earth".to_string(), 6, 6, zshape, zsize)],
  )
}

fun hit(element: String, from: u64, to: u64, zone_shape: u8, zone_size: u8): Effect {
  spell_effect::new_effect(
    0, // kind: damage
    element,
    (from as u32),
    (to as u32),
    zone_shape,
    zone_size,
    0, // target_filter: none — a strike hits whoever stands in the zone
    10_000, // always
    0, // instant
    0,
  )
}

fun scale(value: u64, affinity: bool): u64 {
  if (affinity) value * 110 / 100 else value
}
