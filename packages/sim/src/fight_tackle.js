// TACKLE — the pure contest math of the ordinary-movement escape roll (the rule of record: extracted verbatim
// from fight_actions.js apply_move so the Move chain twin — aresrpg_foundation::spell_formula tackle_* +
// aresrpg_fight::tackle — pins the identical fraction/loss layer through shared golden vectors
// (test/vectors/tackle_golden.json). SPEC is silent on tackle and the 1.29 corpus carries only the dodge/lock
// stat-family enum (the reference-corpus stat-family enum), so THIS module is the formula's single home sim-side.
//
// Contest: dodge = floor(agility/10) + 2; per adjacent living enemy i, den_i = 2·(floor(agility_i/10) + 2),
// num_i = min(den_i, dodge); escape iff a roll in [0, Π den_i) lands below Π num_i (equal agility ⇒ 1/2,
// dodge ≥ 2·lock ⇒ certain). A failed escape denies the move and costs ceil(pool · failed_fraction) of BOTH
// pools — always ≥1 MP, which is what reprices the chain's turn-seed roll on every retry.

/**
 * One agility → contest bucket (both sides of the contest share the curve).
 * @param {number} agility
 * @returns {number}
 */
export const tackle_bucket = agility => Math.floor(agility / 10) + 2

/**
 * Combine every adjacent locker into ONE exact product fraction: escape iff `roll < num` for a roll in
 * `[0, den)`. No lockers ⇒ {1, 1} (the caller skips the contest entirely).
 * @param {number} runner_agility
 * @param {number[]} locker_agilities
 * @returns {{ num: number, den: number }}
 */
export const tackle_contest = (runner_agility, locker_agilities) => {
  const dodge = tackle_bucket(runner_agility)
  return locker_agilities.reduce(
    (acc, agility) => {
      const den_i = 2 * tackle_bucket(agility)
      return { num: acc.num * Math.min(den_i, dodge), den: acc.den * den_i }
    },
    { num: 1, den: 1 },
  )
}

/**
 * A failed escape's pool costs: `ceil(pool · (den − num) / den)` each — the failed FRACTION of both pools.
 * @param {number} ap current AP pool
 * @param {number} mp current MP pool
 * @param {number} num escape numerator
 * @param {number} den escape denominator
 * @returns {{ ap_lost: number, mp_lost: number }}
 */
export const tackle_losses = (ap, mp, num, den) => {
  const lost = den - num
  return {
    ap_lost: Math.ceil((ap * lost) / den),
    mp_lost: Math.ceil((mp * lost) / den),
  }
}

/**
 * Living enemies orthogonally adjacent to `cell` — the tackle zone scan. Death exempts a tackler;
 * INVISIBILITY does not (bodies stay physical, exactly as they keep blocking movement).
 * @param {import('./fight_state.js').FightState} state
 * @param {{ x: number, y: number }} cell the runner's cell
 * @param {string} entity_id the runner (decides which side is hostile)
 * @returns {import('./fight_state.js').FightEntity[]}
 */
export const find_adjacent_enemies = (state, cell, entity_id) => {
  const is_team0 = state.team0.some(e => e.id === entity_id)
  const enemies = is_team0 ? state.team1 : state.team0
  const adjacent = [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ]
  return enemies.filter(
    e =>
      e.health > 0 && adjacent.some(a => a.x === e.cell.x && a.y === e.cell.y),
  )
}
