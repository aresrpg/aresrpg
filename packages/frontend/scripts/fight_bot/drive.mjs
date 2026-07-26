// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/drive.mjs — (c) THE TURN LOOP, for N SEATS. One loop drives every surface the bot has: the
// simulator's single seat, a world fight's single seat, and a coop fight's two. Solo is not a special case
// here, it is N = 1 — which is the whole reason coop cost a loop parameter instead of a second runner.
//
// WHAT A SEAT IS: one browser page, one authenticated character, one seam client, and the memory the snapshot
// cannot carry (the cooldown ledger, the spells the authority already refused, the traps it armed). Seats never
// share that memory: the policy is per-seat by construction, exactly as two players are.
//
// WHOSE TURN IT IS is read, never assumed. Every poll asks every seat, and the seat whose own read says
// `active_id === my_id` plays. A mob's turn belongs to nobody and simply passes; a dead seat never becomes
// active again; a fight where no seat holds a living fighter is a defeat, whoever is still polling.

import {
  assert_cross_client,
  assert_traps_sprung,
  assert_turn,
  plan_turn,
  prediction_tally,
  summarise,
} from '@aresrpg/fight/bot'

import { wait_for } from './seam.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const cell_str = (c) => (c ? `${c.x},${c.y}` : '—')
const outcome_of = (read) => (read.winner === 0 ? 'victory' : read.winner === 1 ? 'defeat' : 'draw')

/** Both pool clocks for one fighter — the presented bar and the committed anchor. */
const pick_pools = (read, id) => {
  const f = read?.fighters?.find((row) => row.id === id)
  return f
    ? { ap: f.ap, mp: f.mp, ap_committed: f.ap_committed, mp_committed: f.mp_committed, traps: read.my_traps }
    : null
}

/**
 * Poll every seat until one of them holds a playable turn — or the fight is over. Returns the ACTOR and the
 * read it will plan from, so the plan is made from the exact snapshot the turn decision was taken on.
 */
const next_actor = async ({ seats, timeout_ms, poll_ms = 400 }) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    const reads = await Promise.all(seats.map((seat) => seat.client.read().catch(() => null)))
    const terminal = reads.find((read) => read?.ok && read.winner !== -1)
    if (terminal) return { kind: 'terminal', outcome: outcome_of(terminal) }
    // EVERY seat readable and NONE of them alive ⇒ the players lost; the mobs will finish the fight without us.
    if (
      reads.every((read) => read?.ok) &&
      !reads.some((read) => read.fighters.find((f) => f.id === read.my_id)?.alive_committed)
    )
      return { kind: 'terminal', outcome: 'defeat' }
    // PLAYABLE, by the game's own definition (`can_end_turn`): my turn, nothing in flight, and the min-turn
    // floor elapsed. The floor is the chain's (`actions.move::assert_min_turn`) and the End Turn button greys
    // out for exactly this remainder — a bot that commits inside it is refused, just like a player who could
    // click faster than the rules allow.
    const index = reads.findIndex(
      (read) =>
        read?.ok &&
        read.active_id === read.my_id &&
        !read.busy &&
        !read.presenting &&
        (read.min_turn_left_ms ?? 0) === 0
    )
    if (index >= 0) return { kind: 'actor', seat: seats[index], read: reads[index] }
    await sleep(poll_ms)
  }
  return { kind: 'stalled' }
}

/**
 * THE CROSS-CLIENT OBSERVATION. After a seat commits, every OTHER seat must fold the same turn. Wait for the
 * observer to actually reach that turn before reading it — an observer still replaying is behind for legitimate
 * reasons, and asserting on it early would measure the replay clock instead of the fold. A timeout still
 * asserts: an observer that never caught up is exactly the desync worth failing on.
 */
const observe_others = async ({ seats, actor, plan, result, timeout_ms }) => {
  const rows = []
  let status_proofs = 0
  for (const other of seats) {
    if (other === actor) continue
    const settled =
      (await wait_for(
        other.client,
        (read) => !read.busy && !read.presenting && (read.turn_number ?? 0) >= (result.after?.turn_number ?? 0),
        { timeout_ms }
      )) ?? (await other.client.read().catch(() => null))
    const checked = assert_cross_client(plan, result, settled)
    rows.push(...checked.rows.map((row) => ({ ...row, observer: other.name })))
    status_proofs += checked.status_proofs
  }
  return { rows, status_proofs }
}

