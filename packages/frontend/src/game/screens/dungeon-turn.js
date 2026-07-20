// board #13 (rich-board wave) — the WIRING between a click on the rich 3D board (fight-overlay.js, imperative
// Three code) and DungeonBoard.jsx's existing on-chain turn-draft logic (React). DungeonBoard.jsx keeps 100%
// of the game rules (a cumulative MOVE PATH + ≤1 cast, reachable/castable gates mirroring dungeon_turn.move exactly) — this
// tiny store is ONLY a relay + a readback so fight-overlay.js can highlight the current picks on the board. No
// game rules live here; nothing here calls the chain.

import { create } from 'zustand'

/** @typedef {{ x: number, y: number }} LocalCell */

const EMPTY_CHARACTER_CAST_CLOCK = Object.freeze({ last_cast_turn: Object.freeze({}) })

/** Character-keyed cooldown view; the stable empty value is safe in Zustand/React selectors. */
export function character_cast_clock(state, character_id) {
  return (character_id && state.character_cast_clocks?.[character_id]) ?? EMPTY_CHARACTER_CAST_CLOCK
}

export const use_dungeon_turn = create((set) => ({
  // raw relay: bumped every rich-board click (a repeat click on the SAME cell must still fire the effect, so
  // React keys off `clicked_seq`, never cell identity/reference equality).
  /** @type {number | null} arena-local ENCODED cell (fight-los.js `encode`), matching DungeonBoard's own on-chain action_targets shape */
  clicked_cell: null,
  /** true when the click is a CAST intent (a spell card dropped on the board) — DungeonBoard then only
   * considers the castable branch (a spell drop on a non-mob cell is a no-op, never a stray move pick). A
   * plain board click leaves this false → the move-or-cast decision runs as before. */
  clicked_cast: false,
  clicked_seq: 0,
  /** @param {number} cell @param {boolean} [cast_only] */
  emit_click(cell, cast_only = false) {
    set((s) => ({ clicked_cell: cell, clicked_cast: cast_only, clicked_seq: s.clicked_seq + 1 }))
  },

  // resulting picks — written by DungeonBoard.jsx's on_cell_click, read by fight-overlay.js to draw the pick
  // highlight back on the rich board (one source of truth; the input decision and its 3D readback never drift).
  // D254 CUMULATIVE MOVE (1.29): a turn may draft MANY moves, each a SEGMENT the contract charges its own
  // bfs_path_cost for (commit_turn_core loops the action array; apply_move spends MP per move from the CURRENT
  // cell). So the move draft is a PATH of step cells in click order — the SINGLE source of truth. `move_target`
  // is a DERIVED mirror = last(move_path) ?? null (the post-move cell the cast anchors at + the pick readback +
  // the peer stream), rewritten by every mutator below, never set on its own.
  /** @type {number[]} drafted move segments' end cells, in click order (source of truth) */
  move_path: [],
  /** @type {number | null} DERIVED last(move_path) — cast anchor / pick readback / fight-stream preview */
  move_target: null,
  // S-12 §17.27 STACKED CASTS (repeated weapon-attack casts within a turn): a turn drafts MANY
  // cast/weapon actions — the chain's commit_turn ships one act_weapon/act_cast per entry (AP-limited on-chain),
  // so the draft is a QUEUE, EXACTLY like move_path. Each entry pins its own spell_key (the weapon sentinel or a
  // spell name_key) so a disarm/re-arm between picks can never swap what a queued strike commits. `cast_target`
  // is the DERIVED last-cell mirror (fight-stream peer preview + the D99 cast_first check + legacy readback).
  /** @type {{ cell: number, spell_key: string | null }[]} drafted cast/weapon actions in click order (source of truth) */
  cast_path: [],
  /** @type {number | null} DERIVED last(cast_path).cell — pick readback / fight-stream preview */
  cast_target: null,
  /** D99: true when the FIRST cast was drafted BEFORE the first move — the commit batch preserves that order. */
  cast_first: false,
  /** Draft one more cast/weapon action (stacks under the AP budget the board enforces). @param {{ cell: number, spell_key: string | null }} entry */
  append_cast_step(entry) {
    set((s) => ({
      cast_path: [...s.cast_path, entry],
      cast_target: entry.cell,
      cast_first: s.cast_path.length === 0 && s.move_path.length === 0 ? true : s.cast_first,
    }))
  },
  /** Undo the last drafted cast/weapon action. */
  pop_cast_step() {
    set((s) => {
      const cast_path = s.cast_path.slice(0, -1)
      return {
        cast_path,
        cast_target: cast_path.length ? cast_path[cast_path.length - 1].cell : null,
        cast_first: cast_path.length ? s.cast_first : false,
      }
    })
  },
  /** Draft one more move SEGMENT (a step from the current last cell). @param {number} cell */
  append_move_step(cell) {
    // D99: a cast drafted before the FIRST move commits as [cast, …moves] (validated from the pre-move cell).
    set((s) => ({
      move_path: [...s.move_path, cell],
      move_target: cell,
      cast_first: s.move_path.length === 0 && s.cast_target != null ? true : s.cast_first,
    }))
  },
  /** Undo the last drafted move step. */
  pop_move_step() {
    set((s) => {
      const move_path = s.move_path.slice(0, -1)
      return { move_path, move_target: move_path.length ? move_path[move_path.length - 1] : null }
    })
  },
  /** COMPAT (fight-stream readback + the D36 store test): replace the whole move draft with a single step, or
   *  clear it (null). The board drafts via append/pop; this keeps the pre-D254 single-move callers working. */
  set_move_target(move_target) {
    set((s) => ({
      move_path: move_target == null ? [] : [move_target],
      move_target,
      cast_first: move_target != null && s.cast_target != null && s.move_path.length === 0 ? true : s.cast_first,
    }))
  },
  /** COMPAT single-cast setter (fight-stream test + the D36 store test + a null clear): mirrors into the cast_path
   *  queue so the queue stays the one source of truth. The board drafts via append_cast_step / pop_cast_step. */
  set_cast_target(cast_target) {
    set((s) => ({
      cast_path: cast_target == null ? [] : [{ cell: cast_target, spell_key: null }],
      cast_target,
      cast_first: cast_target != null && s.move_path.length === 0 ? true : cast_target == null ? false : s.cast_first,
    }))
  },
  clear_picks() {
    set({ move_path: [], move_target: null, cast_path: [], cast_target: null, placement_pick: null, cast_first: false })
  },

  // D66 PLACEMENT PREDICT-FIRST (no confirmation wait): a click on a legal start cell during PLACEMENT is
  // a LOCAL optimistic pick ONLY (zero tx) — the player's fighter renders on the picked cell instantly and can
  // re-pick freely. The single `place_at` tx fires only when they press READY (DungeonBoard's placement chrome).
  // `placement_pick` = the currently-picked arena-local ENCODED cell (fight-los `encode`), null before any pick.
  /** @type {number | null} */
  placement_pick: null,
  /** @param {number | null} placement_pick */
  set_placement_pick(placement_pick) {
    set({ placement_pick })
  },

  // D242 rider: a wrong placement click (off the start zone or on a taken cell) bumps this counter → the placement
  // banner reacts (shake + sharper hint). A "clicking doesn't move" report was a SILENT no-op click in placement.
  placement_nudge: 0,
  nudge_placement() {
    set((s) => ({ placement_nudge: s.placement_nudge + 1 }))
  },

  // FIX 4 COOLDOWN RECORD (the per-spell last-cast half). The seat-turn counter `my_turn_no` moved to the fight
  // CORE (fold-derived, DEADLINE-INDEPENDENT — a starved chain clock can no longer freeze it, register #34); this
  // store keeps ONLY last_cast_turn (spell name_key → the turn it cast), which draft-budget.js on_cooldown/
  // cooldown_left read against the core's my_turn_no. DungeonBoard stays the SOLE WRITER (stamps a committed cast,
  // resets on a fresh fight_id); DeckCluster only READS, so every socket renders live cooldown, not just refuses.
  /** @type {Record<string, number>} spell name_key → the turn it was last committed-cast on */
  last_cast_turn: {},
  /** @param {Record<string, number>} cast_turns spell_key → turn pairs to merge in */
  record_cast_turns(cast_turns) {
    set((s) => ({ last_cast_turn: { ...s.last_cast_turn, ...cast_turns } }))
  },
  /** Reset the per-spell last-cast record — DungeonBoard calls this once per fresh Fight (a new room mints a new
   *  fight_id). The seat-turn counter is NOT here anymore: it lives in the fight core and zeroes on session init. */
  reset_cast_clock() {
    set({ last_cast_turn: {} })
  },

  // Multi-character control keeps the same last-cast record per acting character. The legacy singleton above stays
  // intact for older single-character callers; combat HUD/input use this character-keyed lane.
  /** @type {Record<string, { last_cast_turn: Record<string, number> }>} */
  character_cast_clocks: {},
  /** @param {string} character_id @param {Record<string, number>} cast_turns */
  record_character_cast_turns(character_id, cast_turns) {
    if (!character_id) return
    set((s) => {
      const clock = character_cast_clock(s, character_id)
      return {
        character_cast_clocks: {
          ...s.character_cast_clocks,
          [character_id]: {
            ...clock,
            last_cast_turn: { ...clock.last_cast_turn, ...cast_turns },
          },
        },
      }
    })
  },
  reset_character_cast_clocks() {
    set({ character_cast_clocks: {} })
  },
}))
