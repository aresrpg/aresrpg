// INTERLEAVE — §17.28 GLOBAL turn order. A byte-for-byte mirror of aresrpg_fight::interleave.move (S-16
// parity). Both sides weave into ONE deterministic sequence that alternates as evenly as unequal team sizes
// allow; join/spawn order fixes the order WITHIN a side. Pure — no RNG, no clock; same inputs → same queue.
//
// The rule at each slot: emit from A iff A is no further along its share than B at the SLOT MIDPOINT, i.e.
// (2·ia+1)·|b| ≤ (2·ib+1)·|a| (integer cross-multiply of the midpoint fractions). Equality → A (players-first
// tie-break). Once one side is exhausted the other drains in order.

/**
 * One turn-queue slot: a player SEAT (`is_mob=false`, `idx`=seat) or a MOB (`is_mob=true`, `idx`=mob index).
 * @typedef {{ is_mob: boolean, idx: number }} Actor
 */

/** @param {number} seat @returns {Actor} */
export const new_player_actor = seat => ({ is_mob: false, idx: seat })
/** @param {number} idx @returns {Actor} */
export const new_mob_actor = idx => ({ is_mob: true, idx })
/** @param {Actor} a */
export const actor_is_mob = a => a.is_mob
/** @param {Actor} a */
export const actor_idx = a => a.idx

/**
 * Weave `side_a` (players, join order) and `side_b` (mobs, spawn order) into the global turn queue. Pure + total.
 * @param {Actor[]} side_a
 * @param {Actor[]} side_b
 * @returns {Actor[]} one queue of length |a|+|b|
 */
export const order = (side_a, side_b) => {
  const a = side_a.length
  const b = side_b.length
  const out = []
  let ia = 0
  let ib = 0
  while (ia < a || ib < b) {
    const take_a =
      ia >= a ? false : ib >= b ? true : (2 * ia + 1) * b <= (2 * ib + 1) * a
    if (take_a) {
      out.push(side_a[ia])
      ia++
    } else {
      out.push(side_b[ib])
      ib++
    }
  }
  return out
}
