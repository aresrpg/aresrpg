// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_driver.test.js — the L4 gate: a FULL scripted fight, start → victory, headless, seeded.
//
// This is the lane's load-bearing proof (docs/design/simulator_rebuild_spec.md §11 · L4 acceptance). It drives
// the REAL `@aresrpg/sim` authority through the REAL driver: player seats submit drafted move/cast/end_turn
// batches through the submit door (§4.5), mob seats fold through `fight_ai` on the seeded rng and chain until a
// player seat holds the turn (§4.6), and the fight runs to a decided winner.
//
// THE ENCODER IS A TEST DOUBLE, DELIBERATELY. Sim-events → chain-rows encoding is lane L2's slice
// (`packages/fight/src/sim_chain.js`, unlanded here — see sim_chain_seam.js). The driver takes `encode_step` as
// a parameter precisely so this lane's determinism can be proven without a second encoder existing anywhere:
// the double is a transparent 1:1 projection, so what the batching assertions below prove is the DRIVER's
// contract (batch cuts, version monotonicity, turn chaining, terminal), never the encoding. L2's own §4.4 twin
// test proves the encoding. Neither test can pass on the other's behalf, which is the point.
//
// DETERMINISM IS ASSERTED BOTH WAYS. Same seed twice ⇒ byte-identical event stream and final fold; a DIFFERENT
// seed ⇒ a different stream. Without the second half the first is vacuous — a driver that emitted nothing, or a
// sim with no live rng thread, would pass a same-seed equality check trivially.

import { describe, expect, test } from 'bun:test'
import { normalize_spell_templates, MOB_ATTACK_ID } from '@aresrpg/sim/spell_templates'
import { find_path_4dir } from '@aresrpg/sim/pathfind'
import { reduce } from '@aresrpg/sim/reduce'
import { replay_capsule } from '@aresrpg/sim/timeline'

import {
  abandon_all,
  active_seat,
  commit_batch,
  create_session,
  drive_mob_turns,
  dump_sim_capsule,
  is_over,
  winner_of,
} from './fight_driver.js'

// ── the local chain's stand-in (see the header) ──────────────────────────────────────────────────────────────
/** A transparent 1:1 projection of sim events into row shape — the ONLY thing under test here is the driver. */
const fake_encode_step = (pre, post, events) =>
  events.map((event) => ({ type: `0xsim::fight_events::${event.type}`, parsedJson: event }))

// ── fixtures: the spec's §4.2 arena shape (Uint8Array cells, 0 = walkable) ───────────────────────────────────
const flat_arena = (width = 11) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 4, y: 4 },
    { x: 4, y: 6 },
  ],
  spawns_b: [
    { x: 7, y: 4 },
    { x: 7, y: 6 },
  ],
})

