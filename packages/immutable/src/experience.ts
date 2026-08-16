// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Character progression calls aresrpg_math::experience::level_from_xp at
// packages/move/sources/character.move:199-206. This table mirrors its chain source,
// packages/move-math/sources/experience.move:7-212, exactly: index = level, index 0 unused.
export const experience_curve = Object.freeze([
  0, 0, 110, 650, 1500, 2800, 4800, 7300, 10500, 14500, 19200, 25200, 32600, 41000, 50500, 61000, 75000, 91000, 115000,
  142000, 171000, 202000, 235000, 270000, 310000, 353000, 398500, 448000, 503000, 561000, 621600, 687000, 755000,
  829000, 910000, 1000000, 1100000, 1240000, 1400000, 1580000, 1780000, 2000000, 2250000, 2530000, 2850000, 3200000,
  3570000, 3960000, 4400000, 4860000, 5350000, 5860000, 6390000, 6950000, 7530000, 8130000, 8765100, 9420000, 10150000,
  10894000, 11655000, 12450000, 13278000, 14138000, 15171000, 16251000, 17377000, 18553000, 19778000, 21055000,
  22385000, 23769000, 25209000, 26707000, 28264000, 29882000, 31563000, 33307000, 35118000, 36997000, 38945000,
  40965000, 43059000, 45229000, 47476000, 49803000, 52211000, 54704000, 57284000, 59952000, 62712000, 65565000,
  68514000, 71561000, 74710000, 77963000, 81323000, 84792000, 88374000, 92071000, 95886000, 99823000, 103885000,
  108075000, 112396000, 116853000, 121447000, 126184000, 131066000, 136098000, 141283000, 146626000, 152130000,
  157800000, 163640000, 169655000, 175848000, 182225000, 188791000, 195550000, 202507000, 209667000, 217037000,
  224620000, 232424000, 240452000, 248712000, 257209000, 265949000, 274939000, 284186000, 293694000, 303473000,
  313527000, 323866000, 334495000, 345423000, 356657000, 368206000, 380076000, 392278000, 404818000, 417706000,
  430952000, 444564000, 458551000, 472924000, 487693000, 502867000, 518458000, 534476000, 550933000, 567839000,
  585206000, 603047000, 621374000, 640199000, 659536000, 679398000, 699798000, 720751000, 742272000, 764374000,
  787074000, 810387000, 834329000, 858917000, 884167000, 910098000, 936727000, 964073000, 992154000, 1020991000,
  1050603000, 1081010000, 1112235000, 1144298000, 1177222000, 1211030000, 1245745000, 1281393000, 1317997000,
  1355584000, 1404179000, 1463811000, 1534506000, 1616294000, 1709205000, 1813267000, 1928513000, 2054975000,
  2192686000, 2341679000, 2501990000, 2673655000, 2856710000, 3051194000, 3257146000, 3474606000, 3703616000,
  7407232000,
])

export const max_level = 200

export const xp_for_level = (level: number): number | undefined => experience_curve[level]

export function level_from_xp(xp: number): number {
  if (xp === 0) return 1
  if (xp >= experience_curve[max_level]) return max_level

  let low = 1
  let high = max_level
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (experience_curve[mid] <= xp) low = mid
    else high = mid - 1
  }
  return low
}

// ── JOB XP (the second immutable curve) ──
// Mirrors packages/move-math/sources/job_xp.move JOB_CURVE exactly: index = job level,
// index 0 unused, 100 levels. Extracted mechanically from the Move source.
export const job_experience_curve = Object.freeze([
  0, 0, 50, 140, 271, 441, 653, 905, 1199, 1534, 1911, 2330, 2792, 3297, 3846, 4439, 5078, 5762, 6493, 7271, 8097, 8973,
  9898, 10875, 11903, 12985, 14122, 15315, 16564, 17873, 19242, 20672, 22166, 23726, 25353, 27048, 28815, 30656, 32572,
  34566, 36641, 38800, 41044, 43378, 45804, 48325, 50946, 53669, 56498, 59437, 62491, 65664, 68960, 72385, 75943, 79640,
  83482, 87475, 91624, 95937, 100421, 105082, 109930, 114971, 120215, 125671, 131348, 137256, 143407, 149811, 156481,
  163429, 170669, 178214, 186080, 194283, 202839, 211765, 221082, 230808, 240964, 251574, 262660, 274248, 286364,
  299037, 312297, 326175, 340705, 355924, 371870, 388582, 406106, 424486, 443772, 464016, 485274, 507604, 531071,
  555541, 581687,
])

export const job_max_level = 100

export const job_xp_for_level = (level: number): number | undefined => job_experience_curve[level]

/// Job level from total job xp — the same floor binary search the chain runs.
export function job_level_from_xp(xp: number): number {
  if (xp === 0) return 1
  if (xp >= job_experience_curve[job_max_level]!) return job_max_level
  let low = 1
  let high = job_max_level
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (job_experience_curve[mid]! <= xp) low = mid
    else high = mid - 1
  }
  return low
}

/// Resource tier (T1–T11) → the job level that unlocks it (job_xp.move tier_to_level).
export const tier_unlock_level = (tier: number): number => (tier <= 1 ? 1 : Math.min((tier - 1) * 10, job_max_level))

/// Minimum crafting job level for N distinct ingredient types. Mirrors crafting.move::required_level_for.
export const craft_required_level = (ingredient_count: number): number =>
  ingredient_count <= 2 ? 1 : Math.min(Math.ceil(((ingredient_count - 2) * 99) / 8) + 1, job_max_level)

const craft_xp_by_ingredient_count = Object.freeze([0, 0, 10, 25, 50, 100, 250, 500, 1000, 1000, 1000])

/// Base crafting XP from distinct ingredient slots. Mirrors crafting.move::craft_xp_for.
export const craft_xp_from_ingredient_count = (ingredient_count: number): number =>
  craft_xp_by_ingredient_count[Math.max(2, Math.min(Math.floor(ingredient_count), 10))]!
