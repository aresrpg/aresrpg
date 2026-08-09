// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// JOB XP CURVE — the exact 100-level job progression table, immutable law like the character curve (SPEC §6:
/// "The job experience curve is hardcoded and immutable (like the character curve)"). Values copied VERBATIM
/// from the reference corpus's `JobExperience.java` (`TABLE`, formulas annex
/// §6a). Java stores it 0-indexed (`TABLE[level-1]`); on-chain we prepend an UNUSED index-0 slot so the layout
/// and the binary search are byte-for-byte the SAME as `character_xp` (index i = total xp to REACH level i).
/// NOT a GameConfig dial — the curve is law. `tier_to_level` (annex §6b `GatheringFormulas.tierToLevel`) maps a
/// resource tier T1–T11 to its unlock job level, used by the gathering pass to gate nodes.
module aresrpg_foundation::job_xp;

const MAX_LEVEL: u64 = 100;

/// Index i = the TOTAL job xp required to REACH job level i (index 0 unused, index 1 = level 1 = 0 xp; index
/// 100 = level 100). Verbatim `JobExperience.TABLE`, shifted one slot right so index == level.
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

/// Job level from total job xp — identical binary search to `character_xp::level_from_xp` (highest index whose
/// threshold is <= xp; `mid = (low+high+1)/2` converges to the FLOOR level). Clamped at MAX_LEVEL (100).
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

/// Resource tier (T1–T11) → the job level that unlocks it (annex §6b): tier 1 = level 1, then (tier−1)×10,
/// capped at MAX_LEVEL. (T2→10, T3→20, … T10→90, T11→100.)
public fun tier_to_level(tier: u64): u64 {
  if (tier <= 1) return 1;
  let level = (tier - 1) * 10;
  if (level > MAX_LEVEL) MAX_LEVEL else level
}

public fun max_level(): u64 { MAX_LEVEL }
