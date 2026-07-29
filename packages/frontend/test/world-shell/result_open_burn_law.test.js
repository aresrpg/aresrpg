// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1383 — THE RESULT OPEN IS A MONEY PATH: it must dry-run for free until it can land, submit exactly ONCE,
// and never speak a claim its own projection cannot back.
//
// Three defects, three proofs here:
//   ① THE LYING LINE. "You have an unfinished fight result" was pushed from the settle-halt path with no read
//      of the projection the character-panel badge renders — so a halt that left NO outcome (the executed abort
//      reverted the whole PTB: the fight is still live) told the player to go open something that does not
//      exist. The claim is now a PROJECTION of that one row (`settle_halt_notice`), by construction.
//   ② PARKED ON THE BADGE. A PRE-FLIGHT refusal burns nothing (the tx choke's dry run refuses before the wallet
//      signs), yet it latched the automatic open for the whole session — the manual badge became the normal
//      flow. Dry runs are free: the open now re-attempts on the house backoff schedule until the simulation
//      passes, and only a persistently-failing open falls back to the badge.
//   ③ THE UNDECLARED AUTOMATION. The open door named no `intent` and no `automated` flag, so the mechanical
//      spend guard (#1262) — the ONE home of "an executed failure is never resubmitted" — did not cover the
//      one flow that fires without a player pressing anything. Test A drives the REAL door twice against a
//      wallet whose first submission executes and fails; the second must never reach the wallet.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { fight_shard_index } from '@aresrpg/sdk/deployment/aresrpg'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock, set_auth_mock_implementation } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals()

const dungeon_actions = await import('../../src/world-shell/dungeon_actions.js')
const kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
const { reset_spend_guard, spend_guard_state, backoff_delay_ms } = await import('../../src/world-shell/spend_guard.js')
const { attach_executed_digest } = await import('../../src/world-shell/tx_digest_error.js')
const {
  run_result_auto_open,
  attempt_state,
  reset_attempts_for_test,
  is_preflight_failure,
  settle_halt_notice,
  OPEN_RETRY_ATTEMPTS,
} = await import('../../src/world-shell/pending_outcomes.js')
const { tx_error } = await import('../../src/game/core/abort_copy.js')

afterAll(restore_browser_globals)

const pad = (tag) => `0x${tag.padStart(64, '0')}`
const OUTCOME = pad('0c1383')
const CHARACTER = pad('c1383')
const OWNER = pad('a1383')
const HANDLE = { kiosk_id: pad('caf1'), personal_kiosk_cap_id: pad('caf2') }

const SHARDS = Array.from({ length: 16 }, (_, i) => ({ id: pad(`5a4d${i.toString(16)}`), initial_shared_version: '1' }))
const LATCH_SHARDS = Array.from({ length: 16 }, (_, i) => ({
  id: pad(`1a7c${i.toString(16)}`),
  initial_shared_version: '1',
}))
const IDS = {
  PACKAGE_ID: pad('a0e1'),
  LATEST_PACKAGE_ID: pad('a0e2'),
  ENGINE_PACKAGE_ID: pad('e0e1'),
  ENGINE_LATEST_PACKAGE_ID: pad('e0e2'),
  ENGINE_VERSION: pad('e0e3'),
  VERSION: pad('a0e4'),
  GAME_CONFIG: pad('a0e5'),
  CREATION: pad('a0e6'),
  CATALOG: pad('a0e7'),
  POOL_REGISTRY: pad('a0e8'),
  ITEM_POLICY: pad('a0e9'),
  CHARACTER_POLICY: pad('a0ea'),
  DUNGEON_PACKAGE_ID: pad('d0e1'),
  FIGHT_REGISTRY_SHARDS: SHARDS,
  FIGHT_LATCH_SHARDS: LATCH_SHARDS,
}
const CTX = { network: 'localnet', ids: { aresrpg: IDS } }

/** Every object id a built transaction actually carries, whatever input shape it took. */
const input_ids = (tx) =>
  tx.getData().inputs.flatMap((input) => {
    const id =
      input.Object?.SharedObject?.objectId ??
      input.Object?.ImmOrOwnedObject?.objectId ??
      input.UnresolvedObject?.objectId
    return id ? [id] : []
  })

