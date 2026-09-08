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
  assert!(dungeon_data::key(&data) == b"key".to_string() && dungeon_data::room_count(&data) == 2, 0);
  assert!(dungeon_data::mob_type(&dungeon_data::room_at(&data, 2)[0]) == b"araknomath".to_string(), 1);
}

#[test, expected_failure(abort_code = 3301, location = aresrpg_math::dungeon_data)]
fun a_dungeon_requires_a_key_and_at_least_one_room() {
  dungeon_data::new_dungeon(b"key".to_string(), vector[]);
}
#[test, expected_failure(abort_code = 3301, location = aresrpg_math::dungeon_data)]
fun a_dungeon_cannot_publish_an_empty_key() {
  dungeon_data::new_dungeon(b"".to_string(), vector[dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"guard".to_string())])]);
}
#[test, expected_failure(abort_code = 3302, location = aresrpg_math::dungeon_data)]
fun an_empty_room_cannot_be_farmed() { dungeon_data::new_room(vector[]); }
#[test]
fun committed_room_scalars_remain_bounded_for_every_seat() {
  vector[0u64, 77, 78, 18446744073709551615].do!(|seed| {
    let mut seat = 0u64;
    while (seat < 6) {
      assert!(dungeon_data::level_scalar(seed, seat) <= 100, 0);
      seat = seat + 1;
    };
  });
  assert!(dungeon_data::level_scalar(77, 0) != dungeon_data::level_scalar(78, 0), 1);
}
