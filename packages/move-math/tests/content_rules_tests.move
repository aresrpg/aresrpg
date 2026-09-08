// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The name byte law is TOTAL: printable ASCII only. The non-ASCII fixtures pin the 2026-08-16
/// hole where multi-byte UTF-8 slipped past the whitespace-only check — a chain-legal name the
/// SDK's normalize could never produce.
#[test_only]
module aresrpg_math::content_rules_tests;

use aresrpg_math::{combat_grid, content_rules, item_damages, spell_effect, weapon};

#[test]
fun the_equipment_slot_matrix_refuses_cross_category_equips() {
  let slots = vector[b"hat", b"cloak", b"belt", b"boots", b"amulet", b"pet", b"title", b"cosmetic_hat", b"cosmetic_cloak"];
  slots.do_ref!(|slot| {
    let slot = (*slot).to_string();
    assert!(content_rules::is_slot(&slot) && content_rules::is_category(&slot), 0);
    assert!(content_rules::category_fits(&slot, &slot), 1);
    assert!(!content_rules::category_fits(&slot, &b"resource".to_string()), 2);
  });
  let weapons = vector[b"daggers", b"spear", b"bow", b"axe", b"sword"];
  weapons.do_ref!(|family| {
    let family = (*family).to_string();
    assert!(content_rules::is_category(&family), 3);
    assert!(content_rules::category_fits(&b"weapon".to_string(), &family), 4);
  });
  let tools = vector[b"tool_farmer", b"tool_herbalist", b"tool_miner"];
  tools.do_ref!(|category| {
    let category = (*category).to_string();
    assert!(content_rules::is_category(&category), 5);
    assert!(content_rules::category_fits(&b"tool".to_string(), &category), 6);
  });
  assert!(content_rules::is_slot(&b"weapon".to_string()) && content_rules::is_slot(&b"tool".to_string()), 7);
  assert!(!content_rules::category_fits(&b"weapon".to_string(), &b"tool_miner".to_string()), 8);
  assert!(!content_rules::category_fits(&b"tool".to_string(), &b"sword".to_string()), 9);
  let rings = vector[b"left_ring", b"right_ring"];
  rings.do_ref!(|slot| {
    let slot = (*slot).to_string();
    assert!(content_rules::is_slot(&slot), 10);
    assert!(content_rules::category_fits(&slot, &b"ring".to_string()), 11);
    assert!(!content_rules::category_fits(&slot, &b"amulet".to_string()), 12);
  });
  let relic_slots = vector[b"relic_1", b"relic_2", b"relic_3", b"relic_4", b"relic_5", b"relic_6"];
  let mut i = 0;
  while (i < 6) {
    let slot = content_rules::relic_slot((i + 1) as u8);
    assert!(slot == relic_slots[i].to_string(), 13);
    assert!(content_rules::is_slot(&slot), 14);
    assert!(content_rules::category_fits(&slot, &b"relic".to_string()), 15);
    assert!(!content_rules::category_fits(&slot, &b"ring".to_string()), 16);
    i = i + 1;
  };
  assert!(content_rules::is_category(&b"relic".to_string()), 17);
}

#[test]
fun authored_classes_stackables_and_uncraftable_categories_are_explicit() {
  let classes = vector[b"shugo", b"tomoda", b"rojin", b"yajin", b"tokei", b"asobi", b"iyashi", b"senshi", b"yogan", b"mori", b"ikari", b"shusen"];
  classes.do_ref!(|classe| assert!(content_rules::is_classe(&(*classe).to_string()), 0));
  assert!(!content_rules::is_classe(&b"unknown".to_string()), 1);
  let stackables = vector[b"consumable", b"resource", b"rune", b"key"];
  stackables.do_ref!(|category| {
    let category = (*category).to_string();
    assert!(content_rules::is_category(&category) && content_rules::is_stackable(&category), 2);
    assert!(!content_rules::is_slot(&category), 3);
  });
  assert!(content_rules::craft_job_of(&b"key".to_string()) == option::some(b"HANDYMAN".to_string()), 4);
  assert!(content_rules::craft_job_of(&b"pet".to_string()).is_none(), 5);
  assert!(!content_rules::is_relic_slot(&b"relic_7".to_string()), 6);
  assert!(content_rules::is_printable_ascii(&b"!~".to_string()), 7);
}

#[test]
fun cosmetics_are_unique_and_fit_only_their_own_slot() {
  let categories = vector[b"cosmetic_hat".to_string(), b"cosmetic_cloak".to_string()];
  categories.do_ref!(|category| {
    assert!(content_rules::is_category(category));
    assert!(content_rules::is_slot(category));
    assert!(!content_rules::is_stackable(category));
    assert!(content_rules::category_fits(category, category));
    assert!(!content_rules::category_fits(&b"hat".to_string(), category));
    assert!(!content_rules::category_fits(&b"cloak".to_string(), category));
    assert!(!content_rules::category_fits(category, &b"hat".to_string()));
    assert!(!content_rules::category_fits(category, &b"cloak".to_string()));
  });
  assert!(!content_rules::category_fits(&categories[0], &categories[1]));
  assert!(!content_rules::category_fits(&categories[1], &categories[0]));
}

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
