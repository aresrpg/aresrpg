// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_driver.js — L4's PURE authority driver (docs/design/simulator_rebuild_spec.md §4.5/§4.6).
//
// THE INVERSION (spec §1): in production the chain is the authority and `@aresrpg/sim` is the prediction twin.
// Here the sim IS the authority. This module owns the DRIVING half of that — folding player commits and mob
// turns through the REAL `@aresrpg/sim/reduce` and cutting each fold into ONE versioned receipt batch. It owns
// NO encoding: `encode_step` (sim events → chain rows) is L2's `sim_chain.encode_sim_step`, INJECTED here, so
// there is exactly one encoder in the repo and this file cannot drift from it.
//
// Pure by construction — a `session` is plain data ({ fight_id, seed, version, sim_state }) and every function
// returns a NEW one. Nothing here touches a store, a clock, or the DOM: the effect edge is fight_shim.js. That
// is what makes the determinism gate honest — the same seed and the same command list re-fold byte-identically
// in a bun test with no browser anywhere (fight_driver.test.js).
//
// VERSIONING: the store's receipt door is monotonic (`store.js` receipt arm drops `version <= applied_version`),
// so a session's `version` is the chain "object version" of §4.1 — 1 at the bootstrap snapshot, +1 per emitted
// batch, never reused. A batch that produces no rows still burns no version: an empty receipt is not a chain
// event, and folding one would move the frontier past events that never happened.

import { reduce, create_fight_state } from '@aresrpg/sim/reduce'
import { get_current_turn_entity } from '@aresrpg/sim/fight_state'
import { create_recorder, dump_capsule, observe_reduce_checked, open_recording } from '@aresrpg/sim/recorder'

/** Consecutive mob turns can chain (§4.6), but never unboundedly — a planner bug must surface as a loud stop,
 *  never a hung page. Sized well past any real roster/mob count so a legitimate chain is never truncated. */
export const MAX_CHAINED_MOB_TURNS = 64

/**
 * The bootstrap session — the sim's placement-phase state, the chain-object bookkeeping the store's door
 * needs, and the sim recorder's black box. `seed` is the ONE u32 determinism root (spec §1): it seeds the
 * board upstream and `state.rng` here.
 *
 * THE RECORDER LIVES WITH THE DRIVER, not with the encoder. `@aresrpg/sim/recorder` taps `reduce` CALLS, and
 * this module is what calls `reduce`; a tap anywhere else would have to re-derive the transitions it never
 * saw. Its ring is what `dump_sim_capsule` folds into the replayable timeline.js Capsule the trace export
 * ships (spec §8, row 2) — commands + seed, so a captured fight re-folds byte-identically and is a fixture
 * candidate for `packages/sim/test/fixtures/replay/`.
 *
 * @param {{ fight_id: string, seed: number, arena: any, team0: any[], team1: any[], templates_raw?: any }} params
 */
