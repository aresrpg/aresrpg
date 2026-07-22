// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE ACCEPTANCE CORPUS (Fight V2 build step 2, §⑤ / consensus acceptance bar). Every capsule in the two-week
// historical corpus MUST replay green through the composed core: ingress → fold, with (1) no throw, (2) the fold
// reaching the file's final chain-event index, (3) every projection a LEGAL board — INCLUDING the starve state where
// the presentation cursor lags the truth frontier by far (truth at frontier, the eye far behind, still coherent).
//
// A capsule that will not replay is a FINDING, not a test bug: the report names its file + the jam coordinate + the
// fold state — possibly a real historical desync's signature (this corpus's journal starve is one such, asserted
// below as a positive control that the failure-as-data machinery actually fires).

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import {
  replay,
  replay_trace,
  project_board,
  project_presentation,
  project_hud,
  is_legal_board,
  present_cursor,
  PACING_POLICY,
} from '../../src/v2/index.js'

const CAPSULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'capsules')
const files = readdirSync(CAPSULES_DIR).filter((name) => name.endsWith('.capsule.json'))
const load = (file) => JSON.parse(readFileSync(join(CAPSULES_DIR, file), 'utf8'))

/** The max chain-event coordinate version the file carries — the "final journal index" the fold must reach. */
const max_chain_version = (capsule) =>
  capsule.capsules.reduce(
    (max, e) => (e.payload.kind === 'journal_rows_received' ? Math.max(max, Number(e.payload.version ?? -1)) : max),
    -1
  )

describe('the corpus replays green through ingress → fold', () => {
  test('the corpus is present (8 files, ~9,829 envelopes)', () => {
    expect(files.length).toBe(8)
    const total = files.reduce((sum, f) => sum + load(f).capsules.length, 0)
    expect(total).toBe(9829)
  })

  for (const file of files) {
    describe(file.slice(0, 14), () => {
      const capsule = load(file)
      const trace = replay_trace(capsule)

      test('replays without throwing', () => {
        expect(() => replay(capsule)).not.toThrow()
        expect(trace.envelopes).toBe(capsule.capsules.length)
      })

      test('the fold reaches the final chain-event index', () => {
        const reached = Math.max(trace.final_index.version, trace.base_version)
        const final_index = max_chain_version(capsule)
        expect(
          reached,
          `${file}: truth reached v${reached} but the stream's final index is v${final_index} — jam at ${JSON.stringify(trace.final_index)}, base v${trace.base_version}`
        ).toBeGreaterThanOrEqual(final_index)
      })

      test('every projection is a LEGAL board', () => {
        const board = project_board(trace.state)
        const presented = project_presentation(trace.state)
        expect(is_legal_board(board), `${file}: committed board illegal`).toBe(true)
        expect(is_legal_board(presented), `${file}: presented board illegal`).toBe(true)
        // The HUD reads clean off a real fight (a known phase, a resolved winner sentinel).
        const hud = project_hud(trace.state)
        expect(['active', 'victory', 'defeat']).toContain(hud.phase)
      })

      test('STARVE: presentation-cursor ≪ truth-frontier renders as a LEGAL state', () => {
        // Force the eye to the very start while truth sits at the frontier — the 2,100-behind class. The presented
        // board must remain coherent (the projection coalesces/snaps; it never throws or lies).
        const starved = { ...trace.state, clock: { now_ms: trace.state.clock.now_ms, cursor: 0 } }
        const presented = project_presentation(starved)
        expect(is_legal_board(presented), `${file}: starved presentation illegal`).toBe(true)
        // The snap keeps the eye from falling unboundedly behind: past max_lag the effective cursor jumps forward.
        const board = project_board(trace.state)
        const beats = Object.keys(board.fighters ?? {}).length >= 0 ? undefined : 0 // (board touched to prove no throw)
        void beats
        const effective = present_cursor(500, 0, PACING_POLICY)
        expect(effective).toBe(500 - PACING_POLICY.snap_to)
      })
    })
  }
})

describe('failure is DATA — the journal starve surfaces as a finding (positive control)', () => {
  // The one journal-bearing capsule: the indexer delivered seq 0,1 then went silent (head 2→8, bodies absent). The
  // core must SURFACE that as a `journal_gap` finding, never stall — receipts fill the gap via the version watermark.
  const journal_file = files.find((f) => {
    const c = load(f)
    return c.capsules.some(
      (e) =>
        e.payload.kind === 'journal_rows_received' &&
        e.payload.source === 'journal' &&
        (e.payload.rows?.events ?? []).length > 0
    )
  })

  test('a journal-bearing capsule exists in the corpus', () => {
    expect(journal_file).toBeDefined()
  })

  test('its replay reports journal_gap findings and STILL reaches the final index', () => {
    const capsule = load(journal_file)
    const trace = replay_trace(capsule)
    const gaps = trace.failures.filter((f) => f.kind === 'journal_gap')
    expect(gaps.length, 'the starve must be surfaced as data').toBeGreaterThan(0)
    expect(gaps[0]).toMatchObject({ kind: 'journal_gap', head: expect.any(Number), delivered: expect.any(Number) })
    // The gap is data, not a stall: truth still reaches the final index (the receipts carried it).
    const reached = Math.max(trace.final_index.version, trace.base_version)
    expect(reached).toBeGreaterThanOrEqual(max_chain_version(capsule))
  })
})