const fighter = ({ id, cell, is_player, health, ap = 10, mp = 4 }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  // A real deck so the hand refills at each turn start — casting DISCARDS the card (reduce.js handle_cast),
  // so a deckless seat could cast exactly once in the whole fight and the script below would stall.
  deck: Array.from({ length: 16 }, () => MOB_ATTACK_ID),
  hand: [MOB_ATTACK_ID],
  discard: [],
  spell_levels: { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

/** Two roster seats vs two mobs — the spec's minimum interesting fight (multi-seat + multi-mob turn weave). */
const build_session = (seed) => {
  const arena = flat_arena()
  const ctx = { spell_templates: normalize_spell_templates([]), arena }
  const session = create_session({
    fight_id: `sim:${seed}:1`,
    seed,
    arena,
    templates_raw: [],
    team0: [
      fighter({ id: 'sim_c1', cell: { x: 4, y: 4 }, is_player: true, health: 400 }),
      fighter({ id: 'sim_c2', cell: { x: 4, y: 6 }, is_player: true, health: 400 }),
    ],
    team1: [
      fighter({ id: 'mob_0', cell: { x: 7, y: 4 }, is_player: false, health: 24 }),
      fighter({ id: 'mob_1', cell: { x: 7, y: 6 }, is_player: false, health: 24 }),
    ],
  })
  return { session, ctx }
}

const all_entities = (state) => [...state.team0, ...state.team1]
const entity_of = (state, id) => all_entities(state).find((entity) => entity.id === id)
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/**
 * The drafted turn a player seat submits — the same shape the production HUD stages (a cumulative move path
 * plus casts, then the turn end). Deliberately dumb and deterministic: close on the lowest-id living mob, hit
 * it once, end. It exercises move + cast + end_turn through the real handlers without a planner of its own.
 */
const draft_player_turn = (state, ctx, entity_id) => {
  const me = entity_of(state, entity_id)
  const [target] = state.team1.filter((mob) => mob.health > 0).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!target) return [{ type: 'end_turn', entity_id }]
  const occupied = new Set(
    all_entities(state)
      .filter((entity) => entity.health > 0 && entity.id !== entity_id)
      .map((entity) => `${entity.cell.x},${entity.cell.y}`)
  )
  const walkable = (cell) =>
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < ctx.arena.width &&
    cell.y < ctx.arena.height &&
    ctx.arena.cells[cell.y * ctx.arena.width + cell.x] === 0
  const step_to = () => {
    if (chebyshev(me.cell, target.cell) <= 1) return []
    // Stand on the first free orthogonal neighbour of the target we can actually path to within our MP.
    const stands = [
      { x: target.cell.x - 1, y: target.cell.y },
      { x: target.cell.x + 1, y: target.cell.y },
      { x: target.cell.x, y: target.cell.y - 1 },
      { x: target.cell.x, y: target.cell.y + 1 },
    ].filter((cell) => walkable(cell) && !occupied.has(`${cell.x},${cell.y}`))
    const path = stands
      .map((goal) => find_path_4dir(me.cell, goal, me.mp, walkable, (cell) => occupied.has(`${cell.x},${cell.y}`)))
      .find((found) => found != null && found.length > 1)
    return path ? [{ type: 'move', entity_id, path: path.slice(1) }] : []
  }
  const moves = step_to()
  // Only draft the cast when the drafted move actually lands us in range — an out-of-range cast is refused by
  // the sim and would discard the whole batch (which is the correct submit-door behaviour, not a script goal).
  const final_cell = moves.length ? moves[0].path[moves[0].path.length - 1] : me.cell
  const casts =
    chebyshev(final_cell, target.cell) <= 1
      ? [{ type: 'cast', entity_id, spell_id: MOB_ATTACK_ID, target: target.cell }]
      : []
  return [...moves, ...casts, { type: 'end_turn', entity_id }]
}

/**
 * Ready every player seat — the sim auto-starts once both sides are ready (mobs auto-ready). Folded THROUGH
 * the driver, exactly as fight_shim.js's `start` does, so the ready commands land in the recorder and the
 * dumped capsule replays the WHOLE fight rather than a headless tail. `version` is reset to the bootstrap 1
 * because the snapshot subsumes placement/ready (the shim's own note).
 */
const start_fight = (session, ctx) => ({
  ...session.sim_state.team0.reduce(
    (acc, entity) => commit_batch(acc, [{ type: 'ready', entity_id: entity.id }], ctx, fake_encode_step).session,
    session
  ),
  version: 1,
})

/**
 * Run the whole fight and return everything the determinism assertions compare: the ordered chain rows every
 * batch emitted, the receipt versions, and the final fold (hp/cells/winner) — the "one observable" of §4.4.
 */
const run_scripted_fight = (seed, { max_rounds = 60 } = {}) => {
  const built = build_session(seed)
  const { ctx } = built
  const start = start_fight(built.session, ctx)
  const step = (acc) => {
    const seat = active_seat(acc.session)
    if (!seat || is_over(acc.session) || acc.rounds >= max_rounds) return acc
    if (seat.is_player) {
      const result = commit_batch(
        acc.session,
        draft_player_turn(acc.session.sim_state, ctx, seat.id),
        ctx,
        fake_encode_step
      )
      // A refused draft is a script bug, not a driver outcome — surface it instead of looping forever.
      if (!result.ok) return { ...acc, refused: result.error }
      return step({
        session: result.session,
        rows: [...acc.rows, ...(result.receipt?.receipt.events ?? [])],
        versions: result.receipt ? [...acc.versions, result.receipt.version] : acc.versions,
        rounds: acc.rounds + 1,
        refused: null,
        stalled: null,
      })
    }
    const driven = drive_mob_turns(acc.session, ctx, fake_encode_step)
    if (driven.turns === 0) return { ...acc, stalled: driven.stalled_on ?? seat.id }
    return step({
      session: driven.session,
      rows: [...acc.rows, ...driven.receipts.flatMap((receipt) => receipt.receipt.events)],
      versions: [...acc.versions, ...driven.receipts.map((receipt) => receipt.version)],
      rounds: acc.rounds + 1,
      refused: null,
    })
  }
  const done = step({ session: start, rows: [], versions: [], rounds: 0, refused: null, stalled: null })
  const fold = all_entities(done.session.sim_state).map((entity) => ({
    id: entity.id,
    hp: entity.health,
    cell: entity.cell,
  }))
  return {
    session: done.session,
    rows: done.rows,
    versions: done.versions,
    fold,
    winner: winner_of(done.session),
    over: is_over(done.session),
    version: done.session.version,
    refused: done.refused,
    stalled: done.stalled,
    rounds: done.rounds,
  }
}

describe('L4 · the scripted fight runs headless, start → decided', () => {
  const run = run_scripted_fight(0xc81f3a92)

  test('it reaches a DECIDED terminal — no stall, no refused draft, players win', () => {
    expect(run.refused).toBeNull()
    expect(run.stalled).toBeNull()
    expect(run.over).toBe(true)
    expect(run.winner).toBe(0) // team0 (the roster) — the script out-damages two 24hp mobs
  })

  test('it emitted a real event stream across multiple batches (never a silent empty fight)', () => {
    expect(run.rows.length).toBeGreaterThan(10)
    expect(run.versions.length).toBeGreaterThan(3)
    expect(run.rows.some((row) => row.type.endsWith('fight_cast'))).toBe(true)
    expect(run.rows.some((row) => row.type.endsWith('fight_moved'))).toBe(true)
    expect(run.rows.some((row) => row.type.endsWith('fight_turn_start'))).toBe(true)
    expect(run.rows.some((row) => row.type.endsWith('fight_ended'))).toBe(true)
  })

  test('receipt versions are strictly monotonic and start above the bootstrap snapshot (v1)', () => {
    expect(run.versions[0]).toBe(2)
    expect(run.versions.every((version, index) => index === 0 || version > run.versions[index - 1])).toBe(true)
    expect(run.version).toBe(run.versions[run.versions.length - 1])
  })
})

describe('L4 · determinism — the seed is the whole fight', () => {
  test('SAME seed twice ⇒ byte-identical event stream and final fold', () => {
    const a = run_scripted_fight(0xc81f3a92)
    const b = run_scripted_fight(0xc81f3a92)
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows))
    expect(JSON.stringify(a.fold)).toBe(JSON.stringify(b.fold))
    expect(a.versions).toEqual(b.versions)
    expect(a.winner).toBe(b.winner)
  })

  test('a DIFFERENT seed ⇒ a different stream (else same-seed equality proves nothing)', () => {
    const a = run_scripted_fight(0xc81f3a92)
    const b = run_scripted_fight(0x0000beef)
    expect(b.over).toBe(true)
    expect(JSON.stringify(a.rows)).not.toBe(JSON.stringify(b.rows))
  })
})

