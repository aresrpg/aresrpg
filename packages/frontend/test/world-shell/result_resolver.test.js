// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1383 — FIGHT RESULTS RESOLVE THEMSELVES. The live coop finding: a partner's `FightOutcome` (minted by the
// OTHER seat's settle) sat unopened while a toast told him to go look for it. Two defects, one ruling:
//   ① the settle-observed recovery read `/v1/pending-outcomes` ONCE, milliseconds after the settle it lost — the
//      indexer had not ingested that checkpoint yet, the empty answer was read as "nothing pending", and the
//      strand was dropped for the whole session (nothing re-detects: the boot pass fires once per wallet);
//   ② the first failed attempt LATCHED even when it was a ZERO-GAS pre-flight refusal, so a second's lag
//      permanently demoted the reward to a manual press.
// The ruling: dry-run on a backoff (free, unlimited), submit EXACTLY ONCE the moment simulation passes, and let
// an EXECUTED failure open the existing spend-guard circuit — one honest error, zero retries, no toast.
//
// These tests drive the REAL machinery: the real resolver loop, the real attempt registry, the real spend-guard
// ledger and the real toast home. Only the chain door is a fake — and it is a faithful one (the S-54 tx gate
// dry-runs, refuses at zero gas, and only then submits), so the assertions below are about production behavior.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  resolve_pending_results,
  resolver_continues,
  result_is_stuck,
  row_is_resolvable,
  reset_resolver_for_test,
  RESOLVER_MAX_TICKS,
  RESOLVER_STUCK_REFUSALS,
} from '../../src/world-shell/result_resolver.js'
import {
  run_result_auto_open,
  attempt_state,
  result_open_intent,
  reset_attempts_for_test,
} from '../../src/world-shell/pending_outcomes.js'
import {
  spend_guard_admit,
  spend_guard_record_failure,
  spend_guard_record_success,
  spend_guard_attempts,
  spend_guard_circuit_open,
  spend_decision,
  note_preflight_refusal,
  backoff_delay_ms,
  empty_spend_ledger,
  reset_spend_guard,
} from '../../src/world-shell/spend_guard.js'
import { tx_error } from '../../src/game/core/abort_copy.js'
import { event_toast_store, push_event_toast } from '../../src/game/core/toast.js'
import i18n from '../../src/i18n'

const OUTCOME = '0xoutcome-1383' // deliberately NOT a 32-byte id: nothing here talks to a chain
const ADDRESS = '0xwallet-1383'
const INTENT = result_open_intent(OUTCOME)

/** Every toast pushed while a run is driven — the REAL event-toast home, subscribed like the HUD does. */
function record_toasts() {
  const titles = []
  const stop = event_toast_store.subscribe(() => {
    const stack = event_toast_store.get()
    titles.push(stack[stack.length - 1]?.title ?? '')
  })
  return { titles, stop }
}

/**
 * The chain door, modelled exactly as production composes it: admission through the spend guard (circuit /
 * backoff / session breaker), then a DRY RUN, then — only if the dry run passes — ONE submission. Both verdicts
 * re-enter the guard's ledger and its returned notice is rendered through the one toast home, precisely as
 * world-shell/tx.js does.
 * @param {{ simulation_passes: () => boolean, submission: () => { digest?: string } | Error }} chain
 */
function open_door(chain) {
  const counts = { attempts: 0, simulations: 0, submissions: 0 }
  const door = async () => {
    counts.attempts += 1
    const admission = spend_guard_admit({ intent: INTENT, automated: true })
    // The lane rejects before ANY bytes are built — zero gas, and (no digest) a retryable refusal upstream.
    if (!admission.allow) return { status: 'failed', error: new Error(`spend guard: ${admission.reason}`) }
    counts.simulations += 1
    if (!chain.simulation_passes()) {
      // The S-54 gate's own refusal: `preflight: true` stamps the zero-gas provenance on the error.
      const refusal = tx_error({ $kind: 'MoveAbort', MoveAbort: { abortCode: '111' } }, { preflight: true })
      surface(spend_guard_record_failure(refusal, { intent: INTENT, automated: true }).notice)
      return { status: 'failed', error: refusal }
    }
    counts.submissions += 1
    const submitted = chain.submission()
    if (submitted instanceof Error) {
      surface(spend_guard_record_failure(submitted, { intent: INTENT, automated: true }).notice)
      return { status: 'failed', error: submitted }
    }
    surface(spend_guard_record_success(submitted, { intent: INTENT, automated: true }).notice)
    return { status: 'opened', receipt: submitted }
  }
  return { door, counts }
}

const surface = (notice) => {
  if (!notice) return
  push_event_toast({ state: 'error', title: i18n.t(notice.i18n_key) })
}

