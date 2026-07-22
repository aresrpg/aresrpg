// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// pending_outcomes.js — the unopened-results surface's pure core: the /v1 row mapper, the per-wallet memo,
// the auto-open attempt registry (burn-law latch), and the failure classifier. Everything is exercised via
// plain arguments (the module is a deliberate leaf) — ZERO `mock.module` (process-global collision law).
import { afterEach, describe, expect, it } from 'bun:test'

import {
  map_pending_outcomes,
  pending_outcomes_for,
  invalidate_pending_outcomes,
  begin_attempt,
  end_attempt,
  attempt_error,
  attempt_state,
  acquire_settlement_flight,
  run_result_auto_open,
  subscribe_attempts,
  should_boot_open,
  reset_attempts_for_test,
  is_preflight_failure,
} from './pending_outcomes.js'

// The exact /v1/pending-outcomes contract row (coordinator-pinned): a real LIVE orphan shape.
const OWNER_ROW = {
  outcome_id: '0x4fd5a7a1433e994bf6c563ef8115204fa875deaa15c115b3a20a83651238b079',
  character_id: '0x59725530910de90712e39d8e279e6522f4da1b50de9f4ced936749ede17fae75',
  fight_id: '0xbfc5222665988a711622543d2f221512ee8267dad5b4bb53735b0b1e3281596e',
  world_id: '0x0d936039531aa9c68da6fba56564d7f8adb02c26c1691c59d4efa7375164e4d1',
  pvp: false,
  outcome: 3,
  aged_bp: 400,
}

afterEach(() => {
  invalidate_pending_outcomes()
  reset_attempts_for_test()
})

describe('map_pending_outcomes (scan → pill mapping)', () => {
  it('maps the exact /v1 contract shape to a per-character row', () => {
    const map = map_pending_outcomes([OWNER_ROW])
    expect(map.size).toBe(1)
    expect(map.get(OWNER_ROW.character_id)).toEqual({
      outcome_id: OWNER_ROW.outcome_id,
      character_id: OWNER_ROW.character_id,
      fight_id: OWNER_ROW.fight_id,
      world_id: OWNER_ROW.world_id,
    })
  })

  it('skips rows without outcome_id/character_id and tolerates null ids', () => {
    const map = map_pending_outcomes([
      { outcome_id: '', character_id: '0xa' },
      { outcome_id: '0xb' },
      null,
      { outcome_id: '0xc', character_id: '0xd', fight_id: null, world_id: null },
    ])
    expect(map.size).toBe(1)
    expect(map.get('0xd')).toEqual({ outcome_id: '0xc', character_id: '0xd', fight_id: null, world_id: null })
  })

  it('keeps the FIRST row per character (marker admits one unopened outcome in practice)', () => {
    const map = map_pending_outcomes([
      { outcome_id: '0x1', character_id: '0xa' },
      { outcome_id: '0x2', character_id: '0xa' },
    ])
    expect(map.get('0xa').outcome_id).toBe('0x1')
  })

  it('handles an empty/absent list', () => {
    expect(map_pending_outcomes([]).size).toBe(0)
    expect(map_pending_outcomes(undefined).size).toBe(0)
  })
})

