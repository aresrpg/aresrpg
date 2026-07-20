// FIGHT ENGINE · fight-end machine (D153 — the canonical fight-END authority).
//
// THE BUG THIS KILLS: a NON-TERMINAL room clear (rooms remaining) had no single fold that remembered "this
// room's victory is resolved and we are PARKED until the player clicks the next cluster". So the ~4s poll's
// respawn of the next room's fight slice re-ranked the board ACTIVE (phase.js rank_of_slice) at the SAME
// dungeon id → three independent board-mount consumers (use_fight_phase → the React HUD, voxel_fight_adapter,
// DungeonBoard) each re-derived derive_phase and re-mounted a board WITHOUT a player gesture — the
// "auto-started the next room" ghost — while the same respawn wiped the reward recap (sync_engine first_sight
// nulls room_recap) — the "no result card" symptom. Both are one root: fight-END had no memory. This module IS that
// memory, and every consumer defers to it (phase.js parks the mount; start_next_room refuses off-park).
//
// IT IS A PURE FOLD, exactly like phase.js / chain_frame.js (the house pattern): a `(state, event) → state`
// reducer over an EXPLICIT event stream, plus a tiny module-scope current-state cell keyed by dungeon id (the
// D81 latch's big brother — same keying, same reset-on-teardown discipline, same _test visibility). It carries
// NOTHING derivable from the live reads; it carries the ONE fact a per-tick derivation cannot: "we already
// resolved a victory for THIS room and are awaiting the advance gesture". The store's SINGLE fold point
// (dungeon_store.refresh/sync_engine) is the only driver — the same place mark_active_seat is called.
//
// THE STATES (a room's fight-end life, forward-only within a room):
//   IDLE              no resolved victory in flight — a live/absent fight, nothing to park. derive_phase runs raw.
//   VICTORY_RESOLVED  the chain reported a victory (ROOM_CLEARED non-terminal, or WON/FAILED terminal). The card/
//                     recap surface is owed but not yet shown.
//   CARD_SHOWN        the surface is up (RewardRecap for non-terminal · FightResult/FightSummary for terminal).
//   CLAIMED           the per-room / terminal claim tx settled (rewards granted). For TERMINAL this is the end of
//                     the road (EXIT tears the session down). For NON-TERMINAL we fall through to…
//   AWAIT_PLAYER_ADVANCE  (non-terminal only) PARKED on the plane: the next room's board must NOT mount and
//                     start_next_room MUST refuse until the player fires the explicit engage gesture (advance).
//
// TRANSITION INERTIA (unit-proven): a ROSTER/SUI repaint (load_roster / sui_data / a plain refresh)
// dispatches NONE of this module's events, so it can NEVER move the machine. The ONLY movers are the five
// explicit events below. Feeding a barrage of unrelated store churn is a no-op by construction.

// ── the states. String constants (a typo is a ReferenceError, never a silently-false compare — phase.js rule). ──
import { game_log } from '../core/log.js'

export const FE = /** @type {const} */ ({
  IDLE: 'IDLE',
  VICTORY_RESOLVED: 'VICTORY_RESOLVED',
  CARD_SHOWN: 'CARD_SHOWN',
  CLAIMED: 'CLAIMED',
  AWAIT_PLAYER_ADVANCE: 'AWAIT_PLAYER_ADVANCE',
})

/** @typedef {'IDLE'|'VICTORY_RESOLVED'|'CARD_SHOWN'|'CLAIMED'|'AWAIT_PLAYER_ADVANCE'} FeState */
/** @typedef {'terminal'|'non_terminal'} Kind — a terminal end (WON/FAILED) ends the run; non-terminal parks. */

/**
 * @typedef {Object} FeSnapshot  the machine's full current state (all callers read THIS, never a raw status).
 * @property {string|null} dungeon_id  the dungeon this state belongs to (keying — a new dungeon starts clean).
 * @property {FeState} state
 * @property {Kind|null} kind          set at VICTORY_RESOLVED; drives whether CLAIMED parks (non-terminal) or ends.
 * @property {number|null} room        the room index whose victory we resolved (the recap/claim room; null when IDLE).
 */

// ── the ONE cross-call cell (tiny + explicit, keyed by dungeon id — mirrors phase.js's active_seat latch). ──
/** @type {FeSnapshot} */
let cur = { dungeon_id: null, state: FE.IDLE, kind: null, room: null }

/** The IDLE snapshot for a given dungeon id (or a clean-slate null-id IDLE). @param {string|null} id */
const idle_for = (id) => ({ dungeon_id: id ?? null, state: FE.IDLE, kind: null, room: null })

