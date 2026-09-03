// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::dungeon_data_tests;

use aresrpg_math::dungeon_data;

#[test]
fun independent_dungeon_content_preserves_room_order() {
  let data = dungeon_data::new_dungeon(
    b"key".to_string(),
    vector[
      dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"fuwa__white".to_string())]),
      dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"araknomath".to_string())]),
    ],
  );
  assert!(dungeon_data::room_count(&data) == 2, 0);
  assert!(dungeon_data::mob_type(&dungeon_data::room_at(&data, 2)[0]) == b"araknomath".to_string(), 1);
}
