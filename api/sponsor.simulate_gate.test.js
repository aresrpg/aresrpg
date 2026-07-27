// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SIMULATE GATE (#1385) — the sponsor must never sponsor a PTB its own dry-run proved would abort.
// Before the gate, reserveSponsored read `gasUsed` off `Transaction ?? FailedTransaction`, so an ABORTING
// simulation was treated as a valid price quote: the sponsor reserved, the station co-signed and SUBMITTED, and
// the player got "executed on chain, gas was spent". That also made the pool grief-able — an attacker could
// burn sponsor SUI all day with PTBs that cannot succeed.
//
//   bun test api/sponsor.simulate_gate.test.js     (no Redis, no fullnode, no station — pure decisions only)
//
// Own process on purpose (like every sibling suite): sponsor state reads REDIS_URL at module load.
//
// PROVENANCE (decode law — a codec test that encodes with the model it decodes with proves nothing): the two
// failure strings below are CAPTURED from real testnet transactions that the missing gate let execute, quoted
// byte-for-byte from their on-chain effects:
//   DWB7m5GMAZ8XufziYiXciTntozg7TgTxFdWFT1Pg6GNq — 2026-07-27T17:00:57Z, sponsored, MoveAbort turns::crank 107
//   342GRnWK69pqPTUjNJFU8LDQ4Ms1xYfbLdh9XE164Bey — 2026-07-27T21:24:21Z, sponsored, InputObjectDeleted

import { describe, expect, test } from 'bun:test'

// The client's verdict for the SAME question, imported from the frontend so a future divergence between the two
// homes fails a test instead of shipping (the sponsor image can't import it — see simulation_abort_error's jsdoc).
import { gas_guard_decision } from '../packages/frontend/src/game/core/gas_guard.js'

process.env.REDIS_URL = ''
process.env.GAS_STATION_URL ||= 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH ||= 'test-bearer'
const S = await import('./sponsor.mjs')

const MOVE_ABORT_CRANK_107 =
  'MoveAbort(MoveLocation { module: ModuleId { address: ' +
  'e8c6c46893799e85e697ef0e524626c6323ea4db5a86da6c9de4a6d53c7ac41a, name: Identifier("turns") }, function: 6, ' +
  'instruction: 36, function_name: Some("crank") }, 107) in command 0'
const INPUT_OBJECT_DELETED = 'InputObjectDeleted'

const gas_used = { computationCost: '1270000', storageCost: '22359200', storageRebate: '22135608' }
const ok_sim = { $kind: 'Transaction', Transaction: { effects: { status: { success: true }, gasUsed: gas_used } } }
const failed_tagged = (error) => ({
  $kind: 'FailedTransaction',
  FailedTransaction: { effects: { status: { success: false, error }, gasUsed: gas_used } },
})
// The same abort WITHOUT the union tag — a transport/version that reports status only. Untagged failures are the
// exact shape that slips a naive `?.Transaction` read, so both homes must catch it.
const failed_untagged = (error) => ({
  $kind: 'Transaction',
  Transaction: { effects: { status: { success: false, error }, gasUsed: gas_used } },
})

describe('simulation_abort_error — a would-abort simulation is a REFUSAL, never a price quote', () => {
  test('a tagged FailedTransaction returns the chain error verbatim (real captured MoveAbort)', () => {
    expect(S.simulation_abort_error(failed_tagged(MOVE_ABORT_CRANK_107))).toBe(MOVE_ABORT_CRANK_107)
  })

  test('an untagged status.success === false is refused too (real captured InputObjectDeleted)', () => {
    expect(S.simulation_abort_error(failed_untagged(INPUT_OBJECT_DELETED))).toBe(INPUT_OBJECT_DELETED)
  })

  test('a failure with no error string still refuses (never sponsor an unexplained failure)', () => {
    expect(S.simulation_abort_error(failed_tagged(undefined))).toBe('simulation reported failure')
  })

  test('no effects at all refuses — we learned nothing, so we sponsor nothing', () => {
    for (const nothing of [null, undefined, {}, { $kind: 'Transaction', Transaction: {} }])
      expect(S.simulation_abort_error(nothing)).toBe('simulation returned no effects')
  })

  test('a passing simulation is NOT refused (the gate must not break sponsorship)', () => {
    expect(S.simulation_abort_error(ok_sim)).toBeNull()
  })
})

describe('the refusal reaches the client as a MACHINE reason, not localized prose', () => {
  test('a would-abort refusal carries reason "would-abort" and the chain error in the message', () => {
    const error = new Error(`${S.WOULD_ABORT_ERROR_PREFIX} ${MOVE_ABORT_CRANK_107}`)
    const body = S.sponsor_error_response(error)
    expect(body.reason).toBe(S.WOULD_ABORT_REASON)
    expect(body.error).toContain(MOVE_ABORT_CRANK_107)
  })

  test('the pre-existing outdated-package reason still rides back (no regression on the other marker)', () => {
    const error = new Error('sponsor-scope: outdated-package: MoveCall targets retired package 0xdead::x::y')
    expect(S.sponsor_error_response(error).reason).toBe('outdated-package')
  })

  test('an ordinary refusal carries NO reason (callers must not branch on it)', () => {
    expect(S.sponsor_error_response(new Error('rate-limited: too many sponsorships')).reason).toBeUndefined()
  })

  test('the daily stats expose an `abort` refusal counter (the issue acceptance reads it)', () => {
    expect(S.sponsor_stats().refused).toHaveProperty('abort')
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLASS GATE. "Would this PTB abort?" is ONE question with two implementations — the sponsor's (server,
// pre-sponsorship) and the client's gas_guard (browser, pre-signature). They are not allowed to disagree: the
// whole bug was one of them answering "no" where the other answers "yes". Any future edit to either that changes
// a verdict reddens here.
describe('PARITY: the sponsor gate and the client gas_guard classify the same simulation identically', () => {
  const corpus = [
    ['passing', ok_sim],
    ['tagged MoveAbort', failed_tagged(MOVE_ABORT_CRANK_107)],
    ['untagged MoveAbort', failed_untagged(MOVE_ABORT_CRANK_107)],
    ['tagged InputObjectDeleted', failed_tagged(INPUT_OBJECT_DELETED)],
    ['untagged InputObjectDeleted', failed_untagged(INPUT_OBJECT_DELETED)],
    ['failure with no error string', failed_tagged(undefined)],
    ['empty result', {}],
    ['null result', null],
  ]
  for (const [name, sim] of corpus)
    test(`${name}: sponsor-refuses === gas_guard sim_failed`, () => {
      expect(S.simulation_abort_error(sim) !== null).toBe(gas_guard_decision(sim).reason === 'sim_failed')
    })
})