/** ONE sweep of the projection — the same verdict `auto_open_pending_outcomes` applies, from its one home. */
function sweep(rows, door) {
  return async () => {
    const ids = rows()
    let unresolved = 0
    for (const outcome_id of ids) {
      const resolvable = () =>
        row_is_resolvable({
          attempt: attempt_state(outcome_id),
          circuit_open: spend_guard_circuit_open(result_open_intent(outcome_id)),
        })
      if (!resolvable()) continue
      await run_result_auto_open(outcome_id, door)
      if (resolvable()) unresolved += 1
    }
    return { rows: ids.length, pending: unresolved }
  }
}

const instant = async () => {} // the loop's schedule is asserted purely below; the driven runs never wait

// The bun test process is long-lived and SHARED across files: reset both module-owned ledgers on BOTH edges,
// so neither a sibling file's leftovers nor ours can make a run pass or fail for the wrong reason.
const isolate = () => {
  reset_attempts_for_test()
  reset_resolver_for_test()
  reset_spend_guard()
}
beforeEach(isolate)
afterEach(isolate)

describe('#1383 ② — the happy path: a settled result opens itself, exactly once, silently', () => {
  it('a passing simulation submits EXACTLY ONCE and the loop stops — zero toasts, zero user action', async () => {
    const { door, counts } = open_door({
      simulation_passes: () => true,
      submission: () => ({
        digest: '0xlanded',
        gasUsed: { computationCost: '1000', storageCost: '0', storageRebate: '0' },
      }),
    })
    const toasts = record_toasts()
    const verdict = await resolve_pending_results(
      ADDRESS,
      sweep(() => [OUTCOME], door),
      { sleep: instant }
    )
    toasts.stop()

    expect(counts.submissions).toBe(1)
    expect(counts.simulations).toBe(1)
    expect(attempt_state(OUTCOME)).toBe('opened')
    expect(verdict).toEqual({ ticks: 1, pending: 0 }) // one tick, clean — it never polls on
    expect(toasts.titles).toEqual([]) // the XP/loot beat is land_outcome's; this machinery says NOTHING
  })

  it('THE COOP DEFECT: an empty projection is INDEXER LAG when a settle proved an outcome is owed', async () => {
    // The partner's client re-reads /v1 milliseconds after losing the settle race. The row is not there YET.
    // The old one-shot recovery called that "clean" and gave up forever; the loop waits for it.
    let reads = 0
    const rows = () => (++reads < 4 ? [] : [OUTCOME]) // the indexer catches up on the 4th read
    const { door, counts } = open_door({ simulation_passes: () => true, submission: () => ({ digest: '0xlanded' }) })
    const verdict = await resolve_pending_results(ADDRESS, sweep(rows, door), { await_row: true, sleep: instant })

    expect(reads).toBe(4)
    expect(counts.submissions).toBe(1) // it opened the moment the row appeared — no user action, no second tx
    expect(verdict.pending).toBe(0)
  })

  it('without a settle to prove one is owed, an empty projection stops the loop on the first read (never a poller)', async () => {
    let reads = 0
    const { door } = open_door({ simulation_passes: () => true, submission: () => ({ digest: '0x' }) })
    const verdict = await resolve_pending_results(
      ADDRESS,
      sweep(() => {
        reads += 1
        return []
      }, door),
      { sleep: instant }
    )
    expect(reads).toBe(1)
    expect(verdict).toEqual({ ticks: 1, pending: 0 })
  })
})

