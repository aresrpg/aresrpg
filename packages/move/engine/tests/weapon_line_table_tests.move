// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #1803 / §17.27 — the CHAIN half of the WEAPON FAMILY LINE parity fixture
/// (`packages/sim/test/fixtures/weapon_family_lines.json`, whose `_doc` carries the contract). Every row below
/// is that file's row for the same family; the JS half is `packages/fight/test/weapon_family_lines.test.js`,
/// reading `@aresrpg/fight/weapon_lines` — the door the chain-LESS build simulator resolves a seat's weapon
/// through. A tuning edit that lands on one twin breaks the other, which is the whole point of pinning it here
/// rather than trusting two tables to stay in step.
#[test_only]
module aresrpg_fight::weapon_line_table_tests;

use aresrpg_fight::participant;
use std::string::String;

/// One fixture row: the plain line, then the affinity line's two scaled bases (nothing else may move).
fun check(
  family: vector<u8>, element: u8, damage: u64, crit_damage: u64, crit_rate: u64, ap_cost: u64, reach: u64,
  affinity_damage: u64, affinity_crit_damage: u64,
) {
  let slug: String = family.to_string();
  let w = participant::weapon_line_of(option::some(slug), false);
  assert!(participant::weapon_line_element(&w) == element, 0);
  assert!(participant::weapon_line_damage(&w) == damage, 1);
  assert!(participant::weapon_line_damage_max(&w) == damage, 2); // a family line is FIXED (max == min)
  assert!(participant::weapon_line_crit_damage(&w) == crit_damage, 3);
  assert!(participant::weapon_line_crit_damage_max(&w) == crit_damage, 4);
  assert!(participant::weapon_line_crit_rate(&w) == crit_rate, 5);
  assert!(participant::weapon_line_ap_cost(&w) == ap_cost, 6);
  assert!(participant::weapon_line_reach(&w) == reach, 7);
  assert!(participant::weapon_line_category(&w) == family.to_string(), 8); // §387 — the family IS the zone key
  let a = participant::weapon_line_of(option::some(family.to_string()), true);
  assert!(participant::weapon_line_damage(&a) == affinity_damage, 9);
  assert!(participant::weapon_line_damage_max(&a) == affinity_damage, 10);
  assert!(participant::weapon_line_crit_damage(&a) == affinity_crit_damage, 11);
  assert!(participant::weapon_line_crit_damage_max(&a) == affinity_crit_damage, 12);
  // affinity NEVER touches the mechanics.
  assert!(participant::weapon_line_crit_rate(&a) == crit_rate, 13);
  assert!(participant::weapon_line_ap_cost(&a) == ap_cost, 14);
  assert!(participant::weapon_line_reach(&a) == reach, 15);
}

#[test]
/// All 11 families — the #387 matrix's first column, in the fixture's own order.
fun every_family_swings_its_own_line() {
  check(b"longsword", 2, 18, 27, 20, 4, 1, 19, 29);
  check(b"daggers", 3, 10, 16, 10, 3, 1, 11, 17);
  check(b"battleaxe", 2, 22, 33, 25, 5, 1, 24, 36);
  check(b"spear", 2, 14, 21, 20, 4, 2, 15, 23);
  check(b"staff", 0, 12, 18, 20, 4, 3, 13, 19);
  check(b"spellbook", 1, 10, 15, 20, 3, 5, 11, 16);
  check(b"bow", 3, 15, 22, 20, 4, 6, 16, 24);
  check(b"axe", 0, 20, 30, 22, 5, 1, 22, 33);
  check(b"mace", 2, 17, 25, 20, 4, 1, 18, 27);
  check(b"club", 2, 16, 24, 18, 4, 1, 17, 26);
  check(b"sword", 2, 15, 22, 18, 3, 1, 16, 24);
}

#[test]
/// The fixture's `unarmed` row: no family, a gathering tool and a junk slug all fight bare-handed, and bare
/// hands never carry affinity.
fun everything_else_fights_bare_handed() {
  let none_line = participant::weapon_line_of(option::none(), false);
  let tool = participant::weapon_line_of(option::some(b"tool_miner".to_string()), false);
  let junk = participant::weapon_line_of(option::some(b"".to_string()), true);
  let lines = vector[none_line, tool, junk];
  let mut i = 0;
  while (i < lines.length()) {
    let w = lines.borrow(i);
    assert!(participant::weapon_line_element(w) == 2, 0);
    assert!(participant::weapon_line_damage(w) == 4 && participant::weapon_line_damage_max(w) == 4, 1);
    assert!(participant::weapon_line_crit_damage(w) == 6 && participant::weapon_line_crit_damage_max(w) == 6, 2);
    assert!(participant::weapon_line_crit_rate(w) == 30, 3);
    assert!(participant::weapon_line_ap_cost(w) == 3, 4);
    assert!(participant::weapon_line_reach(w) == 1, 5);
    assert!(participant::weapon_line_category(w) == b"".to_string(), 6);
    i = i + 1;
  };
}
