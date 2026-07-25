// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOB STATS — the spawn-derivation math mirrored from aresrpg_foundation::mob_ai (`scaled_hp`). PURE, and the
// exact class of board_gen.js / turn_seed.js: a chain formula whose JS twin the client needs to derive the same
// numbers the chain will. The sim is its home — mob.move calls it at spawn, so hp/max_hp of every FightMob rides
// this arithmetic. Golden vectors: test/mob_stats_golden.test.js (copied from the Move tests).

/**
 * Integer hp scaling `base × (0.7 + 0.7×(lvl−min)/(max−min))` — mob_ai.move `scaled_hp`, verbatim. Degenerate
 * range (max == min) → base. The Move operator is u64 `/` (TRUNCATING) and u64 `−` (ABORTS on underflow), so
 * the mirror floors the quotient and refuses an out-of-band level rather than returning a nonsense value.
 * @param {number} base_hp
 * @param {number} min_level
 * @param {number} max_level
 * @param {number} level
 * @returns {number}
 */
export const scaled_hp = (base_hp, min_level, max_level, level) => {
  if (max_level === min_level) return base_hp
  if (level < min_level || max_level < min_level)
    throw new Error(
      `scaled_hp: u64 underflow — level ${level} below band [${min_level}, ${max_level}]`,
    )
  return Math.floor(
    (base_hp * 7 * (max_level - min_level + (level - min_level))) /
      (10 * (max_level - min_level)),
  )
}