describe('pending_outcomes_for (per-wallet memo — one fetch per signal, never polled)', () => {
  it('shares ONE fetch across every roster-row pill for the same wallet', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return [OWNER_ROW]
    }
    const [a, b] = await Promise.all([
      pending_outcomes_for('0xowner', fetcher),
      pending_outcomes_for('0xowner', fetcher),
    ])
    await pending_outcomes_for('0xowner', fetcher)
    expect(calls).toBe(1)
    expect(a.get(OWNER_ROW.character_id).outcome_id).toBe(OWNER_ROW.outcome_id)
    expect(b).toBe(a)
  })

  it('refetches for a DIFFERENT wallet (account switch)', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return []
    }
    await pending_outcomes_for('0xone', fetcher)
    await pending_outcomes_for('0xtwo', fetcher)
    expect(calls).toBe(2)
  })

  it('NEVER memoizes a failed fetch (a transient error must not permanently hide the pill)', async () => {
    let calls = 0
    const flaky = async () => {
      calls += 1
      if (calls === 1) throw new Error('route not live yet')
      return [OWNER_ROW]
    }
    await expect(pending_outcomes_for('0xowner', flaky)).rejects.toThrow('route not live yet')
    const map = await pending_outcomes_for('0xowner', flaky)
    expect(calls).toBe(2)
    expect(map.size).toBe(1)
  })

  it('invalidate_pending_outcomes re-arms the next fetch (post-open refetch)', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return calls === 1 ? [OWNER_ROW] : []
    }
    const before = await pending_outcomes_for('0xowner', fetcher)
    expect(before.size).toBe(1)
    invalidate_pending_outcomes()
    const after = await pending_outcomes_for('0xowner', fetcher)
    expect(calls).toBe(2)
    expect(after.size).toBe(0) // the opened outcome is gone from the projection
  })

  it('resolves empty without a wallet or fetcher (never throws on a blank mount)', async () => {
    expect((await pending_outcomes_for('', async () => [OWNER_ROW])).size).toBe(0)
    expect((await pending_outcomes_for('0xowner', null)).size).toBe(0)
  })
})

describe('attempt registry (auto-open burn-law rails)', () => {
  it('single-flight per outcome: a second begin while inflight is refused (auto AND manual)', () => {
    expect(begin_attempt('0xo')).toBe(true)
    expect(begin_attempt('0xo')).toBe(false)
    expect(begin_attempt('0xo', { manual: true })).toBe(false)
    expect(attempt_state('0xo')).toBe('inflight')
  })

  it('shares the inflight promise so engage detection awaits the open already started at boot', async () => {
    const gate = Promise.withResolvers()
    let opens = 0
    const effect = async () => {
      opens += 1
      await gate.promise
      return { status: 'opened', receipt: { digest: '0xopen' } }
    }
    const boot = run_result_auto_open('0xo', effect)
    const engage = run_result_auto_open('0xo', effect)
    expect(engage).toBe(boot)
    expect(opens).toBe(1)
    expect(attempt_state('0xo')).toBe('inflight')
    gate.resolve()
    await expect(Promise.all([boot, engage])).resolves.toEqual([
      { status: 'opened', receipt: { digest: '0xopen' } },
      { status: 'opened', receipt: { digest: '0xopen' } },
    ])
    expect(opens).toBe(1)
    expect(attempt_state('0xo')).toBe('opened')
  })

  it('serializes different result ids through the store-wide settlement flight', async () => {
    let state = { _settling: false }
    const listeners = new Set()
    const store = {
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...patch }
        for (const listener of listeners) listener(state)
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const first = acquire_settlement_flight(store)
    let second_acquired = false
    const second = acquire_settlement_flight(store).then(() => {
      second_acquired = true
    })

    await first
    await Promise.resolve()
    expect(state._settling).toBe(true)
    expect(second_acquired).toBe(false)
    store.setState({ _settling: false })
    await second
    expect(second_acquired).toBe(true)
    expect(state._settling).toBe(true)
    store.setState({ _settling: false })
  })

  it('an EXECUTED failure LATCHES with its honest error: auto never re-fires, manual still may', async () => {
    const executed = Object.assign(new Error('open failed after execution'), { digest: '0xburned' })
    expect(begin_attempt('0xo')).toBe(true)
    end_attempt('0xo', 'executed_failure', executed)
    expect(attempt_state('0xo')).toBe('latched')
    expect(begin_attempt('0xo')).toBe(false) // AUTO refused forever this session
    expect(attempt_error('0xo')).toBe(executed) // the engage door can surface the real failure
    expect(begin_attempt('0xo', { manual: true })).toBe(true) // user-initiated retry allowed
    end_attempt('0xo', 'executed_failure')
    expect(attempt_state('0xo')).toBe('latched') // and it re-latches after the manual attempt
  })

  it('a REFUSED auto-open latches one actual effect and falls back to the manual press', async () => {
    const refusal = new Error('wallet refused the open before submission')
    let opens = 0
    const first = await run_result_auto_open('0xo', async () => {
      opens += 1
      throw refusal
    })
    const second = await run_result_auto_open('0xo', async () => {
      opens += 1
      return { status: 'opened', receipt: null }
    })
    expect(first).toEqual({ status: 'failed', error: refusal })
    expect(second).toEqual({ status: 'blocked', error: refusal })
    expect(opens).toBe(1)
    expect(attempt_state('0xo')).toBe('latched')
    expect(begin_attempt('0xo', { manual: true })).toBe(true)
  })

  it('a local deferral re-arms an untouched result instead of spending its auto attempt', async () => {
    const busy = new Error('another result transaction owns the store')
    await expect(run_result_auto_open('0xo', async () => ({ status: 'deferred', error: busy }))).resolves.toEqual({
      status: 'blocked',
      error: busy,
    })
    expect(attempt_state('0xo')).toBe(null)
    expect(begin_attempt('0xo')).toBe(true)
  })

  it('the separate settlement retry engine may explicitly clear a TRANSIENT fight-id attempt', () => {
    expect(begin_attempt('0xo')).toBe(true)
    end_attempt('0xo', 'transient')
    expect(attempt_state('0xo')).toBe(null)
    expect(begin_attempt('0xo')).toBe(true)
  })

  it('an OPENED outcome keeps a session tombstone so a lagging /v1 row cannot auto-compose it twice', () => {
    expect(begin_attempt('0xo')).toBe(true)
    end_attempt('0xo', 'opened')
    expect(attempt_state('0xo')).toBe('opened')
    expect(begin_attempt('0xo')).toBe(false)
  })

  it('refuses a blank outcome id', () => {
    expect(begin_attempt('')).toBe(false)
  })
})

