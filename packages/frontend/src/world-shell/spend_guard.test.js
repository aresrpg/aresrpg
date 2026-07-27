// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1262 SPEND GUARD — the burn law, executable. Each gate gets its RED behaviour asserted against the pure core
// (no clock, no network, no wallet: `now` and `jitter` are injected), plus the ledger door's transition notices.
//   ① an EXECUTED failure (a digest = gas burned) blocks the SECOND automated submission of that intent, forever
//   ② a PRE-EXECUTION refusal (no digest) backs off on the asserted 1s→2s→…→60s schedule and resets on success
//   ③ automated gas accrues; past the ceiling ALL automated submissions freeze while user acts stay allowed
// The one behaviour that must NOT regress: a player-initiated act is never refused by this module.

import { beforeEach, describe, expect, it } from 'bun:test'

import { attach_executed_digest } from './tx_digest_error.js'
import {
  ASSUMED_TX_GAS_MIST,
  AUTOMATED_SPEND_CEILING_MIST,
  BACKOFF_CAP_MS,
  backoff_delay_ms,
  classify_submission_error,
  empty_spend_ledger,
  net_gas_mist,
  note_executed_failure,
  note_preflight_refusal,
  note_success,
  reset_spend_guard,
  session_frozen,
  settled_gas_mist,
  spend_decision,
  spend_guard_admit,
  spend_guard_record_failure,
  spend_guard_record_success,
  spend_guard_state,
} from './spend_guard.js'

const FIGHT = '0xb294e4fc'
const INTENT = `advance_turn:${FIGHT}`
const automated = { intent: INTENT, automated: true }

/** The #1262 error shape: a finality/abort failure stamped with the digest that proves gas was already burned. */
const executed_failure = (digest = '0xdead') => attach_executed_digest(new Error('Transaction failed'), digest)
/** A pre-execution refusal: the dry-run guard refused, nothing was signed, no digest exists. */
const preflight_refusal = () => Object.assign(new Error('simulate failed'), { name: 'SimulationError' })

describe('① per-intent circuit — an executed failure is never auto-retried', () => {
  it('blocks the SECOND automated submission of an intent whose first attempt EXECUTED and failed', () => {
    const before = empty_spend_ledger()
    expect(spend_decision(before, automated).allow).toBe(true)

    const after = note_executed_failure(before, { intent: INTENT, digest: '0xdead', automated: true })
    const verdict = spend_decision(after, automated)

    expect(verdict.allow).toBe(false)
    expect(verdict.reason).toBe('circuit_open')
    expect(verdict.digest).toBe('0xdead')
  })

  it('stays open for the whole session — no clock reopens it', () => {
    const latched = note_executed_failure(empty_spend_ledger(), { intent: INTENT, digest: '0xdead' })
    const a_day_later = spend_decision(latched, { ...automated, now: Date.now() + 86_400_000 })
    expect(a_day_later.allow).toBe(false)
  })

  it('is scoped to the intent — a DIFFERENT fight is untouched', () => {
    const latched = note_executed_failure(empty_spend_ledger(), { intent: INTENT, digest: '0xdead' })
    expect(spend_decision(latched, { intent: 'advance_turn:0xother', automated: true }).allow).toBe(true)
  })

  it('never blocks the player: the same latched intent stays allowed when user-initiated', () => {
    const latched = note_executed_failure(empty_spend_ledger(), { intent: INTENT, digest: '0xdead' })
    expect(spend_decision(latched, { intent: INTENT, automated: false }).allow).toBe(true)
  })

  it('classifies by the DIGEST, never by message text (the heuristic #1262 died on)', () => {
    expect(classify_submission_error(executed_failure('0xabc'))).toEqual({ kind: 'executed', digest: '0xabc' })
    // No digest: nothing executed, whatever the prose says — a latch here would disarm automation on a wifi blip.
    expect(classify_submission_error(new Error('MoveAbort in turns::crank'))).toEqual({ kind: 'refused' })
    expect(classify_submission_error(preflight_refusal())).toEqual({ kind: 'refused' })
  })
})

describe('② pre-execution refusals — exponential backoff with jitter, per intent', () => {
  it('doubles 1s → 60s and then holds at the cap', () => {
    const schedule = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((attempt) => backoff_delay_ms(attempt))
    expect(schedule).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000])
    expect(backoff_delay_ms(99)).toBe(BACKOFF_CAP_MS)
  })

  it('adds up to +25% jitter on top of the schedule, never below it', () => {
    expect(backoff_delay_ms(3, 0)).toBe(4_000)
    expect(backoff_delay_ms(3, 0.5)).toBe(4_500)
    expect(backoff_delay_ms(3, 0.999)).toBeLessThanOrEqual(5_000)
    expect(backoff_delay_ms(3, 0.999)).toBeGreaterThan(4_000)
  })

  it('holds the intent until its retry instant, then lets it through', () => {
    const held = note_preflight_refusal(empty_spend_ledger(), { intent: INTENT, now: 10_000 })
    expect(spend_decision(held, { ...automated, now: 10_999 })).toMatchObject({
      allow: false,
      reason: 'backoff',
      retry_at_ms: 11_000,
    })
    expect(spend_decision(held, { ...automated, now: 11_000 }).allow).toBe(true)
  })

  it('escalates per consecutive refusal and RESETS on a success', () => {
    const once = note_preflight_refusal(empty_spend_ledger(), { intent: INTENT, now: 0 })
    const twice = note_preflight_refusal(once, { intent: INTENT, now: 0 })
    expect(twice.backoff[INTENT]).toEqual({ attempts: 2, retry_at_ms: 2_000 })

    const landed = note_success(twice, { intent: INTENT })
    expect(landed.backoff[INTENT]).toBeUndefined()
    expect(note_preflight_refusal(landed, { intent: INTENT, now: 0 }).backoff[INTENT].retry_at_ms).toBe(1_000)
  })

  it('burns nothing: a refusal never accrues to the session spend ledger', () => {
    const refused = note_preflight_refusal(empty_spend_ledger(), { intent: INTENT, now: 0 })
    expect(refused.automated_spend_mist).toBe(0n)
  })
})