// ── A · THE SUBMISSION DOOR (the real dungeon_actions open, real spend guard, mocked transport) ──────────────

describe('#1383 ③ · the automatic result open is the spend guard’s subject', () => {
  /** @type {any[]} */
  let submitted = []
  /** @type {any[]} */
  let spies = []

  beforeEach(() => {
    submitted = []
    reset_spend_guard()
    reset_attempts_for_test()
    reset_auth_mock({ address: OWNER, wallet_name: 'test-wallet' })
    set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
    spies = [
      spyOn(dungeon_actions, 'ctx_of').mockReturnValue({ ...CTX }),
      spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(HANDLE),
    ]
    set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
      submitted = [...submitted, tx]
      // The wallet submitted it and the chain aborted: a digest exists, so the gas is gone.
      throw attach_executed_digest(new Error('results::open aborted on chain'), pad('b1383'))
    })
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    reset_spend_guard()
    reset_attempts_for_test()
    reset_expedition_sdk_mock()
    reset_auth_mock()
  })

  test('RED: an EXECUTED open failure opens the circuit — the next automatic open never reaches the wallet', async () => {
    await expect(dungeon_actions.open_outcome(OUTCOME, CHARACTER, { automated: true })).rejects.toThrow(
      'results::open aborted on chain'
    )
    expect(submitted).toHaveLength(1)
    // The digest is the proof gas burned; the mechanical circuit — not a comment — must stop the second send.
    expect(spend_guard_state().circuits[`open_result:${OUTCOME}`]).toEqual({ digest: pad('b1383') })

    // The refusal is the guard's own (structural name, zero gas, honest copy) — not another chain abort.
    const refusal = await dungeon_actions.open_outcome(OUTCOME, CHARACTER, { automated: true }).catch((e) => e)
    expect(refusal.name).toBe('SpendGuardRefusal')
    expect(refusal.guard_reason).toBe('circuit_open')
    expect(submitted).toHaveLength(1) // ZERO resubmissions — the second attempt never touched the wallet
  })

  // ── THE MECHANISM BEHIND THE LIVE REPORT (#1383 ③) ────────────────────────────────────────────────────────
  // "A partner could not load his XP reward." `results::open` releases the CHARACTER-keyed `FightLatch` shard,
  // and both recovery doors composed the PTB WITHOUT the character — `fight_latch_arg` refuses to guess a shard,
  // so every open of an already-minted outcome threw at BUILD time. No transaction, no digest, and a message
  // ("scope must be a hex object id … got undefined") that the burn-law classifier rounds to EXECUTED: the
  // session latched, the badge press threw the same, and the only door out of an abort-111 lockout was shut.
  test('RED: the world-fight open COMPOSES — its latch shard is derived from the character, never guessed', async () => {
    set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
      submitted = [...submitted, tx]
      return {
        digest: pad('c1383'),
        effects_result: {
          Transaction: {
            digest: pad('c1383'),
            effects: { changedObjects: [], gasUsed: {} },
            objectTypes: {},
            events: [],
          },
        },
      }
    })

    await dungeon_actions.open_outcome(OUTCOME, CHARACTER, { automated: true })

    expect(submitted).toHaveLength(1)
    const [command] = submitted[0].getData().commands
    expect(`${command.MoveCall.module}::${command.MoveCall.function}`).toBe('results::open')
    expect(input_ids(submitted[0])).toContain(LATCH_SHARDS[fight_shard_index(CHARACTER)].id)
  })

  test('a DIFFERENT outcome is untouched by that circuit (the key is the outcome, never the whole flow)', async () => {
    await expect(dungeon_actions.open_outcome(OUTCOME, CHARACTER, { automated: true })).rejects.toThrow(
      'results::open aborted on chain'
    )
    await expect(dungeon_actions.open_outcome(pad('0c9999'), CHARACTER, { automated: true })).rejects.toThrow(
      'results::open aborted on chain'
    )
    expect(submitted).toHaveLength(2)
  })
})

// ── B · THE FREE-DRY-RUN RETRY (the leaf registry; plain arguments, zero mock.module) ────────────────────────

