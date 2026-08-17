// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The name byte law is TOTAL: printable ASCII only. The non-ASCII fixtures pin the 2026-08-16
/// hole where multi-byte UTF-8 slipped past the whitespace-only check — a chain-legal name the
/// SDK's normalize could never produce.
#[test_only]
module aresrpg_math::content_rules_tests;

use aresrpg_math::content_rules;

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
  let foods = vector[b"wheat".to_string(), b"quartz".to_string()];
  assert!(content_rules::pet_accepts(&foods, &b"quartz".to_string()));
  assert!(!content_rules::pet_accepts(&foods, &b"aloe_vera".to_string()));
}
