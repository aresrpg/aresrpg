// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// reduce_properties.test.js — L1 of the test-oracle ladder (issue #930), sim half.
//
// THE POINT: a golden capsule cannot exist before a working fight does — it pins a blessed output.
// These streams need neither. They fold random command sequences (legal and illegal, mixed on
// purpose) into `reduce` and assert only what is true of EVERY correct fight: hp in bounds, corpses
// inert, budgets respected, a frozen turn order, a latched winner, determinism, and a capsule that
// replays back to the same fight. Red today wherever a law breaks; no human blessing anywhere.
//
// A failure SHRINKS itself: the halve-and-retry loop below reduces a 150-command stream to the
// smallest slice that still breaks the law, dumps the capsule to artifacts-local/ (gitignored), and
// reports the law plus the path. Confirmed reducer defects are filed as issues and listed in
// quarantine.json, which skips exactly that (seed, law) pair and prints its issue number.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { digest, replay_capsule, terminal_summary } from '../../src/timeline.js'
import { dump_capsule } from '../../src/recorder.js'

import { fight_id_of, fold_stream, generate_stream } from './generator.js'
import QUARANTINE from './quarantine.json'

/** 32 streams x 150 commands — enough draws for every band to fire many times over, cheap enough
 *  to ride the one test truth (`bun run test`) without anyone noticing. */
const SEEDS = Array.from(
  { length: 32 },
  (_unused, i) => (Math.imul(i + 1, 0x9e3779b1) ^ 0x2545f491) >>> 0,
)
const STREAM_LENGTH = 150

const hex = seed => `0x${seed.toString(16).padStart(8, '0')}`

/** The whole corpus, generated and folded once. */
const RUNS = SEEDS.map(seed => {
  const commands = generate_stream({ seed, length: STREAM_LENGTH })
  return { seed, commands, folded: fold_stream({ seed, commands }) }
})

// ── The quarantine ratchet ──────────────────────────────────────────────────────────────────────
// Rows only ever SHRINK. A row is legal only while it names a filed issue AND still reproduces —
// a stale row fails the hygiene test below, so a fixed defect cannot leave a permanent skip behind.
// One row covers one (law, command) pair; a `seed: null` row is a defect that is not seed-specific.

const ROWS = QUARANTINE.rows ?? []
const rows_for = (seed, rule, command_type) =>
  ROWS.filter(
    row =>
      (row.seed === null || row.seed === seed) &&
      row.law === rule &&
      (row.command == null || row.command === command_type),
  )
const quarantine_note = seed => {
  const mine = ROWS.filter(row => row.seed === null || row.seed === seed)
  return mine.length === 0
    ? ''
    : ` [quarantined: ${mine.map(row => `${row.law} on ${row.command} -> #${row.issue}`).join(', ')}]`
}

// ── Shrinking + artifacts ───────────────────────────────────────────────────────────────────────

const breaks = (seed, commands, rule) =>
  fold_stream({ seed, commands }).violations.some(hit => hit.rule === rule)

/** Delta-debugging by complement removal: cut the stream into `granularity` chunks and keep any
 *  stream-minus-one-chunk that still breaks the law, refining until nothing smaller does. Bounded
 *  by a fold budget, pure, no clock — it runs only when a stream has already failed. */
const shrink = (seed, commands, rule, granularity = 2, budget = 240) => {
  if (budget <= 0 || commands.length <= 1 || granularity > commands.length)
    return commands
  const size = Math.ceil(commands.length / granularity)
  const smaller = Array.from({ length: granularity }, (_unused, i) => [
    ...commands.slice(0, i * size),
    ...commands.slice((i + 1) * size),
  ]).find(
    candidate =>
      candidate.length < commands.length && breaks(seed, candidate, rule),
  )
  const spent = budget - granularity
  return smaller === undefined
    ? shrink(seed, commands, rule, granularity * 2, spent)
    : shrink(seed, smaller, rule, 2, spent)
}

/** Write the minimal failing capsule + the violated law next to the suite. Local forensics only —
 *  artifacts-local/ is gitignored; the landed record of a confirmed defect is its GitHub issue. */
