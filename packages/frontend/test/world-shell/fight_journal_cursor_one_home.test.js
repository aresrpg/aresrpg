// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1799 — THE ONE RESUME CURSOR reads the core inbox's delivered seq. The store used to mirror that number onto a
// legacy `accept_state.head` and this walker read the mirror; a fold that advanced the core without re-writing the
// copy would resume the journal from a seq the client had already delivered (or, worse, past a hole).
// Divergence-shaped: a state carrying BOTH homes with different values must resolve to the core's.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

// dungeon_run_store.js pulls the whole SDK/auth/i18n graph, so the browser surface goes up before it loads.
const restore_browser_globals = install_browser_globals({ with_document: true })
const { fight_journal_from } = await import('../../src/world-shell/dungeon_run_store.js')

afterAll(() => restore_browser_globals())

const FIGHT = '0xf19h7'

const state_of = (delivered_seq, extra = {}) => ({
  accept_state: { head: '1', digests: {} }, // the dead mirror, deliberately stale
  core: { inbox: { delivered_seq } },
  journal_gap: null,
  ...extra,
})

describe('#1799 · the journal resume cursor has ONE home', () => {
  test('the cursor follows the core inbox, never a stale accept_state copy', () => {
    expect(fight_journal_from(state_of(7), FIGHT)).toBe('8')
  })

  test('nothing delivered yet resumes from the beginning', () => {
    expect(fight_journal_from(state_of(-1), FIGHT)).toBe('0')
  })

  test('an open contiguity gap for THIS fight still lowers the cursor to the hole', () => {
    expect(fight_journal_from(state_of(7, { journal_gap: { fight_id: FIGHT, from: '3' } }), FIGHT)).toBe('3')
  })

  test('a gap recorded for ANOTHER fight never lowers this fight’s cursor', () => {
    expect(fight_journal_from(state_of(7, { journal_gap: { fight_id: '0xother', from: '3' } }), FIGHT)).toBe('8')
  })
})