/**
 * FOLD THE COMMIT INTO THE SEAT'S MEMORY, and answer the traps it has been carrying. Two facts the snapshot
 * cannot hold: which card was played on which turn (the cooldown ledger, plus every spell the authority has
 * refused, so one refusal is a FAIL row and not an infinite loop of the same refused turn), and which cells this
 * seat has armed — because a trap proves itself the turn something WALKS INTO it, not the turn it was cast, so
 * that ledger is carried forward and checked against every later board.
 * @returns {{ rows: Array<object>, remaining: Array<object> }} the traps that sprang, and those still waiting
 */
const record_commit = ({ seat, plan, result, turn, turn_number }) => {
  // ONLY THE AUTHORITY'S VERDICT BLACKLISTS. A turn-level refusal (not my turn yet, the store mid-poll, the
  // min-turn floor) judged the timing, not the spell — treating it as evidence blinds the bot to a spell that
  // was never the problem, and it stays blind for the rest of the fight.
  //
  // AND A CAST-LIMIT REFUSAL IS A CLOCK TOO (#1157). Cooldown, casts_per_turn and casts_per_target all expire:
  // the authority is saying "not now", never "not this spell". Blacklisting on those retired every cooldown
  // spell in the book the first time the policy's own copy of the rule was one turn optimistic — permanently,
  // and the sheet still reported PASS on the impoverished fight that followed.
  const recoverable =
    /cooldown|cast limit|casts_per_turn|casts_per_target|cast_per_turn_limit|cast_per_target_limit|spell_cooldown/i
  const judged = !result.ok && !result.turn_level && !recoverable.test(String(result.error ?? ''))
  for (const action of plan.actions)
    if (action.kind === 1) {
      // THE COOLDOWN LEDGER RECORDS CASTS, NOT ATTEMPTS. A refused turn cast nothing, so stamping it here
      // locked a spell the authority never saw — the bot's own ledger inventing a cooldown that does not exist.
      if (result.ok) seat.history.casts[action.spell_id] = turn_number ?? turn
      if (judged && !seat.history.blocked.includes(action.spell_id)) seat.history.blocked.push(action.spell_id)
    }
  if (!result.ok) return { rows: [], remaining: seat.armed_traps }
  const sprung = assert_traps_sprung(seat.armed_traps, result.before, result.after)
  const armed = plan.actions
    .filter((action) => action.expect?.type === 'trap')
    .map((action) => ({ cell: action.expect.cell, turn, spell_key: action.spell_key }))
  seat.armed_traps = [...sprung.remaining, ...armed]
  // The client's own trap ledger never learns about a trap committed through the seam, so the policy keeps its
  // own — canonical stride-20 encode, the board's own indexing.
  seat.history.traps = [...seat.history.traps, ...armed.map(({ cell }) => cell.y * 20 + cell.x)]
  return sprung
}

/**
 * Play the fight out. Returns the sheet's turn rows, the outcome, and the cross-client tally.
 * @param {{ seats: Array<object>, max_turns: number, policy_seed: number, log: Function,
 *   turn_timeout_ms?: number, observe_timeout_ms?: number }} options
 */