const write_artifact = (seed, rule, commands) => {
  const dir = fileURLToPath(new URL('./artifacts-local/', import.meta.url))
  mkdirSync(dir, { recursive: true })
  const path = `${dir}${rule}_${hex(seed)}.json`
  const folded = fold_stream({ seed, commands })
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        law: rule,
        seed,
        stream_id: fight_id_of(seed),
        violations: folded.violations.filter(hit => hit.rule === rule),
        capsule: dump_capsule(folded.recorder, fight_id_of(seed)),
      },
      null,
      2,
    )}\n`,
  )
  return path
}

/** One live violation, compressed to the line a reviewer needs (and shrunk on the way). */
const diagnose = (run, hit) => {
  const minimal = shrink(run.seed, run.commands, hit.rule)
  return `${hit.rule} @ ${hex(run.seed)} step ${hit.index}: ${hit.message} — minimal ${minimal.length}/${run.commands.length} commands, capsule at ${write_artifact(run.seed, hit.rule, minimal)}`
}

// ── The suite is not allowed to be vacuous ──────────────────────────────────────────────────────

describe('L1 corpus — the streams actually play fights', () => {
  test('the draws reach every arm: casts land, fighters move and die, fights get decided', () => {
    const kinds = new Set(
      RUNS.flatMap(run => run.folded.events).map(e => e.type),
    )
    for (const required of [
      'fight_started',
      'fight_turn_start',
      'fight_turn_end',
      'fight_moved',
      'fight_cast',
      'fight_ended',
    ])
      expect([...kinds]).toContain(required)
    const dead = RUNS.filter(run =>
      [...run.folded.state.team0, ...run.folded.state.team1].some(
        entity => entity.health <= 0,
      ),
    )
    expect(dead.length).toBeGreaterThan(RUNS.length / 2)
    expect(
      RUNS.filter(run => run.folded.state.winner !== -1).length,
    ).toBeGreaterThan(0)
    // …and the illegal half is real: plenty of commands were refused outright.
    expect(RUNS.every(run => run.commands.length === STREAM_LENGTH + 6)).toBe(
      true,
    )
  })
})

// ── Laws 1-5 + 9, one test per stream ───────────────────────────────────────────────────────────

describe('L1 laws — every folded command, legal or not', () => {
  for (const run of RUNS)
    test(`stream ${hex(run.seed)} obeys the laws${quarantine_note(run.seed)}`, () => {
      const live = run.folded.violations.filter(
        hit =>
          rows_for(run.seed, hit.rule, run.commands[hit.index]?.type).length ===
          0,
      )
      expect(
        live.length === 0 ? [] : live.map(hit => diagnose(run, hit)),
      ).toEqual([])
    })
})

// ── Law 6 — determinism ─────────────────────────────────────────────────────────────────────────

describe('law 6 — the same seed is the same fight, twice', () => {
  test('generation and folding are both pure functions of the seed', () => {
    for (const run of RUNS) {
      expect(
        generate_stream({ seed: run.seed, length: STREAM_LENGTH }),
      ).toEqual(run.commands)
      const again = fold_stream({ seed: run.seed, commands: run.commands })
      expect(digest(again.state)).toBe(digest(run.folded.state))
      expect(again.state).toEqual(run.folded.state)
      expect(
        JSON.stringify(dump_capsule(again.recorder, fight_id_of(run.seed))),
      ).toBe(
        JSON.stringify(
          dump_capsule(run.folded.recorder, fight_id_of(run.seed)),
        ),
      )
    }
  })

  test('a different seed is a different fight', () => {
    const digests = new Set(RUNS.map(run => digest(run.folded.state)))
    expect(digests.size).toBe(RUNS.length)
  })
})

// ── Law 8 — capsule round-trip ──────────────────────────────────────────────────────────────────

describe('law 8 — the dumped capsule replays back to the same fight', () => {
  for (const run of RUNS)
    test(`capsule ${hex(run.seed)} round-trips through replay_capsule`, () => {
      const capsule = dump_capsule(run.folded.recorder, fight_id_of(run.seed))
      expect(capsule).not.toBeNull()
      expect(capsule.commands.length).toBe(run.commands.length)
      const replayed = replay_capsule(JSON.parse(JSON.stringify(capsule)))
      expect(terminal_summary(replayed.terminal)).toEqual(
        terminal_summary(run.folded.state),
      )
      expect(digest(replayed.terminal)).toBe(digest(run.folded.state))
    })
})

// ── The quarantine's own tooth ──────────────────────────────────────────────────────────────────

describe('quarantine hygiene — a skip is never silent', () => {
  test('every row names a filed issue, a real stream — and still reproduces', () => {
    for (const row of ROWS)
      process.stdout.write(
        `\nL1 QUARANTINED: stream=${row.stream_id} law=${row.law} command=${row.command} issue=#${row.issue}\n`,
      )
    expect(
      ROWS.filter(row => !(Number.isInteger(row.issue) && row.issue > 0)),
    ).toEqual([])
    expect(
      ROWS.filter(row => row.seed !== null && !SEEDS.includes(row.seed)),
    ).toEqual([])
    expect(
      ROWS.filter(row =>
        row.seed === null
          ? row.stream_id !== '*'
          : row.stream_id !== fight_id_of(row.seed),
      ),
    ).toEqual([])
    // A row whose defect is fixed must be DELETED — the ratchet only shrinks.
    const reproduces = row =>
      RUNS.filter(run => row.seed === null || run.seed === row.seed).some(run =>
        run.folded.violations.some(
          hit =>
            hit.rule === row.law &&
            (row.command == null ||
              run.commands[hit.index]?.type === row.command),
        ),
      )
    expect(ROWS.filter(row => !reproduces(row))).toEqual([])
  })
})