// ── THE PURE FOLD ────────────────────────────────────────────────────────────────────────────────────────────
// `fold(state, event) → state`. No side effects, no store reads. Every transition is explicit; anything not
// named here is a NO-OP that returns the SAME state (the transition-inertia guarantee lives right here).

/**
 * @typedef {Object} FeEvent
 * @property {'observe'|'card_shown'|'claimed'|'advance'|'reset'} type
 * @property {string} [dungeon_id]  required for `observe` (the dungeon whose victory we saw).
 * @property {Kind}   [kind]        for `observe`: 'terminal' | 'non_terminal'.
 * @property {number} [room]        for `observe`: the room index the victory resolved for.
 */

/**
 * The reducer. Kept exported + pure so the fold is unit-testable in isolation (no module cell, no store).
 * @param {FeSnapshot} state @param {FeEvent} event @returns {FeSnapshot}
 */
export function fold(state, event) {
  switch (event?.type) {
    // A fresh session teardown (abandon / claim-continue / burn / reset) — clear to IDLE. Idempotent.
    case 'reset':
      return idle_for(null)

    // The chain reported a victory for a room. This is the ONLY event that can START a fight-end cycle, and it
    // is EDGE-triggered by the caller (the store fires it once per distinct resolved room — see note_victory),
    // so a per-poll re-observation of the SAME resolved room does NOT reset a cycle already in flight.
    case 'observe': {
      const id = event.dungeon_id ?? null
      const room = event.room ?? null
      const kind = event.kind ?? 'non_terminal'
      // A DIFFERENT dungeon, or a DIFFERENT room than the one we're mid-cycle on ⇒ a genuinely new victory:
      // start a fresh cycle at VICTORY_RESOLVED. (The caller's edge-guard makes this the common single fire.)
      if (state.dungeon_id !== id || state.room !== room) {
        return { dungeon_id: id, state: FE.VICTORY_RESOLVED, kind, room }
      }
      // SAME dungeon + SAME room already in a cycle ⇒ inert (never re-arm a cycle a re-poll re-sees). Refresh the
      // kind in the (impossible-in-practice) case the same room escalated non_terminal→terminal without a reset.
      return kind !== state.kind ? { ...state, kind } : state
    }

    // The surface (recap / result card) mounted. Only meaningful once a victory is resolved.
    case 'card_shown':
      return state.state === FE.VICTORY_RESOLVED ? { ...state, state: FE.CARD_SHOWN } : state

    // The per-room / terminal claim tx settled. Advances VICTORY_RESOLVED or CARD_SHOWN → CLAIMED (the card can
    // land before OR after the silent background claim — both orders reach CLAIMED).
    case 'claimed':
      if (state.state === FE.VICTORY_RESOLVED || state.state === FE.CARD_SHOWN) {
        // TERMINAL ends the road here (EXIT tears the session down → a `reset` follows). NON-TERMINAL parks on
        // the plane awaiting the player's advance gesture.
        return { ...state, state: FE.CLAIMED } // both kinds land CLAIMED; the non-terminal PARK promotion is the driver's (note_claimed)
      }
      return state

    // The player fired the explicit advance gesture (the next-cluster engage / console Next-Room). ONLY legal
    // from the parked post-claim state; unparks to IDLE so the next room's fight can mount + start normally.
    // (Deliberately permissive on the exact pre-state so a claim that lands a beat late — CARD_SHOWN not yet
    //  CLAIMED — still lets a deliberate advance through; start_next_room's own claim-before-advance is idempotent.)
    case 'advance':
      if (state.state === FE.AWAIT_PLAYER_ADVANCE || state.state === FE.CLAIMED || state.state === FE.CARD_SHOWN) {
        return idle_for(state.dungeon_id)
      }
      return state

    default:
      return state // unknown / undefined event ⇒ inert (transition inertia).
  }
}

// ── the CLAIMED→AWAIT_PLAYER_ADVANCE settle. `claimed` lands the machine at CLAIMED; for a NON-TERMINAL victory
//    that immediately means "parked" — expose it as its own state so consumers read one unambiguous parked flag.
//    We keep the fold's CLAIMED (both kinds) and derive the park in the driver so the fold stays a clean reducer.

// ── DRIVER API (the store's single fold point calls these; they own the module cell + the loud log) ───────────