describe('boot gate (detection must not depend on a UI surface)', () => {
  it('fires exactly ONCE per wallet across the init read + the subscribe stream (no refetch storm)', () => {
    expect(should_boot_open('0xowner')).toBe(true) // init read at module load
    expect(should_boot_open('0xowner')).toBe(false) // subscribe echo of the same wallet
    expect(should_boot_open('0xowner')).toBe(false) // any later auth-store churn
  })

  it('re-arms on an account switch and ignores signed-out states', () => {
    expect(should_boot_open(null)).toBe(false)
    expect(should_boot_open('')).toBe(false)
    expect(should_boot_open('0xone')).toBe(true)
    expect(should_boot_open('0xtwo')).toBe(true) // new wallet = new boot
    expect(should_boot_open('0xtwo')).toBe(false)
  })
})

describe('subscribe_attempts (pill reactivity — the badge renders, the wires drive)', () => {
  it('notifies on begin and on end; unsubscribe stops the stream', () => {
    let seen = 0
    const unsub = subscribe_attempts(() => {
      seen += 1
    })
    expect(begin_attempt('0xo')).toBe(true)
    end_attempt('0xo', 'opened')
    expect(seen).toBe(2)
    unsub()
    begin_attempt('0xo2')
    expect(seen).toBe(2)
  })

  it('a throwing listener never breaks the registry', () => {
    const unsub = subscribe_attempts(() => {
      throw new Error('render boom')
    })
    expect(begin_attempt('0xo3')).toBe(true) // does not throw
    expect(attempt_state('0xo3')).toBe('inflight')
    unsub()
  })
})

