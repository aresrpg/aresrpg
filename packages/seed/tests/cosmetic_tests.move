// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::cosmetic_tests;

use aresrpg_control::admin;
use aresrpg_math::item_stats;
use aresrpg_seed::{item_rows, registry};

fun author_power(category: vector<u8>, damages: bool) {
  let mut ctx = tx_context::dummy();
  let cap = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let mut template = item_rows::template_for_testing(b"cosmetic".to_string(), category.to_string(), &mut ctx);
  if (damages) item_rows::set_damages(&cap, &mut root, &mut template, vector[], &ctx)
  else item_rows::set_stats(&cap, &mut root, &mut template, item_stats::zero(), item_stats::zero(), &ctx);
  item_rows::destroy_for_testing(template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
}

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun cosmetic_hat_refuses_even_neutral_stats() { author_power(b"cosmetic_hat", false); }

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun cosmetic_cloak_refuses_even_neutral_stats() { author_power(b"cosmetic_cloak", false); }

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun cosmetic_hat_refuses_damage_fields() { author_power(b"cosmetic_hat", true); }

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun cosmetic_cloak_refuses_damage_fields() { author_power(b"cosmetic_cloak", true); }

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun stackable_resources_refuse_stats() { author_power(b"resource", false); }

#[test, expected_failure(abort_code = 4502, location = aresrpg_seed::item_rows)]
fun stackable_resources_refuse_damage_fields() { author_power(b"resource", true); }