describe('#1383 ② — a simulation that keeps failing: free retries, NO submission, then the badge', () => {
  it('persistent dry-run refusals never submit, and the loop re-simulates for its whole budget', async () => {
    const { door, counts } = open_door({
      simulation_passes: () => false, // the open would abort — refused BEFORE signing, zero gas, every time
      submission: () => {
        throw new Error('unreachable: a refused simulation must never submit')
      },
    })
    const toasts = record_toasts()
    const verdict = await resolve_pending_results(
      ADDRESS,
      sweep(() => [OUTCOME], door),
      { sleep: instant }
    )
    toasts.stop()

    expect(counts.submissions).toBe(0) // THE MONEY LAW: a refused simulation costs nothing and sends nothing
    expect(counts.attempts).toBe(RESOLVER_MAX_TICKS) // …and it kept trying, every tick, for free
    // The guard holds the later attempts on its own wall-clock backoff (this run compresses the loop's sleeps
    // but not Date.now()), which is exactly the pacing the pure test below asserts on the real schedule.
    expect(counts.simulations).toBeGreaterThanOrEqual(1)
    expect(verdict.ticks).toBe(RESOLVER_MAX_TICKS) // bounded: it gives up, it does not poll forever
    expect(attempt_state(OUTCOME)).toBe('refused') // NOT latched — a later signal may still resolve it
    expect(toasts.titles).toEqual([]) // backoff is machinery and never speaks
  })

  it('the badge appears only once the refusals are PERSISTENT — a lagging indexer never flashes a button', () => {
    // Driven on the guard's own pure ledger with an injected clock: the real schedule, deterministically.
    let ledger = empty_spend_ledger()
    let now = 0
    const stuck_at = []
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(spend_decision(ledger, { intent: INTENT, automated: true, now }).allow).toBe(true)
      ledger = note_preflight_refusal(ledger, { intent: INTENT, now })
      stuck_at.push(result_is_stuck({ attempt: 'refused', refusals: ledger.backoff[INTENT].attempts }))
      now += backoff_delay_ms(attempt) // the guard holds the next automated attempt exactly this long
    }
    expect(stuck_at).toEqual([false, false, true, true, true]) // silent while lagging, offered once stuck
    expect(RESOLVER_STUCK_REFUSALS).toBe(3)
    expect(now).toBe(1_000 + 2_000 + 4_000 + 8_000 + 16_000) // free retries on a doubling schedule
  })

  it('a result being worked on is never stuck: an inflight or opened attempt renders no badge', () => {
    expect(result_is_stuck({ attempt: 'inflight', refusals: 0 })).toBe(false)
    expect(result_is_stuck({ attempt: 'opened', refusals: 99 })).toBe(true) // guard says stuck…
    expect(row_is_resolvable({ attempt: 'opened' })).toBe(false) // …but an opened row is never attempted again
  })
})

describe('#1383 ② — an EXECUTED failure: one honest error, zero retries, ever', () => {
  it('a digest means gas burned: the circuit opens, ONE toast fires, and nothing is ever re-submitted', async () => {
    const executed = Object.assign(new Error('results::open aborted on chain'), { digest: '0xburned' })
    const { door, counts } = open_door({ simulation_passes: () => true, submission: () => executed })
    const toasts = record_toasts()
    const verdict = await resolve_pending_results(
      ADDRESS,
      sweep(() => [OUTCOME], door),
      { sleep: instant }
    )
    toasts.stop()

    expect(counts.submissions).toBe(1) // exactly one — the burn law's whole point
    expect(attempt_state(OUTCOME)).toBe('latched')
    expect(spend_guard_circuit_open(INTENT)).toBe(true)
    expect(toasts.titles).toEqual([i18n.t('errors.spend_guard_circuit_open')]) // ONE honest error
    expect(verdict.pending).toBe(0) // stuck ⇒ the loop stops and the badge takes over
  })

  it('a later arming does not re-submit a burned open — the circuit refuses it before any bytes are built', async () => {
    const executed = Object.assign(new Error('results::open aborted on chain'), { digest: '0xburned' })
    const { door, counts } = open_door({ simulation_passes: () => true, submission: () => executed })
    await resolve_pending_results(
      ADDRESS,
      sweep(() => [OUTCOME], door),
      { sleep: instant }
    )
    reset_resolver_for_test()
    const toasts = record_toasts()
    await resolve_pending_results(
      ADDRESS,
      sweep(() => [OUTCOME], door),
      { await_row: true, sleep: instant }
    )
    toasts.stop()

    expect(counts.submissions).toBe(1) // still one, across two full armings
    expect(counts.simulations).toBe(1) // it does not even dry-run a retired intent
    expect(toasts.titles).toEqual([]) // and it says its piece exactly once, not once per tick
    expect(spend_guard_attempts(INTENT)).toBe(0) // an executed failure is not a backoff — it is the end
  })
})

describe('#1383 — the loop is bounded and re-armable (pure)', () => {
  it('stops at the budget, keeps going while rows remain, and waits for an owed row that has not appeared', () => {
    expect(resolver_continues({ pending: 1, seen: true }, { tick: 1, await_row: false })).toBe(true)
    expect(resolver_continues({ pending: 0, seen: true }, { tick: 1, await_row: false })).toBe(false)
    expect(resolver_continues({ pending: 0, seen: false }, { tick: 1, await_row: true })).toBe(true)
    expect(resolver_continues({ pending: 0, seen: true }, { tick: 1, await_row: true })).toBe(false)
    expect(resolver_continues({ pending: 1, seen: true }, { tick: RESOLVER_MAX_TICKS, await_row: true })).toBe(false)
  })

  it('a second signal joins the live loop instead of doubling the read rate', async () => {
    let passes = 0
    const slow = async () => {
      passes += 1
      return { rows: 1, pending: passes < 3 ? 1 : 0 }
    }
    const first = resolve_pending_results(ADDRESS, slow, { sleep: instant })
    const second = resolve_pending_results(ADDRESS, slow, { sleep: instant })
    expect(await first).toEqual(await second) // one loop, one verdict — never two competing readers
    expect(passes).toBe(3)
  })
})