describe('is_preflight_failure (burn-law classifier: ambiguous ⇒ executed ⇒ latch)', () => {
  it('classifies our own pre-submit client refusals as pre-flight', () => {
    expect(is_preflight_failure(new Error('Not connected'))).toBe(true)
    expect(is_preflight_failure(new Error('Not signed in'))).toBe(true)
    expect(is_preflight_failure(new Error('That character is not in your kiosk'))).toBe(true)
  })

  it('classifies transport failures as pre-flight', () => {
    expect(is_preflight_failure(new TypeError('Failed to fetch'))).toBe(true)
    expect(is_preflight_failure(new Error('fetch failed'))).toBe(true)
    expect(is_preflight_failure(new Error('Request timed out after 8000ms'))).toBe(true)
  })

  it('treats a transport-worded failure with a digest as executed', () => {
    const executed = Object.assign(new Error('network timeout while waiting for effects'), { digest: '0xburned' })
    expect(is_preflight_failure(executed)).toBe(false)
  })

  it('classifies a stale-row BUILD failure (consumed outcome → object not found) as pre-flight', () => {
    expect(is_preflight_failure(new Error('Object 0x4fd5…b079 not found'))).toBe(true)
    expect(is_preflight_failure(new Error('object does not exist'))).toBe(true)
  })

  it('classifies a humanized EXECUTED tx failure as NOT pre-flight (latch)', () => {
    // tx_error() shape: player-copy message + the raw structured abort on .cause (digest exists = gas burned)
    const executed = new Error('The transaction failed on-chain — nothing was changed. Try again.')
    executed.cause = { $kind: 'MoveAbort', MoveAbort: { abortCode: 11, location: { module: 'kiosk' } } }
    expect(is_preflight_failure(executed)).toBe(false)
  })

  it('rounds AMBIGUOUS toward executed (a false transient could burn gas)', () => {
    expect(is_preflight_failure(new Error('something unexpected'))).toBe(false)
    expect(is_preflight_failure(null)).toBe(false)
  })

  // ── 07-18 VICTORY-CARD STARVATION (driven-composite trace, 121623ms): the gas-guard's dry-run refusal of the
  // terminal-race settle (fullnode simulate lagging the killing commit → settlement::101 ENotTerminal — REFUSED
  // pre-sign, ZERO gas, NO digest) classified here as EXECUTED (the structured MoveAbort blob is byte-identical
  // to an executed abort) → 'executed_failure' latch → the core's retry engine starved → no receipt ever → the
  // victory card's .fe-gain skeletoned forever. The fix is POSITIVE provenance from the throw site: tx/index.ts
  // throws tx_error(blob, { preflight: true }), which stamps the house `SimulationError` marker; this classifier
  // recognizes the STRUCTURAL marker (error_preflight_marked — same leaf as the digest walk), never message text.
  it('RED 07-18: the gas-guard dry-run refusal (preflight-marked tx_error) is TRANSIENT — re-armable, never a latch', async () => {
    const { tx_error } = await import('../game/core/abort_copy.js')
    const dry_run_refusal = tx_error(
      {
        $kind: 'MoveAbort',
        message:
          "MoveAbort in 1st command, abort code: 101, in '0xe25d…376c9f::settlement::settle_core' (instruction 26)",
        command: 0,
        MoveAbort: { abortCode: '101', location: { package: '0xe25d…376c9f', module: 'settlement', instruction: 26 } },
      },
      { preflight: true }
    )
    expect(is_preflight_failure(dry_run_refusal)).toBe(true)
  })

  it('digest proof outranks the preflight marker (a finality wrap must still latch)', async () => {
    const { tx_error } = await import('../game/core/abort_copy.js')
    const marked = tx_error(
      { $kind: 'MoveAbort', MoveAbort: { abortCode: '101', location: { module: 'settlement' } } },
      { preflight: true }
    )
    const with_digest = Object.assign(marked, { digest: '0xburned' })
    expect(is_preflight_failure(with_digest)).toBe(false)
  })

  it('an UNMARKED structured MoveAbort still rounds to executed (the marker is the ONLY new admission)', async () => {
    const { tx_error } = await import('../game/core/abort_copy.js')
    const executed = tx_error({
      $kind: 'MoveAbort',
      MoveAbort: { abortCode: '101', location: { module: 'settlement' } },
    })
    expect(is_preflight_failure(executed)).toBe(false)
  })
})
