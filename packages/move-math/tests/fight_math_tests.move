// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::fight_math_tests;

use aresrpg_math::fight_math;

#[test]
fun critical_draw_is_stable_per_turn_and_spell() {
  let slash = fight_math::spell_crit_roll(5, &b"slash".to_string());
  let stab = fight_math::spell_crit_roll(5, &b"stab".to_string());

  // Golden values from the TypeScript integer twin. Both spells have the same 1-in-3 rate,
  // but the canonical name gives each an independent stable result for this turn.
  assert!(slash == 1_039_393_101 && slash % 3 == 0, 0);
  assert!(stab == 3_900_873_764 && stab % 3 != 0, 1);
  assert!(fight_math::spell_crit_roll(5, &b"slash".to_string()) == slash, 2);
}
