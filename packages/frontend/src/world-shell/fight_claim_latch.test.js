// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { STATUS_FAILED } from '@aresrpg/fight/board_state'

import { run_latched_claim, run_signal_settlement } from './fight_claim_latch.js'
import { is_preflight_failure, reset_attempts_for_test } from './pending_outcomes.js'

function registry() {
  const attempts = new Map()
  return {
    attempts,
    begin: (id, { manual }) => {
      if (attempts.get(id) === 'inflight' || (attempts.get(id) === 'latched' && !manual)) return false
      attempts.set(id, 'inflight')
      return true
    },
    end: (id, verdict) => {
      if (verdict === 'executed_failure') attempts.set(id, 'latched')
      else attempts.delete(id)
    },
  }
}

describe('fight claim failure latch', () => {
  test('an executed failed claim is latched and never auto-fired again', async () => {
    const r = registry()
    let calls = 0
    const execute = () =>
      run_latched_claim({
        attempt_id: 'fight-1',
        begin: r.begin,
        end: r.end,
        run: async (note_failure) => {
          calls += 1
          note_failure('executed_failure')
          return false
        },
      })
    expect(await execute()).toBe(false)
    expect(await execute()).toBe(false)
    expect(calls).toBe(1)
    expect(r.attempts.get('fight-1')).toBe('latched')
  })

  test('a network/preflight failure re-arms, so the next signal may land', async () => {
    const r = registry()
    let calls = 0
    const execute = () =>
      run_latched_claim({
        attempt_id: 'fight-1',
        begin: r.begin,
        end: r.end,
        run: async (note_failure) => {
          calls += 1
          if (calls === 1) {
            note_failure('transient')
            return false
          }
          return true
        },
      })
    expect(await execute()).toBe(false)
    expect(r.attempts.has('fight-1')).toBe(false)
    expect(await execute()).toBe(true)
    expect(calls).toBe(2)
    expect(r.attempts.has('fight-1')).toBe(false)
  })

  test('a network-worded failure with a submission digest latches and cannot auto-fire twice', async () => {
    const r = registry()
    let calls = 0
    const execute = () =>
      run_latched_claim({
        attempt_id: 'fight-1',
        begin: r.begin,
        end: r.end,
        run: async (note_failure) => {
          calls += 1
          const error = Object.assign(new Error('network timeout while waiting for effects'), { digest: '0xburned' })
          note_failure(is_preflight_failure(error) ? 'transient' : 'executed_failure')
          return false
        },
      })

    expect(await execute()).toBe(false)
    expect(await execute()).toBe(false)
    expect(calls).toBe(1)
    expect(r.attempts.get('fight-1')).toBe('latched')
  })
})

// SELF-DRIVING RETRY ("why would we have pending outcomes??" — the ClaimChip world-HUD fallback is
// deleted; a genuinely stuck settlement must not need it). ROOT CAUSE: dungeon_run_store.js's claim() calls
// _stop_polling() and tears the session down BEFORE the background settle_and_open lands. A transient
// (pre-flight, zero-gas) settle failure whose IMMEDIATE liveness recheck does not yet show 'settled' used to
// fall back to a fight_store.subscribe() wait for a fresh reducer fold — but nothing feeds that store any more
// (no poll timer, no live session), so the subscription NEVER fires and the outcome sits pending until a
// SEPARATE wallet-level wire (page reload / the next abort-111 refusal) eventually rescans it. Fixed: the retry
// keeps re-checking chain liveness itself on a bounded backoff — a cheap read, no tx, no gas, burn-law untouched
// (run_latched_claim still owns the actual settle attempt / its latch).
describe('run_signal_settlement — self-driving retry after a transient (pre-flight) settle failure', () => {
  afterEach(() => reset_attempts_for_test())

  const seed_terminal_defeat = (fight_id) => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id, my_key: 'p0', ctx: {} })
    store.getState().input({
      type: 'terminal_confirmation',
      phase: 'defeat',
      last_room: true,
      source: 'receipt',
      version: 1,
    })
    return store
  }

  test('a transient verdict whose first liveness check is still-live keeps retrying on its OWN clock — no external fold/poll required', async () => {
    const store = seed_terminal_defeat('fight-1')

    let run_calls = 0
    const run = async () => {
      run_calls += 1
      // mirrors settle_chain_latched's real contract: a pre-flight failure never marks the fight_id 'latched'
      // in the pending_outcomes registry, so run_signal_settlement classifies this verdict 'transient'.
      return run_calls > 1 // fails once (the dry-run-lag class), lands on the retry
    }
    let liveness_calls = 0
    const read_fight_liveness_fn = async () => {
      liveness_calls += 1
      // still finalizing on-chain for the first 2 checks, settled on the 3rd — proving the LOOP is what
      // notices, not an external fold/poll (claim() already stopped both by the time this runs).
      return liveness_calls < 3 ? { state: 'live' } : { state: 'settled', read: { version: 7 } }
    }
    let sleep_calls = 0
    const sleep = async () => {
      sleep_calls += 1
    }

    const landed = await run_signal_settlement(STATUS_FAILED, 'fight-1', run, {
      store,
      read_fight_liveness_fn,
      get_sdk_fn: async () => ({}),
      sleep,
    })

    expect(landed).toBe(true) // the outcome self-heals: no pending-outcome projection survives
    expect(run_calls).toBe(2) // the settle attempt fired exactly once more — never a blind hammering loop
    expect(liveness_calls).toBe(3) // the retry loop is what noticed 'settled' — nothing external fed it
    expect(sleep_calls).toBe(2) // backs off between checks instead of hot-looping
  })

  test('the retry is bounded — an on-chain liveness that never resolves gives up honestly instead of hanging forever', async () => {
    const store = seed_terminal_defeat('fight-2')
    const run = async () => false
    const read_fight_liveness_fn = async () => ({ state: 'live' }) // never settles within the test
    let sleep_calls = 0
    const sleep = async () => {
      sleep_calls += 1
    }

    const landed = await run_signal_settlement(STATUS_FAILED, 'fight-2', run, {
      store,
      read_fight_liveness_fn,
      get_sdk_fn: async () => ({}),
      sleep,
      max_liveness_retries: 3,
    })

    expect(landed).toBe(false) // honest — never fabricates a landed settle
    expect(sleep_calls).toBe(3) // bounded — the caller is never left hanging
  })
})