describe('#1383 ② · a pre-flight refusal costs nothing, so the open retries for free', () => {
  afterEach(reset_attempts_for_test)

  /** The gas-guard's own zero-gas dry-run refusal: preflight-marked, no digest. */
  const dry_run_refusal = () =>
    tx_error(
      { $kind: 'MoveAbort', MoveAbort: { abortCode: '111', location: { module: 'fight' } } },
      { preflight: true }
    )

  test('RED: two zero-gas dry-run refusals are retried on the house backoff, then the open lands — no latch', async () => {
    const waits = []
    let attempts = 0
    const verdict = await run_result_auto_open(
      OUTCOME,
      async () => {
        attempts += 1
        if (attempts < 3) return { status: 'failed', error: dry_run_refusal() }
        return { status: 'opened', receipt: { digest: pad('d1383') } }
      },
      { sleep: async (ms) => waits.push(ms) }
    )
    expect(verdict).toEqual({ status: 'opened', receipt: { digest: pad('d1383') } })
    expect(attempts).toBe(3)
    expect(attempt_state(OUTCOME)).toBe('opened')
    // ONE backoff schedule in the house (spend_guard's) — never a second one invented here.
    expect(waits).toHaveLength(2)
    expect(waits[0]).toBeGreaterThanOrEqual(backoff_delay_ms(1))
    expect(waits[0]).toBeLessThanOrEqual(backoff_delay_ms(1, 1))
    expect(waits[1]).toBeGreaterThanOrEqual(backoff_delay_ms(2))
    expect(waits[1]).toBeLessThanOrEqual(backoff_delay_ms(2, 1))
  })

  test('an EXECUTED failure is attempted EXACTLY once and latches (a digest means the gas is already gone)', async () => {
    let attempts = 0
    const executed = attach_executed_digest(new Error('open aborted on chain'), pad('b1383'))
    const verdict = await run_result_auto_open(
      OUTCOME,
      async () => {
        attempts += 1
        return { status: 'failed', error: executed }
      },
      { sleep: async () => {} }
    )
    expect(attempts).toBe(1)
    expect(verdict).toEqual({ status: 'failed', error: executed })
    expect(attempt_state(OUTCOME)).toBe('latched')
  })

  test('a persistently-refusing open exhausts its budget and falls back to the badge (the last-resort surface)', async () => {
    let attempts = 0
    const verdict = await run_result_auto_open(
      OUTCOME,
      async () => {
        attempts += 1
        return { status: 'failed', error: dry_run_refusal() }
      },
      { sleep: async () => {} }
    )
    expect(attempts).toBe(OPEN_RETRY_ATTEMPTS)
    expect(verdict.status).toBe('failed')
    expect(attempt_state(OUTCOME)).toBe('latched')
  })

  test('the spend guard’s OWN refusal is zero-gas by construction — it may never latch the badge', () => {
    const refusal = Object.assign(new Error('spend guard: open_result:0x1 held until 123'), {
      name: 'SpendGuardRefusal',
      guard_reason: 'backoff',
    })
    expect(is_preflight_failure(refusal)).toBe(true)
  })
})

// ── C · THE LINE THE HALT MAY HONESTLY SPEAK ────────────────────────────────────────────────────────────────

describe('#1383 ① · the unfinished-result claim is a projection of the badge’s own row', () => {
  test('RED: a halt that left NO row may NOT claim a pending result', async () => {
    await expect(settle_halt_notice(async () => null)).resolves.toEqual({ claim: 'settle_failed', row: null })
  })

  test('a halt with a real row claims exactly that row (toast ⊆ projection truth)', async () => {
    const row = { outcome_id: OUTCOME, character_id: CHARACTER }
    await expect(settle_halt_notice(async () => row)).resolves.toEqual({ claim: 'pending_result', row })
  })

  test('an unreadable projection makes NO claim about a pending result (never invent one)', async () => {
    await expect(
      settle_halt_notice(async () => {
        throw new Error('/v1 unreachable')
      })
    ).resolves.toEqual({ claim: 'settle_failed', row: null })
  })

  test('a row without an outcome id is not an actionable row', async () => {
    await expect(settle_halt_notice(async () => ({ character_id: CHARACTER }))).resolves.toEqual({
      claim: 'settle_failed',
      row: null,
    })
  })
})
