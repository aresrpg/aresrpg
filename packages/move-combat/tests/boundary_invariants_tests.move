// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::boundary_invariants_tests;

use aresrpg_combat::combat;

// Exercise successive native boundaries from the captured six-mob dungeon fixture.
// Different future entropy must preserve roster, queue and terminal-state invariants.
#[test]
fun captured_boundary_invariants() {
  let mut stream = 0;
  while (stream < 16) {
    let mut state = combat::captured_dungeon_wave_for_testing();
    let count = combat::fighter_count(&state);
    let mut boundary = 0;
    while (boundary < 8 && !combat::ended(&state)) {
      let mut entropy = vector[];
      let mut index = 0;
      while (index < 24) {
        entropy.push_back(1 + stream * 1009 + boundary * 997 + index * 65537);
        index = index + 1;
      };
      let now = 1788543143064 + boundary * 120000;
      let _used = if (boundary % 2 == 1) combat::crank(&mut state, entropy, now)
        else combat::end_turn(&mut state, entropy, now);
      assert!(combat::fighter_count(&state) == count, 0);
      let queue = combat::queue(&state);
      let mut seen = vector[];
      queue.do_ref!(|fighter| {
        assert!(*fighter < count && !seen.contains(fighter), 1);
        seen.push_back(*fighter);
      });
      let mut fighter = 0;
      while (fighter < count) {
        if (combat::fighter_dead(&state, fighter)) assert!(combat::fighter_hp(&state, fighter) == 0, 2);
        fighter = fighter + 1;
      };
      if (!combat::ended(&state)) {
        let active = combat::active_fighter(&state);
        assert!(!combat::fighter_dead(&state, active), 3);
        assert!(!combat::fighter_is_mob(&state, active), 4);
      };
      boundary = boundary + 1;
    };
    // This captured encounter must resolve even when the player only yields its turns.
    assert!(combat::ended(&state), 5);
    assert!(combat::winner(&state) == option::some(1), 6);
    assert!(combat::winners_remaining(&state) == 0, 7);
    combat::destroy(state);
    stream = stream + 1;
  };
}
