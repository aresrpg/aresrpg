// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module aresrpg_math::characteristic_costs;

use aresrpg_math::content_rules;
use std::string::String;

const EInvalidClass: u64 = 1;
const EInvalidStat: u64 = 2;

fun standard(value: u32): u16 {
  if (value < 100) 1 else if (value < 200) 2 else if (value < 300) 3 else if (value < 400) 4 else 5
}

fun short(value: u32): u16 {
  if (value < 20) 1 else if (value < 40) 2 else if (value < 60) 3 else if (value < 80) 4 else 5
}

fun expensive(value: u32): u16 {
  if (value < 50) 2 else if (value < 150) 3 else if (value < 250) 4 else 5
}

fun fifty(value: u32): u16 {
  if (value < 50) 1 else if (value < 150) 2 else if (value < 250) 3 else if (value < 350) 4 else 5
}

fun agility_fifty(value: u32): u16 {
  if (value < 50) 1 else if (value < 100) 2 else if (value < 150) 3 else if (value < 200) 4 else 5
}

fun three_cap(value: u32): u16 { if (value < 50) 1 else if (value < 200) 2 else 3 }

fun berserker(value: u32): u16 { if (value < 100) 3 else if (value < 150) 4 else 5 }

fun strength_cost(classe: &String, value: u32): u16 {
  if (*classe == b"ikari".to_string()) berserker(value)
  else if (*classe == b"shusen".to_string()) three_cap(value)
  else if (
    *classe == b"shugo".to_string() ||
    *classe == b"tomoda".to_string() ||
    *classe == b"tokei".to_string() ||
    *classe == b"iyashi".to_string()
  ) expensive(value)
  else if (
    *classe == b"yajin".to_string() ||
    *classe == b"asobi".to_string() ||
    *classe == b"senshi".to_string()
  ) standard(value)
  else if (*classe == b"yogan".to_string() || *classe == b"rojin".to_string()) fifty(value)
  else {
    // Mori's long 2:1 band is one of the official client's irregular ladders.
    if (value < 50) 1 else if (value < 250) 2 else if (value < 300) 3 else if (value < 400) 4 else 5
  }
}

fun intelligence_cost(classe: &String, value: u32): u16 {
  if (*classe == b"ikari".to_string()) berserker(value)
  else if (*classe == b"shusen".to_string()) three_cap(value)
  else if (
    *classe == b"shugo".to_string() ||
    *classe == b"tomoda".to_string() ||
    *classe == b"tokei".to_string() ||
    *classe == b"iyashi".to_string() ||
    *classe == b"mori".to_string()
  ) standard(value)
  else if (*classe == b"yajin".to_string()) expensive(value)
  else if (*classe == b"asobi".to_string() || *classe == b"senshi".to_string()) short(value)
  else if (*classe == b"yogan".to_string()) fifty(value)
  else {
    if (value < 20) 1 else if (value < 60) 2 else if (value < 100) 3 else if (value < 150) 4 else 5
  }
}

fun chance_cost(classe: &String, value: u32): u16 {
  if (*classe == b"ikari".to_string()) berserker(value)
  else if (*classe == b"shusen".to_string()) three_cap(value)
  else if (*classe == b"tomoda".to_string() || *classe == b"mori".to_string()) standard(value)
  else if (*classe == b"rojin".to_string()) {
    if (value < 100) 1 else if (value < 150) 2 else if (value < 230) 3 else if (value < 330) 4 else 5
  }
  else short(value)
}

fun agility_cost(classe: &String, value: u32): u16 {
  if (*classe == b"ikari".to_string()) berserker(value)
  else if (*classe == b"shusen".to_string()) three_cap(value)
  else if (*classe == b"yajin".to_string()) standard(value)
  else if (*classe == b"asobi".to_string() || *classe == b"yogan".to_string()) agility_fifty(value)
  else short(value)
}

/// One official allocation click at the current natural value: (capital cost, stat gain).
public fun cost_at(classe: &String, stat: &String, value: u32): (u16, u16) {
  assert!(content_rules::is_classe(classe), EInvalidClass);
  if (*stat == b"vitality".to_string()) {
    if (*classe == b"ikari".to_string()) (1, 2) else (1, 1)
  }
  else if (*stat == b"wisdom".to_string()) (3, 1)
  else if (*stat == b"strength".to_string()) (strength_cost(classe, value), 1)
  else if (*stat == b"intelligence".to_string()) (intelligence_cost(classe, value), 1)
  else if (*stat == b"chance".to_string()) (chance_cost(classe, value), 1)
  else if (*stat == b"agility".to_string()) (agility_cost(classe, value), 1)
  else abort EInvalidStat
}

/// Spend as many whole natural points as exact capital permits. The caller rejects a remainder.
public fun gain_for_points(classe: &String, stat: &String, current: u16, points: u16): (u32, u32) {
  let mut spent = 0u32;
  let mut gain = 0u32;
  let mut left = points as u32;
  while (left > 0) {
    let (point_cost, point_gain) = cost_at(classe, stat, (current as u32) + gain);
    let point_cost = point_cost as u32;
    if (left < point_cost) return (spent, gain);
    spent = spent + point_cost;
    left = left - point_cost;
    gain = gain + (point_gain as u32);
  };
  (spent, gain)
}
