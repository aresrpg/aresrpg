// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 TRAIN 0 — THE SEAL. Replay parity fixtures that assert `fight_visible_view` SNAPSHOTS, not just the fold.
//
// Design review, seal instrument: "replay parity fixtures assert `fight_visible_view` snapshots — the reported bug
// classes become view-level fixture asserts, and the deterministic twin proves the view, not just the fold."
//
// The capsule here is this package's own: "the STORE is the reducer, and its input log is its capsule"
// (src/trace_recorder.js). The corpus is the scenario capsule set `harness/scenarios.js` already serves to the
// replay-idempotence property (#281) — named `{ msg, now }` logs driven through the ONE door. Each capsule is
// replayed step by step through a FRESH store and the view is snapshotted AFTER EVERY input; the ordered list of
// snapshots is golden-recorded ONCE (REGOLD=1 bun test packages/fight/test/fight_visible_view_replay.test.js) and
// from then on every run must reproduce it byte-for-byte.
//
// What the committed goldens BUY the later trains: they are the baseline train 1..n must preserve. A fold-first
// migration that moves a fact into the reducer may not silently change what a surface sees — the moment
// `turn`/`entities` read differently at any replay step, this reds and the change has to be argued (regold
// deliberately, citing the train) instead of absorbed. A red here is a rules change or a bug, never noise.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { SCENARIOS } from '../harness/scenarios.js'
import { fight_visible_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'view_snapshots')
const REGOLD = process.env.REGOLD === '1'

/** The corpus is PINNED: a new scenario capsule must land with its own golden, never ride in unsnapshotted. */
const CORPUS = ['solo_mob_turn', 'solo_local_kill', 'predicted_cast_survives_unrelated_receipt', 'coop_peer_turn']

/**
 * Canonical, BigInt-safe, key-sorted image of a view — the same discipline the replay-idempotence harness applies
 * to its presentation trace, so the golden is stable regardless of build order and survives JSON round-trip.
 * A chain u64 (deadlines, seeds) arrives as a native BigInt; JSON has no BigInt, so it is tagged.
 */
const canonical = (value) => {
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value === undefined ? null : value
}

/** Replay one capsule through a fresh store, snapshotting the view AFTER every input. */
const replay_view_snapshots = (scenario) => {
  const store = create_fight_store()
  return scenario.log.map(({ msg, now }, index) => {
    store.getState().input(msg, now)
    return { index, input: String(msg?.type ?? 'unknown'), view: canonical(fight_visible_view(store.getState())) }
  })
}

const golden_path = (name) => join(GOLDEN_DIR, `${name}.json`)

describe('#1993 seal — the replay corpus pins fight_visible_view snapshots step by step', () => {
  test('every pinned capsule exists in the scenario corpus (a new capsule lands with its own golden)', () => {
    const names = SCENARIOS.map((s) => s.name)
    for (const name of CORPUS) expect(names).toContain(name)
  })

  for (const name of CORPUS) {
    describe(name, () => {
      const scenario = SCENARIOS.find((s) => s.name === name)
      const snapshots = replay_view_snapshots(scenario)

      test('the capsule replays to a snapshot per input, each carrying all six facts', () => {
        expect(snapshots.length).toBe(scenario.log.length)
        for (const step of snapshots)
          expect(Object.keys(step.view).sort()).toEqual(['controls', 'entities', 'mount', 'result', 'sync', 'turn'])
      })

      test('the per-step view snapshots reproduce the committed golden exactly', () => {
        const path = golden_path(name)
        if (REGOLD) {
          mkdirSync(GOLDEN_DIR, { recursive: true })
          writeFileSync(path, `${JSON.stringify(snapshots, null, 2)}\n`)
        }
        expect(existsSync(path), `${name}: no golden — record it with REGOLD=1`).toBe(true)
        // The golden is its DATA, not its whitespace (prettier owns the file's formatting), so the comparison is
        // over the parsed value — the same `jsonify` idiom the sim's replay gate pins its capsules with.
        expect(snapshots).toEqual(JSON.parse(readFileSync(path, 'utf8')))
      })

      test('the replay ends on a coherent board — turn/entities are the baseline later trains preserve', () => {
        const last = snapshots.at(-1).view
        // The two keys the design review names as the minimum baseline. `entities` may legitimately be empty
        // before a board is adopted, but this corpus always adopts one, so absence here is a real regression.
        expect(Object.keys(last.entities).length).toBeGreaterThan(0)
        expect(last.mount.adopted).toBe(true)
        expect(last.turn.order.length).toBeGreaterThan(0)
        for (const row of Object.values(last.entities)) {
          expect(row.vitals.committed).not.toBe(null)
          expect(row.cells.committed).not.toBe(null)
        }
      })
    })
  }
})
