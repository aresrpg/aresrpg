// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/coop.js — THE COOP VERDICT BLOCK (#1184). Seven rows, one per thing a two-account fight is supposed to
// do, each read off the two seats' own folded state rather than off pixels.
//
// WHY A SEPARATE BLOCK. `assert_turn` grades ONE seat's turn and `assert_cross_client` grades ONE observation;
// neither can say anything about the RUN — that the joiner ever got seated, that both seats placed, that the
// turn order carried both of them every round, that both folds reached the same settlement. Those are run-level
// facts, and a coop drive that never checked them can report a green sheet on a fight only one player was
// actually in (measured: the reported breakage was exactly there).
//
// SKIP ≠ PASS, and a row this surface cannot see says so. A row whose subject is structurally invisible from a
// headless fold is marked `gated` with the reason — it counts as neither a pass nor a failure, and `summarise`
// reports the gated count separately so a sheet can never launder an absent check into a green one.

import { row } from './assert.js'

/** A row the headless surface cannot see. Never a pass, never a failure — an honest, counted hole. */
const gated_row = (check, why) => ({ ...row(0, null, check, 'observable evidence', why, false), gated: true })

/** ① THE JOINER IS REALLY IN THE FIGHT — the creator's own board lists a fighter for every joined seat. */
export const assert_joiner_seated = ({ seats = [], creator, placement_read }) => {
  const joiners = seats.filter((seat) => seat.name !== creator)
  if (!placement_read?.ok)
    return [
      row(
        0,
        null,
        'the creator can read the fight the joiners landed in',
        'a readable board',
        placement_read?.error ?? 'no read',
        false,
        'every seating fact below is unreadable without it'
      ),
    ]
  const ids = new Set((placement_read.fighters ?? []).map((f) => String(f.id)))
  return joiners.map((seat) =>
    row(
      0,
      null,
      `the creator's board includes the joined seat ${seat.name}`,
      `a fighter with id ${String(seat.character_id).slice(0, 12)}…`,
      ids.has(String(seat.character_id))
        ? 'present'
        : `absent — the board holds ${ids.size} fighter(s): ${[...ids].map((id) => id.slice(0, 8)).join(', ')}`,
      ids.has(String(seat.character_id)),
      'a join that lands on chain but never reaches the creator’s placement view is the reported breakage'
    )
  )
}

/** ② EVERY SEAT COMMITTED A START CELL — `turns::place` is place-and-ready, so a missing one is a dead fight. */
export const assert_placements = ({ seats = [], placements = [] }) => {
  const by_seat = new Map(placements.map((p) => [p.seat, p]))
  return seats.map((seat) => {
    const placed = by_seat.get(seat.name)
    return row(
      0,
      null,
      `seat ${seat.name} committed its start cell`,
      'a placed-and-ready seat',
      placed?.ok ? `${placed.cell.x},${placed.cell.y}` : (placed?.error ?? 'never placed'),
      !!placed?.ok,
      'the LAST ready starts the fight — a seat that never places holds the whole board in placement'
    )
  })
}

/** ③ THE TURN CARDS CARRY BOTH SEATS, every round the run observed. */
export const assert_turn_order = ({ seats = [], turn_orders = [] }) => {
  if (!turn_orders.length)
    return [
      row(
        0,
        null,
        'the run observed at least one turn order',
        '≥ 1 round with a published turn order',
        '0 — no turn was ever read with an order on it',
        false
      ),
    ]
  const missing = turn_orders.flatMap(({ turn, order }) => {
    const ids = new Set((order ?? []).map(String))
    return seats.filter((seat) => !ids.has(String(seat.character_id))).map((seat) => `round ${turn}: ${seat.name}`)
  })
  return [
    row(
      0,
      null,
      'the turn order carries every seat, every round',
      `${seats.length} seat(s) in each of ${turn_orders.length} observed round(s)`,
      missing.length ? missing.join(' · ') : `all present across ${turn_orders.length} round(s)`,
      missing.length === 0,
      'a seat dropped from the order is a player who silently never gets to act'
    ),
  ]
}

/** ⑤ A REMOTE MOVE IS VISIBLE — a seat's committed walk lands on the other seat's board at the committed cell. */
export const assert_move_proofs = (move_proofs) => [
  row(
    0,
    null,
    'the run landed at least one cross-client MOVE proof',
    '≥ 1 committed move folded to the same cell on the other client',
    move_proofs || '0 — no seat committed a move while another seat was watching',
    move_proofs >= 1,
    'cross-client — the committed cell, never the observer’s presented one'
  ),
]

/** ⑥ BOTH FOLDS REACH THE SAME SETTLEMENT — a result only one client sees is the reported breakage's endgame. */
export const assert_settlement_seen = ({ seats = [], finals = [] }) => {
  const by_seat = new Map(finals.map((f) => [f.seat, f]))
  const winners = new Set(finals.filter((f) => f?.ok && f.winner !== -1).map((f) => Number(f.winner)))
  return [
    ...seats.map((seat) => {
      const final = by_seat.get(seat.name)
      const settled = !!final?.ok && final.winner !== -1
      return row(
        0,
        null,
        `seat ${seat.name} folded the settlement`,
        'a terminal winner in this seat’s own fold',
        settled ? `winner ${final.winner}` : (final?.error ?? `winner ${final?.winner ?? 'unread'}`),
        settled,
        'read off the seat’s own fight fold — never inferred from the other seat'
      )
    }),
    row(
      0,
      null,
      'both seats folded the SAME result',
      'one winner across every seat',
      winners.size === 1 ? `winner ${[...winners][0]}` : `${winners.size} distinct winner(s): ${[...winners].join(', ')}`,
      winners.size === 1,
      'two clients disagreeing about who won is a desync, not a display bug'
    ),
  ]
}

/**
 * ⑦ PER-MEMBER LOOT. The pack's rewards are only knowable after the settlement flow opens each member's
 * `FightResult` (world-shell/dungeon_settlement.js → `settled_loot_rows`); the fight fold this rig reads
 * projects the BOARD and stops at the terminal, so a headless drive can state that both seats settled but not
 * what each of them was paid. Gated with that reason until a settlement seam publishes it.
 */
export const assert_member_loot = (loot) =>
  loot?.rows?.length
    ? loot.rows.map((entry) =>
        row(
          0,
          null,
          `seat ${entry.seat} received its own loot row`,
          '≥ 1 reward row for this member',
          `${entry.units ?? entry.rows?.length ?? 0} row(s)`,
          Number(entry.units ?? entry.rows?.length ?? 0) >= 1
        )
      )
    : [
        gated_row(
          'each member carries its own loot row',
          'no headless door publishes per-member rewards — loot lands in each member’s FightResult, which the post-terminal settlement flow opens outside the fight fold this rig reads'
        ),
      ]

/**
 * THE BLOCK: the seven coop rows, in the order the ruling states them. Rows 4 and 5 are the run-level tallies
 * the turn loop accumulated; every other row is read off evidence the drive captured at its own moment.
 * @param {object} evidence
 * @param {(status_proofs: number, why: string) => Array<object>} status_assert `assert_status_proof_ran`
 */
export const coop_rows = (evidence, status_assert) => [
  ...assert_joiner_seated(evidence),
  ...assert_placements(evidence),
  ...assert_turn_order(evidence),
  ...status_assert(
    evidence.status_proofs ?? 0,
    'no seat ever planned a status-only cast — check the seats’ level against the first buff/debuff in their class book'
  ),
  ...assert_move_proofs(evidence.move_proofs ?? 0),
  ...assert_settlement_seen(evidence),
  ...assert_member_loot(evidence.loot),
]
