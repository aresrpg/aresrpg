// Permissionless fight-sweep parity kernel.
//
// The Move entry can currently authenticate only the placement-expiry branch: exact PLACEMENT status, the
// immutable placement deadline reached, and zero ready seats. ACTIVE is deliberately never accepted here
// either; a caller-supplied reclaim duration would be forgeable until the chain stores authenticated policy.
// Successful sweep is auto-abandon for every seat: all HP becomes zero, outcome is DEFEAT, winner is absent.
// BRAND LAW: the prediction surface exposes only AresRPG status vocabulary and numeric timestamps.

export const SWEEP_PLACEMENT = 'PLACEMENT'
export const SWEEP_DEFEAT = 'DEFEAT'

/**
 * @typedef {object} FightSweepSeat
 * @property {string} id
 * @property {number} hp
 */

/**
 * @typedef {object} FightSweepState
 * @property {string} status
 * @property {number} placement_deadline_ms
 * @property {string[]} ready_seats
 * @property {FightSweepSeat[]} seats
 * @property {number|null} winner
 */

/**
 * @typedef {object} FightSweepOutcome
 * @property {string} seat_id
 * @property {string} outcome
 * @property {number} final_hp
 * @property {number} xp_share
 * @property {unknown[]} loot
 */

/**
 * @typedef {object} FightSweepEvent
 * @property {string} type
 * @property {string} [seat_id]
 * @property {number} [results]
 * @property {string} [outcome]
 * @property {number} [final_hp]
 * @property {number} [xp_share]
 * @property {unknown[]} [loot]
 */

/**
 * @typedef {object} FightSweepResult
 * @property {boolean} swept
 * @property {FightSweepState} state
 * @property {string[]} abandoned_seats
 * @property {string[]} released_seats
 * @property {FightSweepOutcome[]} outcomes
 * @property {FightSweepEvent[]} events
 */

/**
 * Exact twin of the Move entry's three conjunctive, fight-authenticated guards.
 * @param {FightSweepState} state
 * @param {number} now_ms
 */
export const can_sweep_fight = (state, now_ms) =>
  state.status === SWEEP_PLACEMENT &&
  now_ms >= state.placement_deadline_ms &&
  state.ready_seats.length === 0

/**
 * Pure auto-abandon + settlement projection. A failed guard is write-free and emits nothing.
 * @param {FightSweepState} state
 * @param {number} now_ms
 * @returns {FightSweepResult}
 */
export const sweep_fight = (state, now_ms) => {
  if (!can_sweep_fight(state, now_ms))
    return {
      swept: false,
      state,
      abandoned_seats: [],
      released_seats: [],
      outcomes: [],
      events: [],
    }
  const abandoned_seats = state.seats.map(seat => seat.id)
  const outcomes = state.seats.map(seat => ({
    seat_id: seat.id,
    outcome: SWEEP_DEFEAT,
    final_hp: 0,
    xp_share: 0,
    loot: [],
  }))
  return {
    swept: true,
    state: {
      ...state,
      status: SWEEP_DEFEAT,
      winner: null,
      seats: state.seats.map(seat => ({ ...seat, hp: 0 })),
    },
    abandoned_seats,
    released_seats: abandoned_seats,
    outcomes,
    events: [
      ...abandoned_seats.map(seat_id => ({ type: 'Abandoned', seat_id })),
      { type: 'Defeat' },
      { type: 'Swept' },
      ...outcomes.map(outcome => ({ type: 'ResultMinted', ...outcome })),
      { type: 'Settled', results: outcomes.length },
    ],
  }
}
