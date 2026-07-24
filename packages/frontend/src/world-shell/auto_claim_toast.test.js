// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-CLAIM TOAST — #684 ("it's spamming me with tx"): every AUTO-FIRED settlement tx now names itself
// (announce_auto_claim, i18n `fights.claiming_pending_result`) BEFORE it builds — a silent background claim
// reads as malware with no other UI in view. dungeon_settlement.js itself is unloadable headless (pulls the
// SDK/auth/i18n/game-store graph — see dungeon_settlement_auto_settle.test.js's header for the established
// reason); this mirrors the toast-BEFORE-tx ORDERING of its two remaining auto-fire sites 1:1 (the boot sweep's
// per-row open loop + the entry-refusal recovery's open_result door). The THIRD site
// (auto_settle_terminal_fights) already has its own mirror in dungeon_settlement_auto_settle.test.js — extended
// there rather than duplicated here (one home per fact).
import { afterEach, describe, expect, it } from 'bun:test'

import i18n from '../i18n'

import { attempt_state, begin_attempt, end_attempt, reset_attempts_for_test } from './pending_outcomes.js'

afterEach(() => reset_attempts_for_test())

// The real string, read through the real i18n instance — catches a source/locale key typo the mirrors below
// (which only ever see an injected fake) structurally cannot.
it('fights.claiming_pending_result resolves to the honest pre-tx verb (#684)', () => {
  expect(i18n.t('fights.claiming_pending_result')).toBe('Claiming your pending fight result…')
})

/**
 * Mirror of auto_open_pending_outcomes's per-row loop (dungeon_settlement.js, read 2026-07-24): for every row
 * NOT already opened/inflight/latched, announce THEN attempt the open. Eligibility rides the REAL
 * pending_outcomes.js attempt registry (zero fake); `open_pending_row` is injected — it composes+signs a real
 * tx, out of a leaf test's reach.
 * @param {{ map: Map<string, {outcome_id:string}>, open_pending_row: (character_id:string, row:any) => Promise<any>,
 *           announce_claim: () => void }} deps
 */
async function auto_open_loop_mirror({ map, open_pending_row, announce_claim }) {
  for (const [character_id, row] of map) {
    const state = attempt_state(row.outcome_id)
    if (state === 'opened') continue // receipt tombstone outranks a lagging projection row
    if (state) continue // inflight (already opening) or latched (manual-only) — never double-fire
    announce_claim()
    await open_pending_row(character_id, row)
  }
}

describe('auto_open_pending_outcomes per-row loop — announces BEFORE attempting the open (#684)', () => {
  it('a fresh row: announces exactly once, before open_pending_row is called', async () => {
    const events = []
    const map = new Map([['char-1', { outcome_id: 'out-1' }]])
    await auto_open_loop_mirror({
      map,
      open_pending_row: async (character_id, row) => {
        events.push({ kind: 'open', character_id, outcome_id: row.outcome_id })
      },
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([{ kind: 'announce' }, { kind: 'open', character_id: 'char-1', outcome_id: 'out-1' }])
  })

  it('two fresh rows: announces once per row, each strictly before its OWN open', async () => {
    const events = []
    const map = new Map([
      ['char-1', { outcome_id: 'out-1' }],
      ['char-2', { outcome_id: 'out-2' }],
    ])
    await auto_open_loop_mirror({
      map,
      open_pending_row: async (character_id, row) => events.push({ kind: 'open', outcome_id: row.outcome_id }),
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([
      { kind: 'announce' },
      { kind: 'open', outcome_id: 'out-1' },
      { kind: 'announce' },
      { kind: 'open', outcome_id: 'out-2' },
    ])
  })

  it('an already-OPENED row (receipt tombstone): never announces, never re-opens', async () => {
    begin_attempt('out-1')
    end_attempt('out-1', 'opened')
    const events = []
    const map = new Map([['char-1', { outcome_id: 'out-1' }]])
    await auto_open_loop_mirror({
      map,
      open_pending_row: async () => events.push({ kind: 'open' }),
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([]) // no false "claiming…" notice for a result that already landed
  })

  it('a LATCHED row (prior executed failure): never announces — burn law: never re-fire spent gas', async () => {
    begin_attempt('out-1')
    end_attempt('out-1', 'executed_failure')
    const events = []
    const map = new Map([['char-1', { outcome_id: 'out-1' }]])
    await auto_open_loop_mirror({
      map,
      open_pending_row: async () => events.push({ kind: 'open' }),
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([])
  })

  it('an INFLIGHT row (a concurrent detector already owns it): never double-announces', async () => {
    begin_attempt('out-1') // leaves it 'inflight' — no matching end_attempt
    const events = []
    const map = new Map([['char-1', { outcome_id: 'out-1' }]])
    await auto_open_loop_mirror({
      map,
      open_pending_row: async () => events.push({ kind: 'open' }),
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([])
  })
})

/**
 * Mirror of recover_fight_entry_refusal's `open_result` door (dungeon_settlement.js, read 2026-07-24): no
 * signed-in address ⇒ blocked immediately (no tx will ever fire, so no announce); an address ⇒ announce THEN
 * attempt the open. This is the pre-flight `fight::ECharacterMarked` entry-recovery path — the OTHER named
 * auto-fire site (dungeon_settlement.js's boot sweep is mirrored above / in the auto-settle sibling file).
 * @param {{ row: any, get_address: () => string|null, open_pending_row: (row:any) => Promise<any>,
 *           announce_claim: () => void }} deps
 */
async function entry_recovery_open_result_mirror({ row, get_address, open_pending_row, announce_claim }) {
  const address = get_address()
  if (!address) return { status: 'blocked' }
  announce_claim()
  return open_pending_row(row)
}

describe('recover_fight_entry_refusal open_result door — announces BEFORE attempting the open (#684)', () => {
  it('signed in: announces exactly once, before open_pending_row is called', async () => {
    const events = []
    const row = { outcome_id: 'out-1' }
    const result = await entry_recovery_open_result_mirror({
      row,
      get_address: () => '0xplayer',
      open_pending_row: async (r) => {
        events.push({ kind: 'open', outcome_id: r.outcome_id })
        return { status: 'opened', receipt: {} }
      },
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([{ kind: 'announce' }, { kind: 'open', outcome_id: 'out-1' }])
    expect(result).toEqual({ status: 'opened', receipt: {} })
  })

  it('not signed in: blocked immediately — no announce (no tx will ever fire, so no false claim notice)', async () => {
    const events = []
    const result = await entry_recovery_open_result_mirror({
      row: { outcome_id: 'out-1' },
      get_address: () => null,
      open_pending_row: async () => {
        events.push({ kind: 'open' })
        return { status: 'opened' }
      },
      announce_claim: () => events.push({ kind: 'announce' }),
    })
    expect(events).toEqual([])
    expect(result.status).toBe('blocked')
  })
})
