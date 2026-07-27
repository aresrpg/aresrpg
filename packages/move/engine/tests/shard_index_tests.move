// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Canonical shard-index vectors mirrored by `packages/sdk/test/fight_shard_parity.test.js`.
#[test_only]
module aresrpg_fight::shard_index_tests;

use aresrpg_fight::fight_registry;

#[test]
fun move_js_shard_index_vectors() {
  assert!(fight_registry::shard_index(object::id_from_address(@0x0)) == 0);
  assert!(fight_registry::shard_index(object::id_from_address(@0x1)) == 1);
  assert!(fight_registry::shard_index(object::id_from_address(@0x10)) == 0);
  assert!(fight_registry::shard_index(object::id_from_address(@0x2f)) == 15);
  assert!(fight_registry::shard_index(object::id_from_address(@0x1234567890abcdefa7)) == 7);
}
