// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The LIVING-CONTENT domain guard for dungeons (plan 2026-08-23): dungeon rooms are
/// LIVE-READ per engage — only the run's seed commits at ENTER. A mid-run rebalance that
/// shrinks the room list under a live run must abort CLEAN at the next engage (never a
/// silent wrong room), and the rescue doors (`abandon_run`/`give_up_room`) read only the
/// character's own run row — no WorldContent input — so a stranded run always has a way out.
#[test_only]
module aresrpg::dungeon_rebalance_tests;

use aresrpg::{dungeon};
use aresrpg_math::world_map;

fun room(mob_type: vector<u8>): world_map::DungeonRoom {
  world_map::new_dungeon_room(vector[world_map::new_room_mob(mob_type.to_string())])
}

fun three_room_content(): world_map::WorldContent {
  let mut content = world_map::empty_world_content();
  world_map::set_dungeon_rooms(&mut content, vector[room(b"frog"), room(b"frog"), room(b"boss")]);
  content
}

#[test]
fun same_world_room_join_scope_ignores_the_entry_portal() {
  dungeon::join_scope_for_testing(
    b"nauvis".to_string(), 2, 100, 200,
    b"nauvis".to_string(), 2, 9_000, 8_000,
  );
}

#[test]
#[expected_failure] // vector out-of-bounds: the abort-clean promise, not a silent wrong room
fun a_room_list_shrunk_under_a_live_run_aborts_the_next_engage() {
  let mut content = three_room_content();
  // a run sits at room 3 when the rebalance lands: the world now authors ONE room
  world_map::set_dungeon_rooms(&mut content, vector[room(b"frog")]);
  let _mobs = world_map::dungeon_room_at(&content, 3);
}

#[test]
fun the_same_rebalance_forward_heals_fresh_runs() {
  let mut content = three_room_content();
  world_map::set_dungeon_rooms(&mut content, vector[room(b"toad")]);
  // a NEW run (room 1) engages the rebalanced composition immediately — live-read by design
  let mobs = world_map::dungeon_room_at(&content, 1);
  assert!(mobs.length() == 1, 0);
  assert!(world_map::room_mob_type(&mobs[0]) == b"toad".to_string(), 1);
  assert!(world_map::dungeon_room_count(&content) == 1, 2);
}

#[test]
fun dungeon_member_scalars_are_committed_by_run_room_seed_not_authored_content() {
  let first = world_map::dungeon_level_scalar(77, 0);
  assert!(first == world_map::dungeon_level_scalar(77, 0), 0);
  assert!(first != world_map::dungeon_level_scalar(78, 0), 1);
  assert!(first <= 100 && world_map::dungeon_level_scalar(77, 5) <= 100, 2);
}
