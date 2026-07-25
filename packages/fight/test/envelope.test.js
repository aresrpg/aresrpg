// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  ENVELOPE_VERSION,
  input_envelope,
  journal_rows_received,
  tx_submitted,
  tx_refused,
  tx_status,
  player_draft,
  player_commit,
  clock_observed,
  lifecycle,
  session_opened,
  session_closed,
} from '../src/envelope.js'

// The envelope is a WIRE CONTRACT: a V2 reader keys its decode on `envelope_version`, so the version is
// pinned here — a silent bump breaks every capsule already on disk. These tests are the pin.
describe('envelope — versioning + wrapper shape', () => {
  test('ENVELOPE_VERSION is 1 (bump is a reviewed, visible act)', () => {
    expect(ENVELOPE_VERSION).toBe(1)
  })

  test('input_envelope stamps the version and carries provenance + payload verbatim', () => {
    const payload = clock_observed({ draft_count: 2 })
    const env = input_envelope({ session_id: '0xfeed', input_seq: 7, observed_at_ms: 1784655007603, payload })
    expect(env).toEqual({
      envelope_version: 1,
      session_id: '0xfeed',
      input_seq: 7,
      observed_at_ms: 1784655007603,
      payload,
    })
  })

  test('session_id defaults to null when the capture had no open fight yet', () => {
    const env = input_envelope({ input_seq: 0, observed_at_ms: 0, payload: lifecycle({ phase: 'flush' }) })
    expect(env.session_id).toBeNull()
    expect(env.envelope_version).toBe(ENVELOPE_VERSION)
  })
})

// Every union member is a `kind`-tagged plain record — the discriminator a total fold switches on. A
// constructor OMITS unobserved fields (`undefined`) but KEEPS real `null` observations.
describe('fight_input union — kind tags + honest field omission', () => {
  test('each constructor tags its kind', () => {
    expect(journal_rows_received({ source: 'poll' }).kind).toBe('journal_rows_received')
    expect(tx_submitted({}).kind).toBe('tx_submitted')
    expect(tx_refused({}).kind).toBe('tx_refused')
    expect(tx_status({}).kind).toBe('tx_status')
    expect(player_draft({ draft_kind: 'arm' }).kind).toBe('player_draft')
    expect(player_commit({ commit_kind: 'intent' }).kind).toBe('player_commit')
    expect(clock_observed({}).kind).toBe('clock_observed')
    expect(lifecycle({ phase: 'ctx' }).kind).toBe('lifecycle')
    expect(session_opened({ fight_id: '0x1' }).kind).toBe('session_opened')
    expect(session_closed({}).kind).toBe('session_closed')
  })

  test('journal_rows_received keeps source + rows, omits an unseen version', () => {
    const rows = [{ kind: 'Moved', idx: 4 }]
    expect(journal_rows_received({ source: 'receipt', fight_id: '0xabc', rows })).toEqual({
      kind: 'journal_rows_received',
      source: 'receipt',
      fight_id: '0xabc',
      rows,
    })
  })

  test('tx_refused carries the executed-failure digest (the never-retry audit trail)', () => {
    expect(tx_refused({ reason: 'executed_failure', digest: 'DiGeSt', turn_key: '0x1@e@9' })).toEqual({
      kind: 'tx_refused',
      reason: 'executed_failure',
      digest: 'DiGeSt',
      turn_key: '0x1@e@9',
    })
  })

  test('undefined fields are dropped; a real null is preserved', () => {
    const opened = session_opened({ fight_id: '0x1', my_key: null })
    expect(opened).toEqual({ kind: 'session_opened', fight_id: '0x1', my_key: null })
    expect('ctx' in opened).toBe(false)
  })

  test('player_commit collapses to only the observed commit fields', () => {
    expect(player_commit({ commit_kind: 'drop_traps', cells: [6] })).toEqual({
      kind: 'player_commit',
      commit_kind: 'drop_traps',
      cells: [6],
    })
  })

  test('constructors are pure — same input, structurally equal output, no shared mutation', () => {
    const a = clock_observed({ draft_count: 1, enabled: false })
    const b = clock_observed({ draft_count: 1, enabled: false })
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})
