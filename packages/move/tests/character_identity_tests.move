// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::character_identity_tests;

use aresrpg::character;
use std::unit_test::destroy;

#[test]
fun character_id_is_the_registry_and_lowercase_name() {
  let mut ctx = tx_context::dummy();
  let mut registry = character::test_registry(&mut ctx);
  let name = b"aiden".to_string();
  let expected = character::test_derived_address(&registry, name);
  let id = character::test_claim_name(&mut registry, name);

  assert!(id.to_address() == expected);
  id.delete();
  assert!(character::test_name_exists(&registry, name));
  destroy(registry);
}
