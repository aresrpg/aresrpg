// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SHUFFLE PROPERTY (§⑤ / consensus §Unanimous): "arrival order is irrelevant". Any chunk / dupe / reorder of
// the chain-read arrivals converges to the SAME committed truth. The input log IS the state: the inbox is a keyed
// fold by chain coordinate, so the committed board, the truth frontier and the adopted base are pure functions of
// the SET of reads, never their order.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'
import { hash_state } from '@aresrpg/sim/evolve'

import { empty_core_state, ingest, project_board, coord_key, truth_frontier } from '../src/core.js'

const CAPSULES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'capsules')
const files = readdirSync(CAPSULES_DIR).filter((name) => name.endsWith('.capsule.json'))
const load = (file) => JSON.parse(readFileSync(join(CAPSULES_DIR, file), 'utf8'))

/** A tiny deterministic LCG so shuffles are reproducible (a red is replayable, not flaky). */
const lcg = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)

/** Fisher–Yates over a copy, driven by the seeded PRNG. */
const shuffle = (arr, rng) => {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The order-independent fingerprint of a replay: the committed board hash + the frontier + the adopted base + the
 *  exact set of admitted coordinates. Two convergent replays agree on every one of these. */
const fingerprint = (state) => ({
  board: hash_state(project_board(state)),
  frontier: coord_key(truth_frontier(state.inbox)),
  base_version: state.inbox.base_version,
  log_keys: Object.keys(state.inbox.log).sort().join('|'),
})

/** Open a session-seeded core from a capsule's first `session_opened` (canonical is chain-only, so this is enough). */
const seed_of = (capsule) => {
  const opened = capsule.capsules.find((e) => e.payload.kind === 'session_opened')
  return opened ? ingest(empty_core_state(), opened) : empty_core_state(capsule.session_id ?? null)
}

/** Only the chain reads decide committed truth — the property is over their arrival order. */
const chain_reads = (capsule) => capsule.capsules.filter((e) => e.payload.kind === 'journal_rows_received')

const fold_reads = (seed, reads) => reads.reduce((state, envelope) => ingest(state, envelope), seed)

describe('the shuffle property — arrival order / dupes / chunking are irrelevant', () => {
  for (const file of files) {
    describe(file.slice(0, 14), () => {
      const capsule = load(file)
      const seed = seed_of(capsule)
      const reads = chain_reads(capsule)
      const reference = fingerprint(fold_reads(seed, reads))

      test('in-order replay is the reference', () => {
        expect(reference.board).toBeTruthy()
      })

      test('10 independent shuffles all converge to the reference', () => {
        for (let s = 1; s <= 10; s++) {
          const shuffled = shuffle(reads, lcg(s * 2654435761))
          expect(fingerprint(fold_reads(seed, shuffled)), `${file}: shuffle seed ${s} diverged`).toEqual(reference)
        }
      })

      test('duplication is idempotent (every read delivered twice)', () => {
        const rng = lcg(99)
        const duped = shuffle([...reads, ...reads], rng)
        expect(fingerprint(fold_reads(seed, duped)), `${file}: dupe+shuffle diverged`).toEqual(reference)
      })

      test('reverse arrival converges', () => {
        expect(fingerprint(fold_reads(seed, reads.slice().reverse())), `${file}: reverse diverged`).toEqual(reference)
      })

      test('chunked-and-reordered arrival converges (out-of-order batches)', () => {
        // Split into 5 contiguous chunks, deliver them in a rotated order — models batches landing out of sequence.
        const size = Math.ceil(reads.length / 5) || 1
        const chunks = []
        for (let i = 0; i < reads.length; i += size) chunks.push(reads.slice(i, i + size))
        const rotated = [...chunks.slice(2), ...chunks.slice(0, 2)].flat()
        expect(fingerprint(fold_reads(seed, rotated)), `${file}: chunk-rotate diverged`).toEqual(reference)
      })
    })
  }
})