/**
 * EDGE-fire an `observe` for a resolved room, idempotently. Called every poll from sync_engine/refresh with the
 * live status; it fires the fold's `observe` ONLY when this is a NEW (dungeon,room) victory (or a kind change),
 * so a 4s re-poll of the same ROOM_CLEARED never re-arms a cycle. This is the transition-inertia seam for the
 * hot path: repeated identical reads collapse to nothing.
 * @param {string} dungeon_id @param {number} room @param {Kind} kind
 */
export function note_victory(dungeon_id, room, kind) {
  const next = fold(cur, { type: 'observe', dungeon_id, room, kind })
  if (next !== cur) {
    game_log('fight-end', 'victory resolved', { dungeon: short(dungeon_id), room, kind, state: next.state })
    cur = next
  }
}

/** The surface (recap / result card) has mounted for the resolved room. @returns {FeState} */
export function note_card_shown() {
  cur = fold(cur, { type: 'card_shown' })
  return cur.state
}

/**
 * The per-room / terminal claim settled. For a NON-TERMINAL victory this transitions straight to the PARKED
 * state (AWAIT_PLAYER_ADVANCE) so the plane is quiet until the player advances; TERMINAL lands at CLAIMED
 * (EXIT owns the teardown that follows). @returns {FeState}
 */
export function note_claimed() {
  const claimed = fold(cur, { type: 'claimed' })
  // Non-terminal: CLAIMED is the moment we start parking — promote to AWAIT_PLAYER_ADVANCE (the fold keeps CLAIMED
  // for both kinds so it stays a pure reducer; the park is the driver's single explicit promotion).
  if (claimed.state === FE.CLAIMED && claimed.kind === 'non_terminal') {
    cur = { ...claimed, state: FE.AWAIT_PLAYER_ADVANCE }
    game_log('fight-end', 'room claimed — PARKED awaiting player advance', {
      dungeon: short(cur.dungeon_id),
      room: cur.room,
    })
  } else {
    cur = claimed
    if (claimed.state === FE.CLAIMED) game_log('fight-end', 'terminal claimed', { dungeon: short(cur.dungeon_id) })
  }
  return cur.state
}

/**
 * The player fired the explicit advance gesture. Returns TRUE iff the machine was actually parked (or claimed/
 * card-shown) and is now cleared to advance — start_next_room reads this as its gate. A FALSE return means "not
 * parked" (nothing to advance / mid-claim) and the caller must refuse.
 * @returns {boolean}
 */
export function note_player_advance() {
  const before = cur.state
  cur = fold(cur, { type: 'advance' })
  const advanced = cur.state === FE.IDLE && before !== FE.IDLE
  if (advanced) game_log('fight-end', 'player advanced — unparked to IDLE')
  return advanced
}

/** Session teardown (abandon / claim-continue / burn / reset_local). Clears to IDLE. Mirrors session_reset(). */
export function fight_end_reset() {
  cur = idle_for(null)
}

// ── READS (every consumer asks the machine, never a raw status) ──────────────────────────────────────────────

/** The full current snapshot (read-only copy). @returns {FeSnapshot} */
export function fight_end_state() {
  return { ...cur }
}

/**
 * Is a fight-end cycle PARKED for THIS dungeon (victory resolved + claimed, awaiting the player's advance)?
 * This is the gate phase.js reads to FORCE ROAM (no ghost board mount) and start_next_room reads to allow the
 * advance. A different/absent dungeon id ⇒ false (never leak a park across dungeons).
 * @param {string|null|undefined} dungeon_id @returns {boolean}
 */
export function is_awaiting_advance(dungeon_id) {
  return !!dungeon_id && cur.dungeon_id === dungeon_id && cur.state === FE.AWAIT_PLAYER_ADVANCE
}

/**
 * Is a fight-end cycle IN FLIGHT for THIS dungeon (a resolved victory whose card/claim/park hasn't completed a
 * fresh room yet)? True for VICTORY_RESOLVED, CARD_SHOWN, CLAIMED, AWAIT_PLAYER_ADVANCE. phase.js reads this to
 * hold the mount authority in ROAM across the WHOLE fight-end window (not just the parked tail), so a mid-window
 * slice respawn can't flicker a ghost board. @param {string|null|undefined} dungeon_id @returns {boolean}
 */
export function is_ending(dungeon_id) {
  return !!dungeon_id && cur.dungeon_id === dungeon_id && cur.state !== FE.IDLE
}

/** Test-only reset + visibility (mirrors phase.js _active_seat / _reset_warn_dedup). */
export function _fe_reset_for_test() {
  cur = idle_for(null)
}

/** short 0x id for logs (matches phase.js's slice(0,10)). @param {string|null} id */
const short = (id) => (id ? String(id).slice(0, 10) : null)