export const drive_fight = async ({
  seats,
  max_turns,
  policy_seed,
  log,
  turn_timeout_ms = 120_000,
  observe_timeout_ms = 60_000,
}) => {
  const turns = []
  const cross = { rows: [], status_proofs: 0 }
  // THE RUN'S PARITY TALLY (#1144) — how many casts were actually compared prediction↔authority, and the reasons
  // the rest could not be. A run that resolved none proves nothing about parity and says so at run level.
  const parity = { checked: 0, unresolved: [] }
  let outcome = 'not reached'
  let stalled = false
  /** One re-read is allowed when the turn pointer moved between the read and the commit (a harness race, not a
   *  game failure); a second is a genuine stall and is recorded as the FAIL it is. */
  let races = 0

  for (let turn = 1; turn <= max_turns; turn++) {
    const next = await next_actor({ seats, timeout_ms: turn_timeout_ms })
    if (next.kind === 'terminal') {
      ;({ outcome } = next)
      break
    }
    // A STALL ENDS THE RUN, IT DOES NOT ERASE IT. Throwing here discarded every turn already played — measured on
    // a live chain run that stalled at turn 5 and reported `0/0 checks, 0 bot turns` for four REAL committed
    // turns, one of which carried a FAIL row nobody can now read. The rig's own rule (a failure with no evidence
    // is a failure nobody can diagnose) applies to its own sheet: the stall is the outcome, the turns are kept.
    if (next.kind === 'stalled') {
      outcome = `stalled at turn ${turn} — no seat got the turn back`
      stalled = true
      break
    }
    const { seat, read } = next
    const me = read.fighters.find((f) => f.id === read.my_id)

    const plan = plan_turn(read, { seed: policy_seed, history: seat.history })
    const mark = seat.console_lines.length
    const result = await seat.client.commit(plan.actions)
    // The shim logs WHICH staged action the sim declined and why; the store's boolean cannot carry it. A
    // refusal without its reason is exactly the silence this bot exists to end.
    const refusal = seat.console_lines.slice(mark).filter((line) => /commit refused|did not fold|tripwire/i.test(line))
    if (!result.ok && refusal.length) result.error = `${result.error} — ${refusal[0]}`
    // A TURN-LEVEL refusal is the world moving between the read and the commit — the pointer advanced, a poll
    // landed, the floor had a moment left. It is a harness race, not a game failure, so it costs a re-read
    // rather than a FAIL row. The budget is deliberately tiny: a THIRD one is a genuine stall, and stalls are
    // exactly what this bot is for.
    if (!result.ok && result.turn_level && races++ < 2) {
      log(`[bot] turn ${turn}: ${result.error} — re-reading`)
      turn -= 1
      await sleep(1500)
      continue
    }
    const sprung = record_commit({ seat, plan, result, turn, turn_number: read.turn_number })
    const observed =
      seats.length > 1
        ? await observe_others({ seats, actor: seat, plan, result, timeout_ms: observe_timeout_ms })
        : null
    if (observed) {
      cross.rows.push(...observed.rows)
      cross.status_proofs += observed.status_proofs
    }
    const rows = [...assert_turn(plan, result), ...sprung.rows, ...(observed?.rows ?? [])]
    const tally = prediction_tally(plan, result)
    parity.checked += tally.checked
    parity.unresolved.push(...tally.unresolved)
    turns.push({
      turn,
      seat: seat.name,
      ap: me.ap,
      mp: me.mp,
      hp: `${me.hp_committed}/${me.hp_max}`,
      at: me.cell_committed,
      enemies: read.fighters
        .filter((f) => f.team !== me.team && f.alive_committed)
        .map((f) => ({ id: f.id, at: f.cell_committed, hp: f.hp_committed })),
      decisions: plan.decisions,
      actions: plan.actions,
      // WHAT THE CLIENT SAID WOULD HAPPEN, verbatim — the sheet carries the bank next to the fold it was
      // compared against, so a divergence row is reproducible evidence and not a line of log.
      predicted: result.predicted ?? [],
      committed: { ok: result.ok, error: result.error ?? null },
      // The two pool clocks either side of the commit — the diagnostic that tells a red AP row apart from a
      // surface that simply never reconciles its pools.
      pools: {
        before: pick_pools(result.before, result.before?.my_id),
        after: pick_pools(result.after, result.after?.my_id),
      },
      rows,
    })
    const verdict = summarise(rows)
    log(
      `[bot] turn ${turn} (${seat.name}): ${plan.actions.length} action(s) — ${plan.actions.map((a) => (a.kind === 0 ? `move→${cell_str(a.cell)}` : `${a.spell_key}→${cell_str(a.cell)}`)).join(', ') || 'pass'} · ${verdict.passed}/${verdict.checks} checks`
    )
    if (!result.ok) log(`[bot]   commit refused: ${result.error}`)
  }

  // A stall may simply be a terminal the client never folded — ask every seat once before naming it a stall.
  if (stalled)
    for (const seat of seats) {
      const last = await seat.client.read().catch(() => null)
      if (last?.ok && last.winner !== -1) {
        outcome = outcome_of(last)
        break
      }
    }
  if (outcome === 'not reached')
    for (const seat of seats) {
      const last = await seat.client.read().catch(() => null)
      if (last?.ok && last.winner !== -1) {
        outcome = outcome_of(last)
        break
      }
    }
  return { turns, outcome, cross, parity }
}

/** A fresh seat: its page, its seam, whatever its surface knows about it, and the memory a snapshot cannot carry. */
export const make_seat = (session) => ({
  ...session,
  history: { casts: {}, blocked: [], traps: [] },
  armed_traps: [],
})
