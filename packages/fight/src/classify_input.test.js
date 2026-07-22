// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { classify_input, KNOWN_INPUT_TYPES } from './classify_input.js'

// classify_input is the ONE bridge the tee and the converter share. These pin the door-message → union
// mapping using REAL message shapes lifted from the captured historical corpus (aresrpg-fight-trace-*).
describe('classify_input — chain reads → journal_rows_received', () => {
  test('a receipt carries source + version + the whole receipt as rows', () => {
    const receipt = { effects: { status: { status: 'success' } }, objectChanges: [], events: [{ type: 'Moved' }] }
    const payload = classify_input({ type: 'receipt', receipt, version: 948087796, fight_id: '0x1db4' })
    expect(payload).toEqual({
      kind: 'journal_rows_received',
      source: 'receipt',
      fight_id: '0x1db4',
      version: 948087796,
      rows: receipt,
    })
  })

  test('a snapshot carries the decoded fight object as rows', () => {
    const fight = { id: '0x1db4', board: {}, fighters: [] }
    const payload = classify_input({ type: 'snapshot', fight, version: 42, fight_id: '0x1db4' })
    expect(payload.kind).toBe('journal_rows_received')
    expect(payload.source).toBe('snapshot')
    expect(payload.rows).toBe(fight)
  })

  test('poll and p2p (courtesy) map to their own source labels', () => {
    expect(classify_input({ type: 'poll', events: [], version: 1 }).source).toBe('poll')
    expect(classify_input({ type: 'p2p', events: [], version: 1 }).source).toBe('p2p')
  })

  test('the historical `journal` type takes its source from the batch', () => {
    const payload = classify_input({ type: 'journal', fight_id: '0x3f6', batch: { source: 'journal', head: 7 } })
    expect(payload.kind).toBe('journal_rows_received')
    expect(payload.source).toBe('journal')
    expect(payload.rows).toEqual({ source: 'journal', head: 7 })
  })
})

describe('classify_input — tx submit / refuse / status', () => {
  test('busy true is a submit', () => {
    expect(classify_input({ type: 'busy', value: true, latch: null })).toEqual({ kind: 'tx_submitted', phase: 'busy' })
  })

  test('busy false clears in-flight (status)', () => {
    expect(classify_input({ type: 'busy', value: false, latch: null })).toEqual({
      kind: 'tx_status',
      phase: 'busy',
      busy: false,
      latch: null,
    })
  })

  test('a busy latch is an EXECUTED failure — the digest is preserved, marked never-retry', () => {
    const payload = classify_input({
      type: 'busy',
      value: false,
      latch: { turn_key: '0x1@e@9', digest: 'BuRnEd', at: 1 },
    })
    expect(payload).toEqual({
      kind: 'tx_refused',
      phase: 'busy',
      reason: 'executed_failure',
      digest: 'BuRnEd',
      turn_key: '0x1@e@9',
    })
  })

  test('settlement_outcome routes by verdict', () => {
    expect(classify_input({ type: 'settlement_outcome', verdict: 'executed_failure', signal: 's' }).kind).toBe(
      'tx_refused'
    )
    expect(classify_input({ type: 'settlement_outcome', verdict: 'opened', signal: 's' }).kind).toBe('tx_status')
  })
})

describe('classify_input — drafts, commits, clock, session', () => {
  test('arm / board_click / stage / hand_update are drafts with their kind', () => {
    expect(classify_input({ type: 'arm', spell_id: 'warcleave' })).toEqual({
      kind: 'player_draft',
      draft_kind: 'arm',
      spell_id: 'warcleave',
    })
    expect(classify_input({ type: 'board_click', cell: null, targetable: false }).draft_kind).toBe('board_click')
    expect(classify_input({ type: 'stage', intent: { kind: 1 } }).draft_kind).toBe('stage')
    expect(classify_input({ type: 'hand_update', hand: ['a'] }).draft_kind).toBe('hand_update')
  })

  test('intent and predicted are commits; drop_traps/rollback are commit reversals', () => {
    expect(classify_input({ type: 'intent', intent: { kind: 'Placed', cell: 7 } })).toEqual({
      kind: 'player_commit',
      commit_kind: 'intent',
      intent: { kind: 'Placed', cell: 7 },
    })
    expect(classify_input({ type: 'predicted', intent_id: 'cast:1', actions: [] }).commit_kind).toBe('predicted')
    expect(classify_input({ type: 'drop_traps', cells: [6] })).toEqual({
      kind: 'player_commit',
      commit_kind: 'drop_traps',
      cells: [6],
    })
    expect(classify_input({ type: 'rollback' }).commit_kind).toBe('rollback')
  })

  test('tick is the clock; init opens/closes a session', () => {
    expect(classify_input({ type: 'tick' })).toEqual({ kind: 'clock_observed' })
    expect(classify_input({ type: 'init', fight_id: '0x1', my_key: null }).kind).toBe('session_opened')
    expect(classify_input({ type: 'init', fight_id: null }).kind).toBe('session_closed')
  })
})

describe('classify_input — totality', () => {
  test('an unknown type never drops — it lands as lifecycle unknown, tagged with the type', () => {
    expect(classify_input({ type: 'some_future_input' })).toEqual({
      kind: 'lifecycle',
      phase: 'unknown',
      type: 'some_future_input',
    })
  })

  test('every KNOWN type is recognized — never the unknown fallback', () => {
    const is_unknown = (p) => p.kind === 'lifecycle' && p.phase === 'unknown'
    for (const type of KNOWN_INPUT_TYPES) expect(is_unknown(classify_input({ type }))).toBe(false)
    // ctx/presented ARE lifecycle, but a NAMED phase — not the unknown fallback.
    expect(classify_input({ type: 'ctx', ctx: {} })).toEqual({ kind: 'lifecycle', phase: 'ctx', ctx: {} })
    expect(classify_input({ type: 'presented', seq: 1 })).toEqual({ kind: 'lifecycle', phase: 'presented', seq: 1 })
  })
})
