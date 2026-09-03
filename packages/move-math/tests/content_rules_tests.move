// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The name byte law is TOTAL: printable ASCII only. The non-ASCII fixtures pin the 2026-08-16
/// hole where multi-byte UTF-8 slipped past the whitespace-only check — a chain-legal name the
/// SDK's normalize could never produce.
#[test_only]
module aresrpg_math::content_rules_tests;

use aresrpg_math::{combat_grid, content_rules, item_damages, spell_effect, weapon};

#[test]
fun printable_ascii_names_pass() {
  assert!(content_rules::is_printable_ascii(&b"aiden".to_string()));
  assert!(content_rules::is_printable_ascii(&b"x_42-Z!".to_string()));
}

#[test]
fun whitespace_control_del_and_non_ascii_all_refuse() {
  assert!(!content_rules::is_printable_ascii(&b"has space".to_string()));
  assert!(!content_rules::is_printable_ascii(&b"tab\there".to_string()));
  assert!(!content_rules::is_printable_ascii(&b"del\x7Fbyte".to_string()));
  // "héllo" — the é is two bytes (0xC3 0xA9), both outside printable ASCII
  assert!(!content_rules::is_printable_ascii(&b"h\xC3\xA9llo".to_string()));
  // a zero-width-space name (0xE2 0x80 0x8B) must never be a distinct chain identity
  assert!(!content_rules::is_printable_ascii(&b"ghost\xE2\x80\x8B".to_string()));
}

#[test]
fun pet_food_is_not_a_category_and_rune_keeps_its_twin_law() {
  assert!(!content_rules::is_category(&b"pet_food".to_string()));
  assert!(!content_rules::is_stackable(&b"pet_food".to_string()));
  assert!(content_rules::is_category(&b"rune".to_string()));
  assert!(content_rules::is_stackable(&b"rune".to_string()));
  assert!(content_rules::is_stackable(&b"key".to_string()));
  let foods = vector[b"wheat".to_string(), b"quartz".to_string()];
  assert!(content_rules::pet_accepts(&foods, &b"quartz".to_string()));
  assert!(!content_rules::pet_accepts(&foods, &b"aloe_vera".to_string()));
}

#[test]
fun curated_equipment_jobs_and_slots_are_exact() {
  assert!(content_rules::is_category(&b"sword".to_string()));
  assert!(content_rules::is_category(&b"hat".to_string()));
  assert!(!content_rules::is_category(&b"longsword".to_string()));
  assert!(!content_rules::is_category(&b"helmet".to_string()));
  assert!(!content_rules::is_slot(&b"chestplate".to_string()));
  assert!(content_rules::category_fits(&b"weapon".to_string(), &b"spear".to_string()));
  assert!(content_rules::category_fits(&b"cloak".to_string(), &b"cloak".to_string()));
  assert!(content_rules::craft_job_of(&b"axe".to_string()) == option::some(b"FORGER".to_string()));
  assert!(content_rules::craft_job_of(&b"sword".to_string()) == option::some(b"FORGER".to_string()));
  assert!(content_rules::craft_job_of(&b"daggers".to_string()) == option::some(b"FORGER".to_string()));
  assert!(content_rules::craft_job_of(&b"bow".to_string()) == option::some(b"CARVER".to_string()));
  assert!(content_rules::craft_job_of(&b"spear".to_string()) == option::some(b"CARVER".to_string()));
  assert!(content_rules::craft_job_of(&b"hat".to_string()) == option::some(b"TAILOR".to_string()));
  assert!(content_rules::craft_job_of(&b"cloak".to_string()) == option::some(b"TAILOR".to_string()));
  assert!(content_rules::craft_job_of(&b"belt".to_string()) == option::some(b"TANNER".to_string()));
  assert!(content_rules::craft_job_of(&b"boots".to_string()) == option::some(b"TANNER".to_string()));
  assert!(content_rules::craft_job_of(&b"ring".to_string()) == option::some(b"JEWELER".to_string()));
  assert!(content_rules::craft_job_of(&b"amulet".to_string()) == option::some(b"JEWELER".to_string()));
}

#[test]
fun every_class_has_the_authored_five_family_affinity() {
  assert!(weapon::affinity_of(&b"yajin".to_string(), &b"daggers".to_string()));
  assert!(weapon::affinity_of(&b"senshi".to_string(), &b"sword".to_string()));
  assert!(weapon::affinity_of(&b"yogan".to_string(), &b"bow".to_string()));
  assert!(weapon::affinity_of(&b"mori".to_string(), &b"spear".to_string()));
  assert!(weapon::affinity_of(&b"shugo".to_string(), &b"spear".to_string()));
  assert!(weapon::affinity_of(&b"tomoda".to_string(), &b"spear".to_string()));
  assert!(weapon::affinity_of(&b"rojin".to_string(), &b"daggers".to_string()));
  assert!(weapon::affinity_of(&b"tokei".to_string(), &b"axe".to_string()));
  assert!(weapon::affinity_of(&b"asobi".to_string(), &b"sword".to_string()));
  assert!(weapon::affinity_of(&b"iyashi".to_string(), &b"bow".to_string()));
  assert!(weapon::affinity_of(&b"ikari".to_string(), &b"axe".to_string()));
  assert!(weapon::affinity_of(&b"shusen".to_string(), &b"axe".to_string()));
  assert!(!weapon::affinity_of(&b"senshi".to_string(), &b"axe".to_string()));
}

#[test]
fun weapon_areas_are_the_five_authored_shapes() {
  let lines = vector[item_damages::new(1, 1, b"melee".to_string(), b"earth".to_string())];
  let bow_level = weapon::strike_of(&b"bow".to_string(), &lines, false);
  assert!(spell_effect::range_min(&bow_level) == 2);
  assert!(spell_effect::range_max(&bow_level) == 6);
  let sword = spell_effect::effects(&weapon::strike_of(&b"sword".to_string(), &lines, false));
  let daggers = spell_effect::effects(&weapon::strike_of(&b"daggers".to_string(), &lines, false));
  let spear = spell_effect::effects(&weapon::strike_of(&b"spear".to_string(), &lines, false));
  let axe = spell_effect::effects(&weapon::strike_of(&b"axe".to_string(), &lines, false));
  let bow = spell_effect::effects(&weapon::strike_of(&b"bow".to_string(), &lines, false));

  assert!(spell_effect::area_shape(&sword[0]) == spell_effect::shape_point());
  assert!(spell_effect::area_shape(&daggers[0]) == spell_effect::shape_point());
  assert!(spell_effect::area_shape(&bow[0]) == spell_effect::shape_point());
  assert!(spell_effect::area_shape(&spear[0]) == spell_effect::shape_tbar());
  assert!(spell_effect::area_size(&spear[0]) == 1);
  assert!(spell_effect::area_shape(&axe[0]) == spell_effect::shape_podium());
  assert!(spell_effect::area_size(&axe[0]) == 1);
  assert!(combat_grid::zone_cells(spell_effect::shape_tbar(), 1, 41, 40).length() == 3);
  assert!(combat_grid::zone_cells(spell_effect::shape_podium(), 1, 41, 40).length() == 4);
}
