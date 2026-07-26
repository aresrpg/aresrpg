// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_properties.test.js — L1 of the test-oracle ladder (issue #930), fight half.
//
// Same rung, different subject: the sim half asks whether ONE reducer step is lawful, this half
// asks whether the RECEIPT of a whole committed turn carries enough truth for the core to rebuild
// the same fight. Random fights, no blessed output, no oracle — just the twin contract:
//
//   fold(receipt rows) == the sim's own observable, at every batch boundary, for every stream.
//
// sim_chain.test.js pins that for one hand-scripted fight; this pins it for generated ones, which
// is where an encoder gap actually hides — a spell nobody scripted, a kill on a boundary, a push
// that lands on a hole. The roster, the kit and the command draw are shared with the sim half
// (packages/sim/test/oracle/generator.js): one home for the fixture, two subjects under test.
//
// Confirmed defects are filed as issues and listed in quarantine.json, which skips exactly that
// (law, command) pair and prints its issue number. A row without an issue number fails the suite.

import { describe, expect, test } from 'bun:test'
import { digest } from '@aresrpg/sim/timeline'

import {
  arena_from_board,
  capsule_of,
  create_sim_chain,
  current_actor,
  derive_board,
  pending_mob_turn,
  run_ai_turn,
  sim_projection,
  snapshot_from_sim,
  submit_commands,
} from '../../src/sim_chain.js'
import { build_roster, next_command, TEMPLATES_RAW } from '../../../sim/test/oracle/generator.js'

import { capsule_roundtrip_violations, fold_equality_violations } from './laws.js'
import QUARANTINE from './quarantine.json'

/** 24 seeded fights, each driven to a conclusion or 60 batches — the board derivation is the
 *  expensive part, so the corpus is sized by distinct BOARDS rather than by command count. */
