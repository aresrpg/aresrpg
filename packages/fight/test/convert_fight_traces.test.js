// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { convert_trace, kind_tally } from '../../../scripts/convert_fight_traces.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CAPSULES_DIR = join(HERE, 'fixtures/capsules')

// A minimal but REAL-SHAPED trace_format-1 slice — the exact message shapes lifted from the captured
// aresrpg-fight-trace-* corpus (init → ctx → snapshot → tick → intent → receipt → busy → journal).
const SAMPLE_TRACE_1 = {
  trace_format: 1,
  fight_id: '0xfeed',
  app_version: '1.12.45',
  captured_at: 1784655007603,
  inputs: [
    { seq: 2, at: 1784654951988, msg: { type: 'init', fight_id: '0xfeed', my_key: null, ctx: { address: '0xabc' } } },
    { seq: 3, at: 1784654951988, msg: { type: 'ctx', ctx: { roster: [] } } },
    { seq: 6, at: 1784654953214, msg: { type: 'snapshot', fight: { id: '0xfeed' }, version: 100, fight_id: '0xfeed' } },
    { seq: 20, at: 1784654960000, msg: { type: 'tick' } },
    { seq: 16, at: 1784654961000, msg: { type: 'intent', intent: { kind: 'Placed', cell: 7 } } },
    {
      seq: 19,
      at: 1784654962000,
      msg: {
        type: 'receipt',
        receipt: { effects: { status: { status: 'success' } } },
        version: 101,
        fight_id: '0xfeed',
      },
    },
    { seq: 18, at: 1784654962500, msg: { type: 'busy', value: true, latch: null } },
    { seq: 8, at: 1784654963000, msg: { type: 'journal', fight_id: '0xfeed', batch: { source: 'journal', head: 5 } } },
  ],
}

describe('convert_trace — format-1 → format-2 envelope stream (RED-FIRST)', () => {
  const trace2 = convert_trace(SAMPLE_TRACE_1, { source_file: 'aresrpg-fight-trace-0xfeed-1784655007603.json' })

  test('the capsule header is trace_format 2, envelope_version 1, with the source session + app version', () => {
    expect(trace2.trace_format).toBe(2)
    expect(trace2.envelope_version).toBe(1)
    expect(trace2.session_id).toBe('0xfeed')
    expect(trace2.app_version).toBe('1.12.45')
    expect(trace2.captured_at).toBe(1784655007603)
  })

  test('each input becomes one classified envelope, in order, keeping its original seq + at', () => {
    expect(trace2.capsules.map((e) => e.payload.kind)).toEqual([
      'session_opened',
      'lifecycle',
      'journal_rows_received',
      'clock_observed',
      'player_commit',
      'journal_rows_received',
      'tx_submitted',
      'journal_rows_received',
    ])
    // provenance is faithful: the FIRST input kept seq 2 and its wall-clock at, wrapped as a session open.
    expect(trace2.capsules[0]).toEqual({
      envelope_version: 1,
      session_id: '0xfeed',
      input_seq: 2,
      observed_at_ms: 1784654951988,
      payload: { kind: 'session_opened', fight_id: '0xfeed', my_key: null, ctx: { address: '0xabc' } },
    })
    // the receipt carried its version + the whole receipt as journal rows
    expect(trace2.capsules[5].payload).toMatchObject({
      kind: 'journal_rows_received',
      source: 'receipt',
      version: 101,
    })
    // the historical `journal` type took its source from the batch
    expect(trace2.capsules[7].payload).toMatchObject({ kind: 'journal_rows_received', source: 'journal' })
  })

  test('provenance flags document the legacy-capture unknowables (digest, arrival timing)', () => {
    expect(trace2.flags.converted_from).toBe('trace_format-1')
    expect(trace2.flags.source_file).toBe('aresrpg-fight-trace-0xfeed-1784655007603.json')
    expect(trace2.flags.notes.join(' ')).toContain('digest')
    expect(trace2.flags.notes.join(' ')).toContain('arrival')
  })

  test('kind_tally counts payload kinds', () => {
    expect(kind_tally(trace2)).toMatchObject({ journal_rows_received: 3, session_opened: 1, tx_submitted: 1 })
  })
})

// The committed corpus is test data the V2 core must replay green — this guards it: every capsule file is
// a well-formed format-2 dump of known-kind envelopes with its provenance intact (append-only, rider R4).
describe('capsule corpus — the converted historical fixtures', () => {
  const files = existsSync(CAPSULES_DIR) ? readdirSync(CAPSULES_DIR).filter((f) => f.endsWith('.capsule.json')) : []

  test('the corpus exists (the recorder tee has a body of real sessions to replay)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  test('every capsule is a valid format-2 dump of known-kind envelopes with provenance', () => {
    const KNOWN_KINDS = new Set([
      'journal_rows_received',
      'tx_submitted',
      'tx_refused',
      'tx_status',
      'player_draft',
      'player_commit',
      'clock_observed',
      'lifecycle',
      'session_opened',
      'session_closed',
    ])
    for (const f of files) {
      const dump = JSON.parse(readFileSync(join(CAPSULES_DIR, f), 'utf8'))
      expect(dump.trace_format).toBe(2)
      expect(dump.envelope_version).toBe(1)
      expect(dump.flags.converted_from).toBe('trace_format-1')
      expect(Array.isArray(dump.capsules)).toBe(true)
      expect(dump.capsules.length).toBeGreaterThan(0)
      for (const env of dump.capsules) {
        expect(env.envelope_version).toBe(1)
        expect(typeof env.input_seq).toBe('number')
        expect(KNOWN_KINDS.has(env.payload.kind)).toBe(true)
        // no capsule fell through to the unknown fallback — every historical type is mapped
        expect(env.payload.phase).not.toBe('unknown')
      }
    }
  })
})