describe('L4 · the submit door', () => {
  test('a refused command discards the WHOLE batch — never a half-applied turn', () => {
    const { session, ctx } = build_session(1)
    const started = start_fight(session, ctx)
    const seat = active_seat(started)
    const result = commit_batch(
      started,
      [
        { type: 'move', entity_id: seat.id, path: [{ x: 5, y: 4 }] },
        // out of range of every mob ⇒ the sim refuses it (no events, unchanged state)
        { type: 'cast', entity_id: seat.id, spell_id: MOB_ATTACK_ID, target: { x: 0, y: 0 } },
      ],
      ctx,
      fake_encode_step
    )
    expect(result.ok).toBe(false)
    expect(result.error.type).toBe('cast')
    expect(result.session).toBe(started) // the caller's session object, untouched — the core rolls its own prediction back
    expect(result.session.version).toBe(1)
  })

  test('an all-refused batch emits no receipt and burns no version', () => {
    const { session, ctx } = build_session(2)
    const result = commit_batch(session, [{ type: 'end_turn', entity_id: 'nobody' }], ctx, fake_encode_step)
    expect(result.ok).toBe(false)
    expect(result.receipt).toBeNull()
    expect(result.session.version).toBe(1)
  })
})

describe('L4 · mob turns chain until a player seat holds the turn (§4.6)', () => {
  test('consecutive mob seats fold in ONE drive, one receipt per turn', () => {
    const { session, ctx } = build_session(3)
    // Kill the turn weave's player interleave by ending both player turns first, so the two mob seats are
    // consecutive in the order and a single drive must chain them.
    const started = start_fight(session, ctx)
    const after_players = ['sim_c1', 'sim_c2'].reduce((acc, id) => {
      const seat = active_seat(acc)
      if (!seat || seat.is_player === false) return acc
      return commit_batch(acc, [{ type: 'end_turn', entity_id: seat.id }], ctx, fake_encode_step).session
    }, started)
    const driven = drive_mob_turns(after_players, ctx, fake_encode_step)
    expect(driven.turns).toBeGreaterThanOrEqual(1)
    expect(driven.receipts.length).toBe(driven.turns)
    expect(driven.stalled_on).toBeNull()
    // the driver stopped ON a player seat (or a terminal) — it never runs past the handover
    const seat = active_seat(driven.session)
    expect(seat === null || seat.is_player).toBe(true)
  })

  test('the chain is bounded — a driver can never spin forever on a stuck seat', () => {
    const { session, ctx } = build_session(4)
    const started = start_fight(session, ctx)
    const driven = drive_mob_turns(started, ctx, fake_encode_step, { max_turns: 0 })
    expect(driven.turns).toBe(0)
    expect(driven.session).toBe(started)
  })
})

