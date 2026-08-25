// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// JOB XP CURVE — the exact 100-level job progression table, immutable law like the character
/// curve (legacy port, verbatim). Index i = total xp to REACH level i (index 0 unused) so the
/// layout and binary search match the character curve byte for byte. `tier_to_level` maps a
/// resource tier T1–T11 to its unlock job level — the gathering tier gate reads it.
module aresrpg_math::job_xp;

use std::string::String;

const MAX_LEVEL: u64 = 100;
const MAX_CRAFT_INGREDIENTS: u64 = 8;

/// Index i = the TOTAL job xp required to REACH job level i (index 0 unused, index 1 =
/// level 1 = 0 xp; index 100 = level 100).
const JOB_CURVE: vector<u64> = vector[
  0, // index 0 (unused)
  0, // level 1
  50, // level 2
  140, // level 3
  271, // level 4
  441, // level 5
  653, // level 6
  905, // level 7
  1199, // level 8
  1534, // level 9
  1911, // level 10
  2330, // level 11
  2792, // level 12
  3297, // level 13
  3846, // level 14
  4439, // level 15
  5078, // level 16
  5762, // level 17
  6493, // level 18
  7271, // level 19
  8097, // level 20
  8973, // level 21
  9898, // level 22
  10875, // level 23
  11903, // level 24
  12985, // level 25
  14122, // level 26
  15315, // level 27
  16564, // level 28
  17873, // level 29
  19242, // level 30
  20672, // level 31
  22166, // level 32
  23726, // level 33
  25353, // level 34
  27048, // level 35
  28815, // level 36
  30656, // level 37
  32572, // level 38
  34566, // level 39
  36641, // level 40
  38800, // level 41
  41044, // level 42
  43378, // level 43
  45804, // level 44
  48325, // level 45
  50946, // level 46
  53669, // level 47
  56498, // level 48
  59437, // level 49
  62491, // level 50
  65664, // level 51
  68960, // level 52
  72385, // level 53
  75943, // level 54
  79640, // level 55
  83482, // level 56
  87475, // level 57
  91624, // level 58
  95937, // level 59
  100421, // level 60
  105082, // level 61
  109930, // level 62
  114971, // level 63
  120215, // level 64
  125671, // level 65
  131348, // level 66
  137256, // level 67
  143407, // level 68
  149811, // level 69
  156481, // level 70
  163429, // level 71
  170669, // level 72
  178214, // level 73
  186080, // level 74
  194283, // level 75
  202839, // level 76
  211765, // level 77
  221082, // level 78
  230808, // level 79
  240964, // level 80
  251574, // level 81
  262660, // level 82
  274248, // level 83
  286364, // level 84
  299037, // level 85
  312297, // level 86
  326175, // level 87
  340705, // level 88
  355924, // level 89
  371870, // level 90
  388582, // level 91
  406106, // level 92
  424486, // level 93
  443772, // level 94
  464016, // level 95
  485274, // level 96
  507604, // level 97
  531071, // level 98
  555541, // level 99
  581687, // level 100
];

/// Job level from total job xp — highest index whose threshold is ≤ xp; `mid = (low+high+1)/2`
/// converges to the FLOOR level. Clamped at MAX_LEVEL.
public fun level_from_xp(xp: u64): u64 {
  if (xp == 0) return 1;
  let curve = JOB_CURVE;
  if (xp >= *curve.borrow(MAX_LEVEL)) return MAX_LEVEL;
  let mut low = 1;
  let mut high = MAX_LEVEL;
  while (low < high) {
    let mid = (low + high + 1) / 2;
    if (*curve.borrow(mid) <= xp) { low = mid } else { high = mid - 1 };
  };
  low
}

/// Resource tier (T1–T11) → the job level that unlocks it: tier 1 = level 1, then
/// (tier−1)×10, capped at MAX_LEVEL. (T2→10, T3→20, … T10→90, T11→100.)
public fun tier_to_level(tier: u64): u64 {
  if (tier <= 1) return 1;
  let level = (tier - 1) * 10;
  if (level > MAX_LEVEL) MAX_LEVEL else level
}

public fun max_level(): u64 { MAX_LEVEL }

public fun max_craft_ingredients(): u64 { MAX_CRAFT_INGREDIENTS }

public fun craft_success_bp(level: u64): u64 {
  let basis_points = 5_000 + (level - 1) * 50;
  if (basis_points > 9_900) 9_900 else basis_points
}

public fun craft_required_level(ingredient_count: u64): u64 {
  if (ingredient_count <= 2) return 1;
  if (ingredient_count == 3) return 10;
  if (ingredient_count == 4) return 20;
  if (ingredient_count == 5) return 40;
  if (ingredient_count == 6) return 60;
  if (ingredient_count == 7) return 80;
  100
}

public fun craft_slot_capacity(level: u64): u64 {
  if (level < 10) return 2;
  if (level < 20) return 3;
  if (level < 40) return 4;
  if (level < 60) return 5;
  if (level < 80) return 6;
  if (level < 100) return 7;
  MAX_CRAFT_INGREDIENTS
}

public fun craft_xp(ingredient_count: u64): u64 {
  if (ingredient_count <= 2) 10
  else if (ingredient_count == 3) 25
  else if (ingredient_count == 4) 50
  else if (ingredient_count == 5) 100
  else if (ingredient_count == 6) 250
  else if (ingredient_count == 7) 500
  else 1_000
}

public fun craft_xp_at_level(ingredient_count: u64, crafter_level: u64): u64 {
  if (ingredient_count + 3 < craft_slot_capacity(crafter_level)) 0
  else craft_xp(ingredient_count)
}

public fun gathering_tool(job: &String): String {
  if (*job == b"FARMER".to_string()) return b"tool_farmer".to_string();
  if (*job == b"HERBALIST".to_string()) return b"tool_herbalist".to_string();
  b"tool_miner".to_string()
}

public fun gather_quantity_bounds(job_level: u64, required_level: u64): (u64, u64) {
  let min = 1 + 5 * (job_level - 1) / 99;
  let max_raw = 2 + (job_level - required_level) / 5;
  (min, if (max_raw < min) min else max_raw)
}

public fun gather_xp(required_level: u64): u64 { 10 + required_level / 2 }

public fun gather_time_ms(job_level: u64): u64 {
  let time = 12_000 - 10_000 * (job_level - 1) / 99;
  if (time < 2_000) 2_000 else time
}