export const create_session = ({ fight_id, seed, arena, team0, team1, templates_raw = [] }) => {
  const sim_state = create_fight_state({
    fight_id,
    arena_seed: seed >>> 0,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  return {
    fight_id,
    seed: seed >>> 0,
    version: 1,
    sim_state,
    violations: [],
    recorder: open_recording(create_recorder(), {
      fight_id,
      arena,
      templates_raw,
      // exactly the four fields `timeline.js replay_capsule` reconstructs the initial state from
      initial: { fight_id, arena_seed: seed >>> 0, team0, team1 },
      meta: { seed: seed >>> 0, fight_seed: seed >>> 0 },
    }),
  }
}

/** The replayable sim Capsule for this session, or null when nothing has been recorded (spec §8). */
export const dump_sim_capsule = (session) => dump_capsule(session.recorder, session.fight_id)

/** The seat whose turn it is, or null once the fight is decided. `is_player` picks the driver's next move:
 *  a player seat WAITS for input, a mob seat is folded immediately (§4.6). */
export const active_seat = (session) => {
  const entity = get_current_turn_entity(session.sim_state)
  return entity ? { id: entity.id, is_player: !!entity.is_player } : null
}

export const is_over = (session) => session.sim_state.winner !== -1

/** The decided winner (0 = players, 1 = mobs, 2 = draw), or -1 while the fight is live. */
export const winner_of = (session) => session.sim_state.winner

/**
 * Fold ONE command through the authority. A rejected command is a silent no-op in the sim (reduce returns the
 * state unchanged with no events — there is no error channel), so rejection is DERIVED here rather than
 * guessed downstream: no events AND an unchanged state object means the reducer refused.
 * @returns {{ session: any, step: { pre: any, post: any, events: any[] } | null }}
 */
export const fold_command = (session, command, ctx) => {
  const pre = session.sim_state
  const { state: post, events } = reduce(pre, command, ctx)
  if (post === pre && events.length === 0) return { session, step: null }
  // The CHECKED tap: it records the transition AND sweeps the physics tripwires over it. A live invariant
  // breach is DATA here (the recorder is structurally unable to throw into the fight), so violations
  // accumulate on the session for the page to surface rather than crashing a running board.
  const { rec, violations } = observe_reduce_checked(session.recorder, {
    fight_id: session.fight_id,
    command,
    pre_state: pre,
    post_state: post,
    events,
  })
  return {
    session: {
      ...session,
      sim_state: post,
      recorder: rec,
      violations: violations.length ? [...session.violations, ...violations] : session.violations,
    },
    step: { pre, post, events },
  }
}

/**
 * Fold an ordered command list, stopping at the first refusal so a half-applied turn never silently ships a
 * partial batch. `refused` names the offending command for the submit door's `{ok:false, error}` (spec §4.5).
 *
 * A DECIDED FIGHT ENDS THE BATCH WITHOUT REFUSING IT. A drafted turn is `move… cast… end_turn` (the shape the
 * production HUD stages and one `commit_turn` PTB carries), so the killing cast routinely decides the fight
 * with the trailing `end_turn` still in the batch. That tail is MOOT, not illegal — on chain the same batch
 * applies and the fight is simply over. Treating it as a refusal would discard the whole winning turn and hang
 * the board on a fight the sim already decided. The sim itself takes this exact branch inside `handle_ai_turn`
 * (`if (acc.state.winner !== -1) break`), so this is the twin of an existing rule, not a new one.
 */
export const fold_commands = (session, commands, ctx) =>
  commands.reduce(
    (acc, command) => {
      if (acc.refused || is_over(acc.session)) return acc
      const { session: next, step } = fold_command(acc.session, command, ctx)
      if (!step) return { ...acc, refused: command }
      return { session: next, steps: [...acc.steps, step], refused: null }
    },
    { session, steps: [], refused: null }
  )

/** Turn folded steps into the ONE receipt the store's door consumes — `encode_step` is L2's, never ours. */
const receipt_of = (session, steps, encode_step) => {
  const events = steps.flatMap(({ pre, post, events: sim_events }) => encode_step(pre, post, sim_events))
  if (events.length === 0) return { session, receipt: null }
  const version = session.version + 1
  return { session: { ...session, version }, receipt: { type: 'receipt', version, receipt: { events } } }
}

/**
 * THE PLAYER SUBMIT (§4.5 steps 1–4, minus the effectful door call). Folds a drafted turn's commands and cuts
 * ONE receipt batch. Returns `{ ok: false }` on refusal — the fight core rolls its own prediction back.
 * @param {any} session @param {any[]} commands @param {any} ctx @param {(pre:any, post:any, events:any[]) => any[]} encode_step
 * @returns {{ ok: boolean, session: any, receipt: any, error: any, steps: any[] }}
 */
export const commit_batch = (session, commands, ctx, encode_step) => {
  const { session: folded, steps, refused } = fold_commands(session, commands, ctx)
  if (refused) return { ok: false, session, receipt: null, error: refused, steps: [] }
  const { session: bumped, receipt } = receipt_of(folded, steps, encode_step)
  return { ok: true, session: bumped, receipt, error: null, steps }
}

/**
 * THE MOB LEG (§4.6). Folds `ai_turn` for every consecutive mob seat until a PLAYER seat holds the turn or the
 * fight decides, and cuts ONE receipt per mob turn — one batch per turn is what makes each mob's wave pace
 * separately in the presentation fold (`present.js` paces ~3s per non-local turn); merging them into a single
 * receipt would collapse three mob turns into one visual beat.
 * @returns {{ session: any, receipts: any[], turns: number, stalled_on: string|null }}
 */
export const drive_mob_turns = (session, ctx, encode_step, { max_turns = MAX_CHAINED_MOB_TURNS } = {}) => {
  const run = (acc) => {
    const seat = active_seat(acc.session)
    if (!seat || seat.is_player || acc.turns >= max_turns) return acc
    const {
      session: folded,
      steps,
      refused,
    } = fold_commands(acc.session, [{ type: 'ai_turn', entity_id: seat.id }], ctx)
    // A refused ai_turn means the planner and the turn pointer disagree — stop LOUDLY rather than spin the
    // chain forever on a seat that will never advance (the bounded-liveness law; the caller surfaces it).
    if (refused) return { ...acc, stalled_on: seat.id }
    const { session: bumped, receipt } = receipt_of(folded, steps, encode_step)
    return run({
      session: bumped,
      receipts: receipt ? [...acc.receipts, receipt] : acc.receipts,
      turns: acc.turns + 1,
      stalled_on: null,
    })
  }
  return run({ session, receipts: [], turns: 0, stalled_on: null })
}

/**
 * STOP mid-fight (§4.7): abandon every living player seat and cut ONE terminal batch. Deliberately REFUSAL-
 * TOLERANT, unlike a player commit: the first abandon can already decide the fight, after which every
 * remaining seat's abandon is a legitimate no-op — treating that as a failed batch would drop the terminal
 * rows on the floor and leave the board hanging on a fight the sim considers over. The sim's own `abandon`
 * handler decides the winner, so the result card is the production one; the simulator never fabricates a
 * terminal.
 */
export const abandon_all = (session, ctx, encode_step) => {
  const living = session.sim_state.team0.filter((entity) => entity.health > 0).map((entity) => entity.id)
  const folded = living.reduce(
    (acc, entity_id) => {
      if (is_over(acc.session)) return acc
      const { session: next, step } = fold_command(acc.session, { type: 'abandon', entity_id }, ctx)
      return step ? { session: next, steps: [...acc.steps, step] } : acc
    },
    { session, steps: [] }
  )
  const { session: bumped, receipt } = receipt_of(folded.session, folded.steps, encode_step)
  return { ok: true, session: bumped, receipt, error: null, steps: folded.steps }
}