describe('③ session automated-spend breaker', () => {
  it('freezes EVERY automated intent once the ceiling is reached', () => {
    const spent = note_success(empty_spend_ledger(), {
      intent: INTENT,
      automated: true,
      gas_mist: AUTOMATED_SPEND_CEILING_MIST,
    })
    expect(session_frozen(spent)).toBe(true)
    expect(spend_decision(spent, { intent: 'force_start:0xother', automated: true })).toMatchObject({
      allow: false,
      reason: 'session_frozen',
    })
  })

  it('leaves user-initiated acts alone while frozen', () => {
    const spent = note_success(empty_spend_ledger(), {
      intent: INTENT,
      automated: true,
      gas_mist: AUTOMATED_SPEND_CEILING_MIST,
    })
    expect(spend_decision(spent, { intent: INTENT, automated: false }).allow).toBe(true)
  })

  it('accrues AUTOMATED spend only — a player act is the player spending on purpose', () => {
    const after_user = note_success(empty_spend_ledger(), { intent: INTENT, gas_mist: 9_000_000n })
    expect(after_user.automated_spend_mist).toBe(0n)
    const after_auto = note_success(after_user, { intent: INTENT, automated: true, gas_mist: 9_000_000n })
    expect(after_auto.automated_spend_mist).toBe(9_000_000n)
  })

  it('accrues an executed FAILURE too — a digest means the gas left the wallet', () => {
    const burned = note_executed_failure(empty_spend_ledger(), { intent: INTENT, digest: '0xd', automated: true })
    expect(burned.automated_spend_mist).toBe(ASSUMED_TX_GAS_MIST)
  })

  it('measures real gas off either receipt shape the lane can resolve with', () => {
    const gas_used = { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' }
    expect(net_gas_mist(gas_used)).toBe(2_500_000n)
    expect(settled_gas_mist({ gasUsed: gas_used })).toBe(2_500_000n) // dungeon_actions' sign()
    expect(settled_gas_mist({ result: { gasUsed: gas_used } })).toBe(2_500_000n) // tx.js's run()
    expect(settled_gas_mist(undefined)).toBe(0n)
  })
})

describe('the ledger door — transitions surface once, as data', () => {
  beforeEach(reset_spend_guard)

  it('#1262 END TO END: the second automated advance of a burned intent never reaches the wallet', () => {
    expect(spend_guard_admit(automated).allow).toBe(true)
    const first = spend_guard_record_failure(executed_failure('0xburn'), automated)
    expect(first).toEqual({ kind: 'executed', notice: { i18n_key: 'errors.spend_guard_circuit_open' } })

    expect(spend_guard_admit(automated)).toMatchObject({ allow: false, reason: 'circuit_open', digest: '0xburn' })
    expect(spend_guard_admit({ intent: INTENT, automated: false }).allow).toBe(true)
  })

  it('says its piece ONCE — a refusing loop never re-toasts', () => {
    spend_guard_record_failure(executed_failure(), automated)
    expect(spend_guard_record_failure(executed_failure(), automated).notice).toBeNull()
  })

  it('a pre-execution refusal is machinery — it backs off without a word to the player', () => {
    const recorded = spend_guard_record_failure(preflight_refusal(), automated)
    expect(recorded).toEqual({ kind: 'refused', notice: null })
    expect(spend_guard_admit(automated)).toMatchObject({ allow: false, reason: 'backoff' })
  })

  it('trips the breaker loudly, exactly once, and freezes what follows', () => {
    const gas_used = { computationCost: String(AUTOMATED_SPEND_CEILING_MIST), storageCost: '0', storageRebate: '0' }
    expect(spend_guard_record_success({ gasUsed: gas_used }, automated)).toEqual({
      notice: { i18n_key: 'errors.spend_guard_session_frozen' },
    })
    expect(session_frozen(spend_guard_state())).toBe(true)
    expect(spend_guard_admit({ intent: 'crank:0xelse', automated: true })).toMatchObject({
      allow: false,
      reason: 'session_frozen',
    })
    // already frozen — the next landing does not shout again
    expect(spend_guard_record_success({ gasUsed: gas_used }, automated).notice).toBeNull()
  })
})