describe('L4 · STOP mid-fight (§4.7)', () => {
  test('abandon_all decides the fight through the sim and emits the terminal rows', () => {
    const { session, ctx } = build_session(5)
    const started = start_fight(session, ctx)
    const result = abandon_all(started, ctx, fake_encode_step)
    expect(result.ok).toBe(true)
    expect(is_over(result.session)).toBe(true)
    expect(winner_of(result.session)).toBe(1) // the mobs take it — the roster walked
    expect(result.receipt.receipt.events.some((row) => row.type.endsWith('fight_ended'))).toBe(true)
    expect(result.receipt.version).toBe(2)
  })

  test('abandoning an already-decided fight is a tolerated no-op, not a failed batch', () => {
    const { session, ctx } = build_session(6)
    const started = start_fight(session, ctx)
    const once = abandon_all(started, ctx, fake_encode_step)
    const twice = abandon_all(once.session, ctx, fake_encode_step)
    expect(twice.ok).toBe(true)
    expect(twice.receipt).toBeNull()
    expect(twice.session.version).toBe(once.session.version)
  })
})

describe('L4 · the recorded sim capsule REPLAYS (spec §8, the deterministic half)', () => {
  const run = run_scripted_fight(0xc81f3a92)
  const capsule = dump_sim_capsule(run.session)

  test('the whole fight was recorded as a replayable timeline.js capsule', () => {
    expect(capsule).not.toBeNull()
    expect(capsule.commands.length).toBeGreaterThan(10)
    expect(capsule.meta.seed).toBe(0xc81f3a92)
    expect(capsule.initial.arena_seed).toBe(0xc81f3a92)
  })

  test('replay_capsule re-folds it to the SAME terminal — the capsule is the fight, not a summary of it', () => {
    const replayed = replay_capsule(capsule)
    expect(replayed.terminal.winner).toBe(run.winner)
    expect(replayed.terminal.team1.map((mob) => mob.health)).toEqual(
      run.session.sim_state.team1.map((mob) => mob.health)
    )
    expect(replayed.terminal.team0.map((seat) => seat.health)).toEqual(
      run.session.sim_state.team0.map((seat) => seat.health)
    )
  })

  test('the replay trips ZERO physics invariants, and so did the live fold', () => {
    expect(replay_capsule(capsule).violations).toEqual([])
    expect(run.session.violations).toEqual([])
  })

  test('two captures of the same seed carry the same trace digest', () => {
    const again = dump_sim_capsule(run_scripted_fight(0xc81f3a92).session)
    expect(replay_capsule(again).trace_digest).toBe(replay_capsule(capsule).trace_digest)
  })
})
