// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Retro 1.29 XP curve — copied from plugins/core/.../Experience.java
// Index 0 unused, levels 1–200

import { MAX_LEVEL } from '@aresrpg/sdk/experience'

const XP_CURVE = [
  0, 0, 110, 650, 1_500, 2_800, 4_800, 7_300, 10_500, 14_500, 19_200, 25_200, 32_600, 41_000, 50_500, 61_000, 75_000,
  91_000, 115_000, 142_000, 171_000, 202_000, 235_000, 270_000, 310_000, 353_000, 398_500, 448_000, 503_000, 561_000,
  621_600, 687_000, 755_000, 829_000, 910_000, 1_000_000, 1_100_000, 1_240_000, 1_400_000, 1_580_000, 1_780_000,
  2_000_000, 2_250_000, 2_530_000, 2_850_000, 3_200_000, 3_570_000, 3_960_000, 4_400_000, 4_860_000, 5_350_000,
  5_860_000, 6_390_000, 6_950_000, 7_530_000, 8_130_000, 8_765_100, 9_420_000, 10_150_000, 10_894_000, 11_655_000,
  12_450_000, 13_278_000, 14_138_000, 15_171_000, 16_251_000, 17_377_000, 18_553_000, 19_778_000, 21_055_000,
  22_385_000, 23_769_000, 25_209_000, 26_707_000, 28_264_000, 29_882_000, 31_563_000, 33_307_000, 35_118_000,
  36_997_000, 38_945_000, 40_965_000, 43_059_000, 45_229_000, 47_476_000, 49_803_000, 52_211_000, 54_704_000,
  57_284_000, 59_952_000, 62_712_000, 65_565_000, 68_514_000, 71_561_000, 74_710_000, 77_963_000, 81_323_000,
  84_792_000, 88_374_000, 92_071_000, 95_886_000, 99_823_000, 103_885_000, 108_075_000, 112_396_000, 116_853_000,
  121_447_000, 126_184_000, 131_066_000, 136_098_000, 141_283_000, 146_626_000, 152_130_000, 157_800_000, 163_640_000,
  169_655_000, 175_848_000, 182_225_000, 188_791_000, 195_550_000, 202_507_000, 209_667_000, 217_037_000, 224_620_000,
  232_424_000, 240_452_000, 248_712_000, 257_209_000, 265_949_000, 274_939_000, 284_186_000, 293_694_000, 303_473_000,
  313_527_000, 323_866_000, 334_495_000, 345_423_000, 356_657_000, 368_206_000, 380_076_000, 392_278_000, 404_818_000,
  417_706_000, 430_952_000, 444_564_000, 458_551_000, 472_924_000, 487_693_000, 502_867_000, 518_458_000, 534_476_000,
  550_933_000, 567_839_000, 585_206_000, 603_047_000, 621_374_000, 640_199_000, 659_536_000, 679_398_000, 699_798_000,
  720_751_000, 742_272_000, 764_374_000, 787_074_000, 810_387_000, 834_329_000, 858_917_000, 884_167_000, 910_098_000,
  936_727_000, 964_073_000, 992_154_000, 1_020_991_000, 1_050_603_000, 1_081_010_000, 1_112_235_000, 1_144_298_000,
  1_177_222_000, 1_211_030_000, 1_245_745_000, 1_281_393_000, 1_317_997_000, 1_355_584_000, 1_404_179_000,
  1_463_811_000, 1_534_506_000, 1_616_294_000, 1_709_205_000, 1_813_267_000, 1_928_513_000, 2_054_975_000,
  2_192_686_000, 2_341_679_000, 2_501_990_000, 2_673_655_000, 2_856_710_000, 3_051_194_000, 3_257_146_000,
  3_474_606_000, 3_703_616_000, 7_407_232_000,
]

function get_level_capped(xp: number, max_level: number): number {
  if (xp <= 0) return 1
  if (xp >= XP_CURVE[max_level]) return max_level

  let low = 1
  let high = max_level

  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (XP_CURVE[mid] <= xp) low = mid
    else high = mid - 1
  }

  return low
}

function get_progress_capped(xp: number, max_level: number) {
  const level = get_level_capped(xp, max_level)

  if (level >= max_level) return { level, current_xp: 0, needed_xp: 0, percent: 100 }

  const current_level_xp = XP_CURVE[level]
  const next_level_xp = XP_CURVE[level + 1]
  const current_xp = xp - current_level_xp
  const needed_xp = next_level_xp - current_level_xp
  const percent = needed_xp > 0 ? Math.floor((current_xp * 100) / needed_xp) : 0

  return { level, current_xp, needed_xp, percent }
}

export const get_level = (xp: number) => get_level_capped(xp, MAX_LEVEL)
export const get_level_progress = (xp: number) => get_progress_capped(xp, MAX_LEVEL)

// Retro 1.29 job XP table — separate from character XP curve
// Index 0 = level 1 (0 XP), index 99 = level 100 (581687 XP)
const JOB_XP_TABLE = [
  0, 50, 140, 271, 441, 653, 905, 1199, 1534, 1911, 2330, 2792, 3297, 3846, 4439, 5078, 5762, 6493, 7271, 8097, 8973,
  9898, 10875, 11903, 12985, 14122, 15315, 16564, 17873, 19242, 20672, 22166, 23726, 25353, 27048, 28815, 30656, 32572,
  34566, 36641, 38800, 41044, 43378, 45804, 48325, 50946, 53669, 56498, 59437, 62491, 65664, 68960, 72385, 75943, 79640,
  83482, 87475, 91624, 95937, 100421, 105082, 109930, 114971, 120215, 125671, 131348, 137256, 143407, 149811, 156481,
  163429, 170669, 178214, 186080, 194283, 202839, 211765, 221082, 230808, 240964, 251574, 262660, 274248, 286364,
  299037, 312297, 326175, 340705, 355924, 371870, 388582, 406106, 424486, 443772, 464016, 485274, 507604, 531071,
  555541, 581687,
]
const JOB_MAX_LEVEL = 100

function get_job_level_from_table(xp: number): number {
  if (xp <= 0) return 1
  for (let i = JOB_XP_TABLE.length - 1; i >= 0; i--) {
    if (xp >= JOB_XP_TABLE[i]) return i + 1
  }
  return 1
}

function get_job_progress_from_table(xp: number) {
  const level = get_job_level_from_table(xp)
  if (level >= JOB_MAX_LEVEL) return { level, current_xp: 0, needed_xp: 0, percent: 100 }
  const current_level_xp = JOB_XP_TABLE[level - 1]
  const next_level_xp = JOB_XP_TABLE[level]
  const current_xp = xp - current_level_xp
  const needed_xp = next_level_xp - current_level_xp
  const percent = needed_xp > 0 ? Math.floor((current_xp * 100) / needed_xp) : 0
  return { level, current_xp, needed_xp, percent }
}

export const get_job_level = (xp: number) => get_job_level_from_table(xp)
export const get_job_progress = (xp: number) => get_job_progress_from_table(xp)
