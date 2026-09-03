// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::spell_effect_tests;

use aresrpg_math::spell_effect;

const EBadTurns: u64 = 1409;
const EBadLevel: u64 = 1407;
const ETooManyRows: u64 = 1410;
const EBadAreaSize: u64 = 1411;

fun effect(kind: u8, turns: u8) {
  spell_effect::new_effect(
    kind,
    if (kind <= 3) b"earth".to_string() else b"".to_string(),
    1,
    1,
    spell_effect::shape_point(),
    0,
    if (kind == 10) 4 else 1,
    10_000,
    turns,
    0,
  );
}

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun percentage_damage_rejects_duration() { effect(1, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun teleport_rejects_duration() { effect(10, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun dispel_rejects_duration() { effect(16, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun chatiment_rejects_a_non_retro_duration() { effect(7, 4) }

#[test]
#[expected_failure(abort_code = EBadAreaSize, location = aresrpg_math::spell_effect)]
fun an_effect_rejects_an_area_larger_than_the_authored_board_envelope() {
  spell_effect::new_effect(0, b"earth".to_string(), 1, 1, spell_effect::shape_circle(), 11, 1, 10_000, 0, 0);
}

#[test]
#[expected_failure(abort_code = EBadLevel, location = aresrpg_math::spell_effect)]
fun a_spell_rejects_zero_ap() {
  spell_effect::new_spell_level(0, 0, 1, false, false, false, false, 0, 0, 0, 0, vector[], vector[]);
}

#[test]
#[expected_failure(abort_code = ETooManyRows, location = aresrpg_math::spell_effect)]
fun a_spell_rejects_more_than_eight_effect_rows() {
  let row = spell_effect::new_effect(0, b"earth".to_string(), 1, 1, spell_effect::shape_point(), 0, 1, 10_000, 0, 0);
  spell_effect::new_spell_level(
    1, 0, 1, false, false, false, false, 0, 0, 0, 0,
    vector[row, row, row, row, row, row, row, row, row],
    vector[],
  );
}
