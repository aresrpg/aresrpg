// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #882 ① SETTLE HONESTY — RED-FIRST: the take-7 dead end observed the client reporting `settled=true` while the
// chain still held the Fight object. The rule under test is the one `settle_chain` now calls before it may
// report a landed settlement: a resolved transaction is NOT proof, only chain confirmation is (the receipt's own
// `ResultOpened` id, or a liveness re-read that no longer finds a LIVE Fight).
//
// RED PROOF (captured for the PR): with the pre-fix rule in fight_settle_confirm.js — `settle_verdict` returning
// `{ settled: true }` the moment the tx resolves — the first two rows below fail with
// `expect(received).toBe(false)  Expected: false  Received: true`, which is exactly the reported defect: settled
// reported while the object persists. The leaf is a real import (no mock.module — the process-global law); only
// the chain READ is injected, exactly as production injects it.

import { describe, expect, mock, test } from 'bun:test'

import { receipt_confirms_settlement, settle_verdict } from './fight_settle_confirm.js'

const FIGHT_ID = '0xfight'
const liveness_of = (state) => mock(async () => ({ state }))

describe('settle_verdict — a settlement is reported only when the chain confirms it', () => {
  test('THE DEFECT: the Fight object still LIVES ⇒ unsettled, and the halt is executed (gas burned, never re-fired)', async () => {
    const read_liveness = liveness_of('live')

    const verdict = await settle_verdict({ fight_id: FIGHT_ID, result_id: null, read_liveness })

    expect(verdict.settled).toBe(false)
    expect(verdict.halt).toBe('executed_failure')
    expect(read_liveness).toHaveBeenCalledTimes(1)
    expect(read_liveness.mock.calls[0]).toEqual([FIGHT_ID])
  })

  test('an unreadable chain (the read throws) is NOT confirmation — never settled on hope', async () => {
    const read_liveness = mock(async () => {
      throw new Error('fullnode unavailable (test)')
    })

    expect(await settle_verdict({ fight_id: FIGHT_ID, result_id: null, read_liveness })).toEqual({
      settled: false,
      halt: 'executed_failure',
    })
  })

  test('the receipt ResultOpened id IS chain proof — confirmed with NO extra read', async () => {
    const read_liveness = liveness_of('live')

    expect(await settle_verdict({ fight_id: FIGHT_ID, result_id: '0xresult', read_liveness })).toEqual({
      settled: true,
      halt: null,
    })
    expect(read_liveness).not.toHaveBeenCalled() // the proven path pays nothing for this gate
  })

  test('an unparsed receipt whose Fight is GONE or terminal is confirmed by the re-read (no false failure)', async () => {
    expect(await settle_verdict({ fight_id: FIGHT_ID, result_id: null, read_liveness: liveness_of('absent') })).toEqual(
      { settled: true, halt: null }
    )
    expect(
      await settle_verdict({ fight_id: FIGHT_ID, result_id: null, read_liveness: liveness_of('settled') })
    ).toEqual({ settled: true, halt: null })
  })

  test('no fight id / no reader ⇒ unconfirmed (a verdict is never invented from an absent input)', async () => {
    expect(await settle_verdict({ fight_id: null, result_id: null, read_liveness: liveness_of('absent') })).toEqual({
      settled: false,
      halt: 'executed_failure',
    })
    expect(await settle_verdict({ fight_id: FIGHT_ID })).toEqual({ settled: false, halt: 'executed_failure' })
    expect(await settle_verdict()).toEqual({ settled: false, halt: 'executed_failure' })
  })
})

describe('receipt_confirms_settlement (pure)', () => {
  test('only a real result id counts', () => {
    expect(receipt_confirms_settlement('0xresult')).toBe(true)
    expect(receipt_confirms_settlement('')).toBe(false)
    expect(receipt_confirms_settlement(null)).toBe(false)
    expect(receipt_confirms_settlement(undefined)).toBe(false)
    expect(receipt_confirms_settlement(1)).toBe(false)
  })
})
