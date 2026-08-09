// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure unit coverage for `mob`'s zero-covered getters: a bare `FightMob` (via the existing
/// `new_mob_for_testing` fixture) exercises `ap`; a `MobLootEntry` exercises its four field getters. No Scenario
/// needed — these are plain-data constructors + accessors.
#[test_only]
module aresrpg_fight::mob_more_tests;

use aresrpg_fight::mob;
use aresrpg_foundation::{spell, spell_effect::{Self, SpellLevel}};

const ETooManySpells: u64 = 101;

fun spell_level(): SpellLevel {
  spell_effect::new_spell_level(
    1, 3, 1, 4, false, false, true, false, 255, 255, 0, 0, false,
    vector[], vector[], vector[spell_effect::damage(spell::el_earth(), 1)], vector[],
  )
}

fun spec_with_spells(count: u64): mob::MobSpec {
  let mut spells = vector[];
  let mut i = 0;
  while (i < count) { spells.push_back(spell_level()); i = i + 1 };
  mob::new_mob_spec(1, 1, 10, 6, 3, spell::stats_zero(), spells, 1, vector[])
}

#[test]
fun fight_mob_ap_getter() {
  let m = mob::new_mob_for_testing(5, 80, 100, 6, 3);
  assert!(mob::ap(&m) == 6);
}

#[test]
fun loot_entry_field_getters() {
  let e = mob::new_loot_entry(object::id_from_address(@0xF00D), 2500, 1, 3);
  assert!(mob::loot_entry_item_template(&e) == object::id_from_address(@0xF00D));
  assert!(mob::loot_entry_chance_bp(&e) == 2500);
  assert!(mob::loot_entry_min_qty(&e) == 1);
  assert!(mob::loot_entry_max_qty(&e) == 3);
}

#[test]
/// #1406 boundary: the engine spec and its runtime kit preserve all five sanctioned boss spells.
fun five_spell_spec_is_admitted() {
  let spec = spec_with_spells(5);
  let kit = mob::kit_of(&spec);
  assert!(mob::kit_spells(&kit).length() == 5);
}

#[test, expected_failure(abort_code = ETooManySpells, location = mob)]
/// The mechanical lift is one slot only: six still exceeds the bounded-compute contract.
fun six_spell_spec_aborts() {
  spec_with_spells(6);
  abort
}
