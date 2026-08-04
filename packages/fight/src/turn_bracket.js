// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/turn_bracket.js — WHICH admitted rows may pace yet. A pure leaf of the pacing decision (fold.js
// `paced_wave_turns` is where the rows it releases become wave turns); it reads no state and owns no clock.
//
// ── #2209 · THE TURN BRACKET — one mob turn is one presentation slot, whatever the wire did to it ──────────────
// The indexer's fight stream sends ONE frame per stored event (`rpc/indexer/src/stream.rs` pump_fight — no
// batching, by contract), so the five rows the chain emitted as ONE transaction reach this door as five separate
// deliveries. Pacing per DELIVERY buys a 3s slot per ROW — nine seconds of wave for a three-second mob turn —
// and it orphans the rows that need a sibling to be read at all: a `Hit` alone in its batch has no Cast to
// attribute it to and lands on source `fight`.
//
// The grouping fact is on the ROWS, never on a clock. #1649's coalescing window GUESSED the batch with a 120ms
// timer; #2162 deleted it, correctly — a transport buffer ahead of the admission door is a second door, and
// every live coordinate must cross admission before any beat exists. So the grouping lives here, AFTER
// admission: the journal brackets a turn itself (`TurnStarted` opens it, `TurnEnded` — or a terminal
// Victory/Defeat — closes it). Rows inside an OPEN bracket admit exactly as before (the log, the cursor and
// `presented_version` all move with the live eye); only their PACING waits for the closing row, and then the
// whole turn paces as ONE batch — byte-identical to what the same rows delivered as one journal page produce.
// Nothing can strand a bracket: a row of a NEW version proves the old one can never grow, and flushes it.
const bare_kind = (row) =>
  String(row?.kind ?? '')
    .split('::')
    .pop()
const CLOSES_TURN = new Set(['TurnEnded', 'Victory', 'Defeat'])

/** Split an ordered run of admitted rows at the last turn bracket left OPEN: everything before it may pace now,
 *  the rest waits for its closing row. A run with no open bracket paces whole. Pure. */
export const split_open_turn = (rows) => {
  let open = -1
  rows.forEach((row, index) => {
    const kind = bare_kind(row)
    if (kind === 'TurnStarted') open = index
    else if (CLOSES_TURN.has(kind)) open = -1
  })
  return open === -1 ? { pace: rows, hold: [] } : { pace: rows.slice(0, open), hold: rows.slice(open) }
}

/**
 * THE HOLD DECISION — the newly admitted rows become the pacing SEGMENTS to mint now, each carrying the board
 * its beats resolve against, plus the bracket still open. A hold keeps the PRE-batch `draft` as its anchor so
 * that its flush reads cells, HP and traps off the board the eye showed when the turn began — which is exactly
 * what a one-page delivery of the same rows reads, and the whole reason the two deliveries converge.
 * @param {{ anchor: any, rows: Array<Record<string, any>> } | null} hold the bracket left open by the last input
 * @param {Array<Record<string, any>>} changed the newly-admitted authoritative actions
 * @param {any} draft the PRE-input state
 */
export const hold_open_turn = (hold, changed, draft) => {
  if (!changed.length) return { segments: [], hold }
  const carried = hold && Number(hold.rows[0]?.version) === Number(changed[0].version) ? hold : null
  const stale = hold && !carried ? [hold] : [] // a new version proves the old bracket can never grow: flush it
  const anchor = carried ? carried.anchor : { ...draft, wave_hold: null }
  const { pace, hold: open } = split_open_turn(carried ? [...carried.rows, ...changed] : changed)
  return {
    segments: [...stale, ...(pace.length ? [{ anchor, rows: pace }] : [])],
    hold: open.length ? { anchor, rows: open } : null,
  }
}
