// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure unit coverage for `mob`'s zero-covered getters: a bare `FightMob` (via the existing
/// `new_mob_for_testing` fixture) exercises `ap`; a `MobLootEntry` exercises its four field getters. No Scenario
/// needed — these are plain-data constructors + accessors.
#[test_only]
module aresrpg_fight::mob_more_tests;

use aresrpg_fight::mob;
use aresrpg_foundation::{spell, spell_effect::{Self, SpellLevel}};

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

// ╔════════════════ [ §17.21 mob spell-kit bound — 4→5 (elite/dungeon_boss tiers carry up to 5) ] ═ ]

const ETooManySpells: u64 = 101; // mob::new_mob_spec spell-kit bound (mirrored; `location` disambiguates)

// A minimal kit spell — only the kit LENGTH matters for the MAX_SPELLS bound (no effects needed).
fun a_spell(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 4, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[], vector[])
}
fun spell_kit(n: u64): vector<SpellLevel> {
  let mut v = vector[];
  let mut i = 0;
  while (i < n) { v.push_back(a_spell()); i = i + 1; };
  v
}

#[test]
/// The seed corpus authors 5-spell kits for its three elite/dungeon_boss bosses — `new_mob_spec` must ACCEPT a
/// full 5-spell kit (RED at the old 4-bound: it aborted ETooManySpells). Reaching the xp read = the kit was taken.
fun new_mob_spec_accepts_five_spells() {
  let spec = mob::new_mob_spec(
    1, 1, 100, 6, 0, spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), spell_kit(5), 100, vector[],
  );
  assert!(mob::spec_xp(&spec) == 100);
}

#[test, expected_failure(abort_code = ETooManySpells, location = mob)]
/// The widened bound is still a bound: a 6-spell kit exceeds MAX_SPELLS (5) and aborts.
fun new_mob_spec_rejects_six_spells() {
  let _spec = mob::new_mob_spec(
    1, 1, 100, 6, 0, spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), spell_kit(6), 100, vector[],
  );
  abort
}
