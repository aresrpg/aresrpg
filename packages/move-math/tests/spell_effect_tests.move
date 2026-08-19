// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::spell_effect_tests;

use aresrpg_math::spell_effect;

const EBadTurns: u64 = 1409;

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