const SEEDS = Array.from({ length: 24 }, (_unused, i) => (Math.imul(i + 1, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0)
const MAX_BATCHES = 60
/** Injected clock — the mock chain takes wall time as an input, never reads one (determinism). */
const NOW = 1_784_752_468_344

const hex = (seed) => `0x${seed.toString(16).padStart(8, '0')}`

/** Commands a committed turn may carry. `abandon` has its own door (`abandon_fight`) and forfeits
 *  the whole roster, so it is never drafted mid-turn; placement is over before the first batch. */
const ACTING = new Set(['move', 'cast'])

/** Boot a 2v2 on the seed's own chain-derived board. */
const build_chain = (seed) => {
  const { board } = derive_board(seed)
  const { team0, team1 } = build_roster(arena_from_board(board))
  return create_sim_chain({
    seed,
    fight_id: `oracle:${seed.toString(16)}`,
    team0,
    team1,
    templates_raw: TEMPLATES_RAW,
    group_template: '0xgroup',
  })
}

/**
 * One batch — the receipt granularity the store sees: a mob's whole `ai_turn`, or a player's
 * drafted turn (up to four drawn acting commands, closed by `end_turn`). The draw is the sim
 * half's, so illegal moves and casts land here too; a receipt for a refused command is empty rows.
 */
const next_batch = (chain, rng, width) => {
  const actor = current_actor(chain)
  if (actor == null) return null
  const mob = pending_mob_turn(chain)
  if (mob != null) return { rng, ...run_ai_turn(chain, mob, { now_ms: NOW }) }
  const drafted = Array.from({ length: 4 }).reduce(
    (acc) => {
      const step = next_command(chain.sim_state, acc.rng, width)
      return {
        rng: step.rng,
        commands: ACTING.has(step.command.type) ? [...acc.commands, step.command] : acc.commands,
      }
    },
    { rng, commands: [] }
  )
  return {
    rng: drafted.rng,
    ...submit_commands(chain, [...drafted.commands, { type: 'end_turn', entity_id: actor }], { now_ms: NOW }),
  }
}

/** Drive a whole fight, banking each batch's receipt and the sim's own observable at that boundary. */
const drive = (seed) => {
  const booted = build_chain(seed)
  const { width } = booted.board
  const run = Array.from({ length: MAX_BATCHES }).reduce(
    (acc) => {
      if (acc.done) return acc
      const result = next_batch(acc.chain, acc.rng, width)
      if (result == null) return { ...acc, done: true }
      return {
        done: false,
        rng: result.rng,
        chain: result.chain,
        batches: [
          ...acc.batches,
          { version: result.version, receipt: result.receipt, sim: sim_projection(result.chain.sim_state) },
        ],
      }
    },
    { chain: booted, rng: (seed ^ 0x5f3759df) >>> 0, batches: [], done: false }
  )
  return { snapshot: snapshot_from_sim(booted, { now_ms: NOW }), chain: run.chain, batches: run.batches }
}

const RUNS = SEEDS.map((seed) => ({ seed, run: drive(seed) }))

// ── The quarantine ratchet — rows only shrink, and a skip always prints its issue ────────────────

const ROWS = QUARANTINE.rows ?? []
const rows_for = (seed, rule) => ROWS.filter((row) => (row.seed === null || row.seed === seed) && row.law === rule)
const quarantine_note = (seed) => {
  const mine = ROWS.filter((row) => row.seed === null || row.seed === seed)
  return mine.length === 0 ? '' : ` [quarantined: ${mine.map((row) => `${row.law} -> #${row.issue}`).join(', ')}]`
}

/** Every law this half asserts over one driven fight, as one violation list. */
const violations_of = ({ seed, run }) =>
  [
    ...run.chain.violations.map((hit) => ({ rule: hit.rule, message: hit.message })),
    ...fold_equality_violations(run),
    ...capsule_roundtrip_violations(run.chain),
  ].filter((hit) => rows_for(seed, hit.rule).length === 0)

// ── The corpus is not allowed to be vacuous ─────────────────────────────────────────────────────

describe('L1 fight corpus — the driven fights actually happen', () => {
  test('receipts carry the whole vocabulary: turns, moves, casts, hits, displacement, a terminal', () => {
    const kinds = new Set(
      RUNS.flatMap(({ run }) => run.batches.flatMap((b) => b.receipt.events.map((e) => e.type.split('::').pop())))
    )
    for (const required of ['TurnStarted', 'TurnEnded', 'Moved', 'MobMoved', 'Cast', 'Hit', 'Displaced'])
      expect([...kinds]).toContain(required)
    expect([...kinds].some((kind) => kind === 'Victory' || kind === 'Defeat')).toBe(true)
    expect(RUNS.every(({ run }) => run.batches.length > 4)).toBe(true)
    // most fights must actually FINISH — a corpus that only ever times out never tests the terminal
    const decided = RUNS.filter(({ run }) => run.chain.sim_state.winner !== -1)
    expect(decided.length).toBeGreaterThan(RUNS.length / 2)
  })
})

// ── Laws 7 + 8 + 9, one test per driven fight ───────────────────────────────────────────────────

describe('laws 7-9 — one observable, two folders', () => {
  for (const entry of RUNS)
    test(`fight ${hex(entry.seed)} folds, replays and trips no tripwire${quarantine_note(entry.seed)}`, () => {
      expect(violations_of(entry).map((hit) => `${hit.rule}: ${hit.message}`)).toEqual([])
    })
})

// RED-FIRST PROOF: law 7 is only worth its line count if a WRONG encoding fails it. Corrupt the
// receipts of the generated corpus the way a real encoder bug would, and every fight must break —
// a mutation that survives means the law is asleep, and that is itself the failure this reports.
describe('law 7 is awake — a corrupted receipt cannot pass the fold', () => {
  const MUTATIONS = {
    'the hp on every hit is off by one': (rows) =>
      rows.map((row) =>
        row.type.endsWith('::Hit')
          ? { ...row, parsedJson: { ...row.parsedJson, remaining_hp: String(Number(row.parsedJson.remaining_hp) + 1) } }
          : row
      ),
    // Only displacement that MOVED someone is load-bearing: the encoder also emits a zero-distance
    // Displaced row (from_cell === to_cell) for a push that resolved to nothing, and dropping that
    // one is information-free by construction — a mutation that fakes a break proves nothing.
    'displacement is dropped (the fold never learns the new cell)': (rows) =>
      rows.filter((row) => !(row.type.endsWith('::Displaced') && row.parsedJson.from_cell !== row.parsedJson.to_cell)),
    'the terminal is dropped (the fight never ends)': (rows) =>
      rows.filter((row) => !row.type.endsWith('::Victory') && !row.type.endsWith('::Defeat')),
  }

  const corrupt = (run, mutate) => ({
    ...run,
    batches: run.batches.map((batch) => ({ ...batch, receipt: { events: mutate(batch.receipt.events) } })),
  })

  for (const [name, mutate] of Object.entries(MUTATIONS))
    test(`RED — ${name}`, () => {
      // A fight whose receipts the mutation does not touch proves nothing; every fight it DOES
      // touch must break, and there must be some — otherwise the mutation itself is vacuous.
      const touched = RUNS.filter(
        ({ run }) => JSON.stringify(corrupt(run, mutate).batches) !== JSON.stringify(run.batches)
      )
      const broken = touched.filter(({ run }) => fold_equality_violations(corrupt(run, mutate)).length > 0)
      expect(touched.length).toBeGreaterThan(0)
      expect(broken.length).toBe(touched.length)
    })
})

// ── Law 6 — determinism ─────────────────────────────────────────────────────────────────────────

describe('law 6 — the same seed is the same fight, twice', () => {
  test('receipts, snapshots and capsule dumps are byte-identical across two drives', () => {
    for (const { seed, run } of RUNS) {
      const again = drive(seed)
      expect(JSON.stringify(again.batches)).toBe(JSON.stringify(run.batches))
      expect(digest(again.chain.sim_state)).toBe(digest(run.chain.sim_state))
      expect(JSON.stringify(capsule_of(again.chain))).toBe(JSON.stringify(capsule_of(run.chain)))
    }
  })

  test('a different seed is a different fight', () => {
    expect(new Set(RUNS.map(({ run }) => digest(run.chain.sim_state))).size).toBe(RUNS.length)
  })
})

// ── The quarantine's own tooth ──────────────────────────────────────────────────────────────────

describe('quarantine hygiene — a skip is never silent', () => {
  test('every row names a filed issue and still reproduces', () => {
    for (const row of ROWS)
      process.stdout.write(`\nL1 QUARANTINED: stream=${row.stream_id} law=${row.law} issue=#${row.issue}\n`)
    expect(ROWS.filter((row) => !(Number.isInteger(row.issue) && row.issue > 0))).toEqual([])
    expect(ROWS.filter((row) => row.seed !== null && !SEEDS.includes(row.seed))).toEqual([])
    // A row whose defect is fixed must be DELETED — the ratchet only shrinks.
    const reproduces = (row) =>
      RUNS.filter(({ seed }) => row.seed === null || seed === row.seed).some(({ run }) =>
        [...run.chain.violations, ...fold_equality_violations(run), ...capsule_roundtrip_violations(run.chain)].some(
          (hit) => hit.rule === row.law
        )
      )
    expect(ROWS.filter((row) => !reproduces(row))).toEqual([])
  })
})
