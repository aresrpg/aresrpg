// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1136 — OWNER LIVE REPORT: "fight was progressing normally, then a cast returned 'The fight is no longer
// active.'" Discriminator ① was CONFIRMED by machine on the #1178 parity lane: world fight 0x46af229c had been
// SETTLED ON CHAIN — the Fight object was already DELETED — while the client never folded the terminal and sat
// waiting until stall. So the abort is not a failed cast: it is the chain telling this client, in the only
// channel left, that the session it is still rendering does not exist.
//
// The bug was that the client had NO WAY TO HEAR IT. `actions::101 ENotActive` reached exactly one consumer —
// the copy layer — and stopped there, so the board stayed mounted behind a red toast. This pins the classifier
// that makes the abort EVIDENCE: structural (module + code), never message text, and never a text match on a
// Move constant's NAME (that name is not in the receipt — the W3 root the whole abort layer is built around).
//
// RED-FIRST: `is_fight_over_abort` did not exist; the chain's terminal proof had no reader.

import { describe, expect, test } from 'bun:test'

import { humanize_abort, is_fight_over_abort, parse_move_abort } from '../../../src/game/core/abort_copy.js'
import i18n from '../../../src/i18n'

/** The EXACT gRPC Core structured error shape `run_tx` hands the abort layer (abort_copy.test.js's vector). */
const grpc_abort = (module, code) => ({
  $kind: 'MoveAbort',
  message: `MoveAbort in 2nd command, abort code: ${code}, in '0x2476::${module}::act' (instruction 63)`,
  command: 1,
  MoveAbort: {
    abortCode: String(code),
    location: { package: '0x2476', module, function: 10, instruction: 63, functionName: 'act' },
  },
})

/** The PRE-FLIGHT dry-run refusal form — a simulate that refuses before the wallet ever signs (zero gas). */
const sim_abort = (module, code) =>
  new Error(`SimulationError: transaction failed: abort code ${code} in 0x2476::${module}::begin_action`)

describe('#1136 — an executed "the fight is over" abort is EVIDENCE the session is dead', () => {
  test('101 ENotActive (executed): the chain resolved this fight underneath a live-looking board', () => {
    expect(parse_move_abort(grpc_abort('actions', 101))).toMatchObject({ module: 'actions', code: 101 })
    expect(is_fight_over_abort(grpc_abort('actions', 101))).toBe(true)
  })

  test('101 ENotActive (PRE-FLIGHT simulate): same verdict — the refusal form must not change the reading', () => {
    // the deadline auto-commit's begin_action simulates 101 when a keeper settled the fight first; the client
    // burns no gas there, and the terminal fact is identical.
    expect(is_fight_over_abort(sim_abort('actions', 101))).toBe(true)
  })

  test('105 EFightOver: forfeiting an already-terminal fight is the same proof from the abandon door', () => {
    expect(is_fight_over_abort(grpc_abort('actions', 105))).toBe(true)
  })

  test('the copy layer is UNCHANGED — the abort still reads honestly to the player', () => {
    // the row's complaint was never the sentence; it was that the sentence was the ENTIRE response.
    expect(humanize_abort(grpc_abort('actions', 101))).toBe(i18n.t('errors.fight_not_active'))
  })

  test('NEIGHBOURING actions codes are NOT terminal — a live fight must never be collapsed by a stale board', () => {
    // 104 EIllegalMove (stale board) and 108 ETurnTooFast (min-turn floor) are both recoverable on a LIVE fight;
    // reading either as terminal would tear a healthy session down. 106 EAlreadyDead is a seat fact, not a
    // fight fact — the fight can still be running for everyone else.
    for (const code of [102, 103, 104, 106, 107, 108])
      expect(is_fight_over_abort(grpc_abort('actions', code))).toBe(false)
  })

  test('the same codes in ANOTHER module are not this fight’s terminal — module scoping is load-bearing', () => {
    // `turns::105` is ENotActive on the crank machinery the client auto-fires, `settlement::101` is ENotTerminal —
    // a literal inversion. Only the act doors of `actions` carry this proof.
    expect(is_fight_over_abort(grpc_abort('turns', 101))).toBe(false)
    expect(is_fight_over_abort(grpc_abort('turns', 105))).toBe(false)
    expect(is_fight_over_abort(grpc_abort('settlement', 101))).toBe(false)
  })

  test('a non-abort failure is never terminal proof — transport noise must not close a live fight', () => {
    expect(is_fight_over_abort(new Error('fetch failed'))).toBe(false)
    expect(is_fight_over_abort(null)).toBe(false)
    expect(is_fight_over_abort(undefined)).toBe(false)
  })
})
